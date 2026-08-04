"use client";

/**
 * Reveal chime, synthesised with the Web Audio API.
 *
 * No audio file to ship, cache, 404, or add to the CSP — a rising major triad
 * is four oscillators and about thirty lines. It also means the sound works
 * offline on a kiosk that has lost its network mid-session.
 *
 * iPadOS blocks audio until a user gesture; by the time this plays the customer
 * has tapped through five screens, so the context is unlocked.
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

/** Rising C–E–G–C chime. Resolves when scheduled; never throws at a customer. */
export async function playRevealChime(): Promise<void> {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);

    const notes = [
      { frequency: 523.25, at: 0 },
      { frequency: 659.25, at: 0.09 },
      { frequency: 783.99, at: 0.18 },
      { frequency: 1046.5, at: 0.27 },
    ];

    for (const { frequency, at } of notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;

      // Quick attack, exponential tail — a chime, not a beep.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.9, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.75);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now + at);
      oscillator.stop(now + at + 0.8);
      // Release the node graph once it has finished sounding.
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }

    setTimeout(() => master.disconnect(), 1400);
  } catch {
    // Sound is a nicety. A device that refuses to play it still delivers a photo.
  }
}

/** Releases the shared AudioContext — called when the kiosk resets. */
export function releaseAudio(): void {
  if (context && context.state !== "closed") void context.close().catch(() => undefined);
  context = null;
}
