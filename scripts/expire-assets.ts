/**
 * Deletes expired photos.
 *
 * "Temporary retention" is only true if something actually deletes. Run this on
 * a schedule (cron, Vercel Cron, a systemd timer — see docs/ARCHITECTURE.md):
 *
 *   npm run jobs:expire
 *
 * Order matters: the bytes go first, then the row is tombstoned. If the process
 * dies between the two, the next run retries the delete and the link is already
 * dead either way — the failure mode is a repeated delete, never an orphaned
 * photo that outlives its expiry.
 */
import { loadDotEnv } from "./load-env";

async function main(): Promise<void> {
  loadDotEnv();

  const { listExpiredAssets, markAssetDeleted } = await import("../src/lib/db/repositories");
  const { getStorage } = await import("../src/lib/storage/index.server");
  const { closePool } = await import("../src/lib/db/client");
  const { recordAudit } = await import("../src/lib/audit");

  const storage = getStorage();
  let deleted = 0;
  let failed = 0;

  try {
    // Batched so a long-idle kiosk with a backlog does not hold one giant query.
    for (;;) {
      const batch = await listExpiredAssets(100);
      if (batch.length === 0) break;

      for (const asset of batch) {
        try {
          await storage.delete(asset.private_storage_path);
          await markAssetDeleted(asset.id);
          await recordAudit({
            orderId: asset.order_id,
            actorLabel: "expiry-job",
            eventType: "asset.expired_deleted",
            metadata: { assetId: asset.id, expiredAt: asset.expires_at.toISOString() },
          });
          deleted += 1;
        } catch (error) {
          failed += 1;
          console.error(`Failed to delete asset ${asset.id}:`, error instanceof Error ? error.message : error);
        }
      }

      if (batch.length < 100) break;
    }

    console.log(`Deleted ${deleted} expired photo(s).${failed ? ` ${failed} failed — will retry next run.` : ""}`);
  } finally {
    await closePool();
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
