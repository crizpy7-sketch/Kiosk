import Link from "next/link";
import { requirePermission } from "@/lib/auth/session.server";
import { listAuditEvents } from "@/lib/audit";
import { EmptyState, formatDateTime, Panel } from "@/components/admin/Ui";

export const dynamic = "force-dynamic";

/**
 * The audit log. Read-only by design — there is no delete action here and no
 * server action that removes an audit row, for any role.
 */
export default async function AdminAuditPage() {
  await requirePermission("audit.view");
  const events = await listAuditEvents(200);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-bold text-white">Audit trail</h1>
        <p className="mt-1 max-w-[720px] text-[14px] text-wf-dim">
          Every order transition, refund, sign-in and settings change. Append-only: nobody, including
          an owner, can delete an entry from here. Secrets and personal details are redacted before
          anything is written.
        </p>
      </div>

      <Panel title={`Last ${events.length} events`}>
        {events.length === 0 ? (
          <EmptyState>Nothing recorded yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13px]" data-testid="audit-table">
              <thead className="text-[12px] uppercase tracking-wide text-wf-dim">
                <tr>
                  <th className="pb-3 pr-4">When</th>
                  <th className="pb-3 pr-4">Event</th>
                  <th className="pb-3 pr-4">Actor</th>
                  <th className="pb-3 pr-4">Order</th>
                  <th className="pb-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-wf-border">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-wf-dim">
                      {formatDateTime(event.created_at)}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-white">{event.event_type}</td>
                    <td className="py-2.5 pr-4 text-wf-dim">{event.actor_label}</td>
                    <td className="py-2.5 pr-4">
                      {event.order_id ? (
                        <Link
                          href={`/admin/orders/${event.order_id}`}
                          className="text-wf-pink hover:underline"
                        >
                          open
                        </Link>
                      ) : (
                        <span className="text-wf-dim">—</span>
                      )}
                    </td>
                    <td className="py-2.5 font-mono text-[12px] text-wf-dim/80">
                      {JSON.stringify(event.safe_metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
