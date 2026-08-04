"use client";

import { createDecartClient, models } from "@decartai/sdk";
import type { RealTimeClient } from "@decartai/sdk";
import { normalizeDecartError } from "@/lib/ai/errors";
import { AiProviderError, type RealtimeSession } from "@/lib/ai/provider";
import type { ClientSessionGrant } from "@/lib/ai/provider";
import { captureVideoFrame } from "@/lib/ai/realtime/capture";

/**
 * Decart realtime session — browser half.
 *
 * The only credential in this file is `grant.clientToken`, which the server
 * minted seconds earlier, scoped to one model and one origin, with a hard
 * session cap Decart enforces on its side. The account key never exists here.
 *
 * Lifecycle guarantees this class is responsible for:
 *   - `connect()` rejects rather than hanging if frames never arrive.
 *   - `disconnect()` is idempotent and stops every track it was handed, so a
 *     customer walking away does not leave the camera light on.
 *   - Billable seconds come from the provider's own `generationTick`, not from
 *     a local stopwatch, so what we report is what we were charged.
 *
 * Verified against @decartai/sdk 0.1.17.
 */

const CONNECT_TIMEOUT_MS = 20_000;

export class DecartRealtimeSession implements RealtimeSession {
  private client: RealTimeClient | null = null;
  private seconds = 0;
  private closed = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly grant: ClientSessionGrant,
    private readonly inputStream: MediaStream,
    private readonly videoElement: HTMLVideoElement,
    private readonly handlers: {
      onConnectionChange?: (state: string) => void;
      onTick?: (seconds: number) => void;
      onError?: (code: ReturnType<typeof normalizeDecartError>) => void;
    } = {},
  ) {}

  get providerSessionId(): string | null {
    return this.client?.sessionId ?? null;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new AiProviderError("AI_DISCONNECTED", "Session already closed.");

    if (new Date(this.grant.expiresAt).getTime() <= Date.now()) {
      throw new AiProviderError("AI_TOKEN_FAILED", "The AI session token expired before connecting.");
    }

    const decart = createDecartClient({ apiKey: this.grant.clientToken });
    const model = models.realtime(this.grant.model as Parameters<typeof models.realtime>[0]);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        if (error) reject(error);
        else resolve();
      };

      // A realtime connection that never produces frames must fail loudly rather
      // than leave a paying customer watching a spinner.
      this.connectTimer = setTimeout(
        () => finish(new AiProviderError("AI_CONNECT_TIMEOUT", "The AI connection timed out.")),
        CONNECT_TIMEOUT_MS,
      );

      decart.realtime
        .connect(this.inputStream, {
          model,
          // Front camera: pre-flip so the customer's movement matches the screen.
          mirror: "auto",
          initialState: { prompt: { text: this.grant.prompt, enhance: true } },
          onRemoteStream: (stream: MediaStream) => {
            this.videoElement.srcObject = stream;
            void this.videoElement.play().catch(() => undefined);
            finish();
          },
          onConnectionChange: (state) => {
            this.handlers.onConnectionChange?.(state);
            if (state === "disconnected" && !this.closed) {
              this.handlers.onError?.("AI_DISCONNECTED");
              finish(new AiProviderError("AI_DISCONNECTED", "The AI session dropped."));
            }
          },
        })
        .then((client) => {
          this.client = client;

          client.on("generationTick", ({ seconds }) => {
            this.seconds = seconds;
            this.handlers.onTick?.(seconds);
          });
          client.on("generationEnded", ({ seconds }) => {
            this.seconds = Math.max(this.seconds, seconds);
          });
          client.on("error", (error) => {
            this.handlers.onError?.(normalizeDecartError(error));
          });
        })
        .catch((error: unknown) => finish(new AiProviderError(normalizeDecartError(error), "AI connect failed", error)));
    });
  }

  async applyExperience(prompt: string): Promise<void> {
    if (!this.client) throw new AiProviderError("AI_DISCONNECTED", "Not connected.");
    await this.client.setPrompt(prompt, { enhance: true });
  }

  async captureFrame(): Promise<Blob> {
    return captureVideoFrame(this.videoElement);
  }

  billableSeconds(): number {
    return this.seconds;
  }

  disconnect(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    try {
      this.client?.disconnect();
    } catch {
      // Disconnect is a cleanup path; a provider throwing here must not stop us
      // from releasing the camera below.
    }
    this.client = null;

    for (const track of this.inputStream.getTracks()) track.stop();

    const remote = this.videoElement.srcObject;
    if (remote instanceof MediaStream) {
      for (const track of remote.getTracks()) track.stop();
    }
    this.videoElement.srcObject = null;
  }
}
