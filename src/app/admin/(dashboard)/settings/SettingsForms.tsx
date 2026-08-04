"use client";

import { useState, useTransition } from "react";
import {
  createUserAction,
  setDailyLimitAction,
  setDownloadTtlAction,
  setPriceAction,
  setUserActiveAction,
  type ActionResult,
} from "@/lib/admin/actions";
import { Panel } from "@/components/admin/Ui";

interface AdminUser {
  id: string;
  email: string;
  role: "owner" | "staff";
  active: boolean;
  lastLoginAt: string;
}

export function SettingsForms({
  currentPriceCents,
  currentDailyLimitSeconds,
  currentTtlHours,
  users,
}: {
  currentPriceCents: number;
  currentDailyLimitSeconds: number;
  currentTtlHours: number;
  users: AdminUser[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const [price, setPrice] = useState((currentPriceCents / 100).toFixed(2));
  const [limit, setLimit] = useState(String(currentDailyLimitSeconds));
  const [ttl, setTtl] = useState(String(currentTtlHours));
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"owner" | "staff">("staff");

  function run(action: () => Promise<ActionResult>): void {
    startTransition(async () => setResult(await action()));
  }

  return (
    <div className="flex flex-col gap-6">
      {result && (
        <p
          role="status"
          data-testid="settings-result"
          className={`rounded-xl px-4 py-3 text-[14px] ${
            result.ok ? "bg-wf-green/15 text-wf-green" : "bg-wf-pink/15 text-wf-pink"
          }`}
        >
          {result.message}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Price">
          <Field
            label="Price per transformation (USD)"
            value={price}
            onChange={setPrice}
            type="number"
            step="0.01"
            testId="setting-price"
          />
          <SaveButton
            testId="save-price"
            disabled={pending}
            onClick={() => run(() => setPriceAction(Math.round(Number(price) * 100)))}
          />
          <p className="mt-3 text-[12px] text-wf-dim">Applies to all four styles.</p>
        </Panel>

        <Panel title="Daily AI limit">
          <Field
            label="Seconds of AI per day"
            value={limit}
            onChange={setLimit}
            type="number"
            testId="setting-limit"
          />
          <SaveButton
            testId="save-limit"
            disabled={pending}
            onClick={() => run(() => setDailyLimitAction(Number(limit)))}
          />
          <p className="mt-3 text-[12px] text-wf-dim">
            The kiosk refuses new AI sessions past this. Roughly {Math.floor(Number(limit) / 15)} sessions
            at 15s each.
          </p>
        </Panel>

        <Panel title="Photo expiry">
          <Field
            label="Hours a download link stays alive"
            value={ttl}
            onChange={setTtl}
            type="number"
            testId="setting-ttl"
          />
          <SaveButton
            testId="save-ttl"
            disabled={pending}
            onClick={() => run(() => setDownloadTtlAction(Number(ttl)))}
          />
          <p className="mt-3 text-[12px] text-wf-dim">Applies to new links; existing ones keep their expiry.</p>
        </Panel>
      </div>

      <Panel title="Staff access">
        <div className="mb-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[14px]" data-testid="users-table">
            <thead className="text-[12px] uppercase tracking-wide text-wf-dim">
              <tr>
                <th className="pb-3 pr-4">Email</th>
                <th className="pb-3 pr-4">Role</th>
                <th className="pb-3 pr-4">Last sign-in</th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-wf-border">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-3 pr-4 text-white">{user.email}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${
                        user.role === "owner" ? "bg-wf-pink/20 text-wf-pink" : "bg-wf-green/15 text-wf-green"
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-wf-dim">{user.lastLoginAt}</td>
                  <td className="py-3">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setUserActiveAction(user.id, !user.active))}
                      className="text-[13px] text-wf-pink hover:underline disabled:opacity-50"
                    >
                      {user.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 border-t border-wf-border pt-5 sm:grid-cols-4">
          <Field label="Email" value={newEmail} onChange={setNewEmail} type="email" testId="new-user-email" />
          <Field
            label="Password (12+ chars)"
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            testId="new-user-password"
          />
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-wf-dim">Role</span>
            <select
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as "owner" | "staff")}
              data-testid="new-user-role"
              className="min-h-[44px] rounded-xl border border-wf-border bg-wf-ink px-3 text-[14px] text-white outline-none focus:border-wf-pink"
            >
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <div className="flex items-end">
            <SaveButton
              label="Add user"
              testId="add-user"
              disabled={pending}
              onClick={() => run(() => createUserAction(newEmail, newPassword, newRole))}
            />
          </div>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-wf-dim">
          Staff can view orders, help customers, regenerate a QR and request a refund. Only owners can
          complete refunds, change the price or limits, manage styles, read the audit log, or manage
          access.
        </p>
      </Panel>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  step,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  testId?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-wf-dim">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="min-h-[44px] rounded-xl border border-wf-border bg-wf-ink px-3 text-[15px] text-white outline-none focus:border-wf-pink"
      />
    </label>
  );
}

function SaveButton({
  onClick,
  disabled,
  label = "Save",
  testId,
}: {
  onClick: () => void;
  disabled: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="mt-4 min-h-[44px] w-full rounded-xl bg-wf-pink px-5 text-[14px] font-semibold text-white transition-colors hover:bg-wf-pink-deep disabled:opacity-50"
    >
      {label}
    </button>
  );
}
