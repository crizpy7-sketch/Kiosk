import { query, queryOne } from "@/lib/db/client";
import type {
  AppSettingRow,
  AssetRow,
  ExperienceRow,
  GenerationSessionRow,
  GenerationSessionStatus,
  KioskRow,
} from "@/lib/db/types";
import { EXPERIENCES, type Experience } from "@/lib/config/experiences";

// ------------------------------------------------------------------ kiosks --

export async function getKiosk(id: string): Promise<KioskRow | null> {
  return queryOne<KioskRow>(`SELECT * FROM kiosks WHERE id = $1`, [id]);
}

export async function listKiosks(): Promise<KioskRow[]> {
  return query<KioskRow>(`SELECT * FROM kiosks ORDER BY name`);
}

export interface KioskHeartbeat {
  appVersion?: string;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
}

export async function recordKioskHeartbeat(id: string, beat: KioskHeartbeat = {}): Promise<void> {
  await query(
    `UPDATE kiosks
        SET status = 'online',
            last_seen_at = now(),
            current_app_version = COALESCE($2, current_app_version),
            battery_percent = COALESCE($3, battery_percent),
            battery_charging = COALESCE($4, battery_charging),
            updated_at = now()
      WHERE id = $1`,
    [id, beat.appVersion ?? null, beat.batteryPercent ?? null, beat.batteryCharging ?? null],
  );
}

export async function setKioskDailyLimit(id: string, seconds: number): Promise<void> {
  await query(`UPDATE kiosks SET daily_ai_limit_seconds = $2, updated_at = now() WHERE id = $1`, [id, seconds]);
}

export async function setKioskActive(id: string, active: boolean): Promise<void> {
  await query(`UPDATE kiosks SET active = $2, updated_at = now() WHERE id = $1`, [id, active]);
}

/** A kiosk that hasn't checked in for 2 minutes is treated as offline. */
export function isKioskOnline(kiosk: KioskRow, now = new Date()): boolean {
  if (!kiosk.last_seen_at) return false;
  return now.getTime() - kiosk.last_seen_at.getTime() < 120_000;
}

// ------------------------------------------------------------- experiences --

/**
 * Merges the code-defined catalogue with the runtime switches in the database.
 * Prompts always come from code; active/featured/price/order come from the row
 * when one exists.
 */
export interface ResolvedExperience extends Experience {
  priceCents: number;
  active: boolean;
  featured: boolean;
  sortOrder: number;
}

export async function listResolvedExperiences(options: { includeInactive?: boolean } = {}): Promise<
  ResolvedExperience[]
> {
  const rows = await query<ExperienceRow>(`SELECT * FROM experiences`);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const resolved = EXPERIENCES.map((experience): ResolvedExperience => {
    const row = byId.get(experience.id);
    return {
      ...experience,
      active: row ? row.active : experience.active,
      featured: row ? row.featured : experience.featured,
      priceCents: row ? row.price_cents : experience.priceCents,
      sortOrder: row ? row.sort_order : experience.sortOrder,
    };
  });

  return resolved
    .filter((e) => options.includeInactive || e.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getResolvedExperience(slug: string): Promise<ResolvedExperience | null> {
  const all = await listResolvedExperiences({ includeInactive: true });
  return all.find((e) => e.slug === slug) ?? null;
}

export async function setExperienceActive(id: string, active: boolean): Promise<void> {
  await query(`UPDATE experiences SET active = $2, updated_at = now() WHERE id = $1`, [id, active]);
}

export async function setExperiencePrice(id: string, priceCents: number): Promise<void> {
  await query(`UPDATE experiences SET price_cents = $2, updated_at = now() WHERE id = $1`, [id, priceCents]);
}

export async function setAllExperiencePrices(priceCents: number): Promise<void> {
  await query(`UPDATE experiences SET price_cents = $1, updated_at = now()`, [priceCents]);
}

// ----------------------------------------------------- generation sessions --

export interface StartGenerationSessionInput {
  orderId: string;
  provider: string;
  model: string;
  isRetake: boolean;
}

export async function startGenerationSession(
  input: StartGenerationSessionInput,
): Promise<GenerationSessionRow> {
  const row = await queryOne<GenerationSessionRow>(
    `INSERT INTO generation_sessions (order_id, provider, model, is_retake, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING *`,
    [input.orderId, input.provider, input.model, input.isRetake],
  );
  if (!row) throw new Error("Failed to start generation session.");
  return row;
}

export async function endGenerationSession(
  id: string,
  update: {
    status: GenerationSessionStatus;
    billableSeconds: number;
    normalizedErrorCode?: string | null;
    providerSessionId?: string | null;
  },
): Promise<void> {
  await query(
    `UPDATE generation_sessions
        SET status = $2,
            ended_at = now(),
            billable_seconds_estimate = $3,
            normalized_error_code = $4,
            provider_session_id = COALESCE($5, provider_session_id)
      WHERE id = $1 AND ended_at IS NULL`,
    [id, update.status, update.billableSeconds, update.normalizedErrorCode ?? null, update.providerSessionId ?? null],
  );
}

export async function listGenerationSessionsForOrder(orderId: string): Promise<GenerationSessionRow[]> {
  return query<GenerationSessionRow>(
    `SELECT * FROM generation_sessions WHERE order_id = $1 ORDER BY started_at ASC`,
    [orderId],
  );
}

/** Seconds of AI time attributed to a kiosk since midnight UTC — the daily cap. */
export async function getAiSecondsUsedToday(kioskId: string): Promise<number> {
  const row = await queryOne<{ total: string | null }>(
    `SELECT COALESCE(SUM(gs.billable_seconds_estimate), 0) AS total
       FROM generation_sessions gs
       JOIN orders o ON o.id = gs.order_id
      WHERE o.kiosk_id = $1
        AND gs.started_at >= date_trunc('day', now())`,
    [kioskId],
  );
  return Number(row?.total ?? 0);
}

// ------------------------------------------------------------------ assets --

export interface CreateAssetInput {
  orderId: string;
  privateStoragePath: string;
  contentType: string;
  byteSize: number;
  downloadTokenHash: string;
  expiresAt: Date;
}

export async function createAsset(input: CreateAssetInput): Promise<AssetRow> {
  const row = await queryOne<AssetRow>(
    `INSERT INTO assets (order_id, type, private_storage_path, content_type, byte_size, download_token_hash, expires_at)
     VALUES ($1, 'final_image', $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.orderId,
      input.privateStoragePath,
      input.contentType,
      input.byteSize,
      input.downloadTokenHash,
      input.expiresAt,
    ],
  );
  if (!row) throw new Error("Failed to create asset.");
  return row;
}

export async function getAssetByTokenHash(tokenHash: string): Promise<AssetRow | null> {
  return queryOne<AssetRow>(`SELECT * FROM assets WHERE download_token_hash = $1`, [tokenHash]);
}

export async function getLatestAssetForOrder(orderId: string): Promise<AssetRow | null> {
  return queryOne<AssetRow>(
    `SELECT * FROM assets WHERE order_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
}

export async function rotateAssetToken(assetId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await query(`UPDATE assets SET download_token_hash = $2, expires_at = $3 WHERE id = $1`, [
    assetId,
    tokenHash,
    expiresAt,
  ]);
}

export async function markAssetDownloaded(assetId: string): Promise<void> {
  await query(`UPDATE assets SET downloaded_at = COALESCE(downloaded_at, now()) WHERE id = $1`, [assetId]);
}

export async function listExpiredAssets(limit = 200): Promise<AssetRow[]> {
  return query<AssetRow>(
    `SELECT * FROM assets WHERE deleted_at IS NULL AND expires_at < now() ORDER BY expires_at ASC LIMIT $1`,
    [limit],
  );
}

export async function markAssetDeleted(assetId: string): Promise<void> {
  await query(`UPDATE assets SET deleted_at = now() WHERE id = $1`, [assetId]);
}

// ---------------------------------------------------------------- settings --

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await queryOne<AppSettingRow>(`SELECT * FROM app_settings WHERE key = $1`, [key]);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
