import type { OrderStatus } from "@/lib/orders/state-machine";
import type { Language } from "@/lib/i18n/messages";

export type UserRole = "owner" | "staff";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

export interface KioskRow {
  id: string;
  name: string;
  location_label: string;
  status: "online" | "offline" | "maintenance";
  last_seen_at: Date | null;
  current_app_version: string | null;
  configured_language: Language;
  daily_ai_limit_seconds: number;
  battery_percent: number | null;
  battery_charging: boolean | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ExperienceRow {
  id: string;
  slug: string;
  active: boolean;
  featured: boolean;
  price_cents: number;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface OrderRow {
  id: string;
  public_reference: string;
  kiosk_id: string;
  experience_id: string;
  status: OrderStatus;
  language: Language;
  price_cents: number;
  currency: string;
  demo: boolean;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: Date | null;
  consented_at: Date | null;
  generation_started_at: Date | null;
  generation_completed_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  refunded_at: Date | null;
  error_code: string | null;
  retake_used: boolean;
  staff_note: string | null;
  helped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type GenerationSessionStatus = "active" | "completed" | "failed" | "timeout" | "canceled";

export interface GenerationSessionRow {
  id: string;
  order_id: string;
  provider: string;
  model: string;
  provider_session_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  billable_seconds_estimate: string; // NUMERIC arrives as a string from pg
  status: GenerationSessionStatus;
  normalized_error_code: string | null;
  is_retake: boolean;
  created_at: Date;
}

export interface AssetRow {
  id: string;
  order_id: string;
  type: "final_image";
  private_storage_path: string;
  content_type: string;
  byte_size: number;
  download_token_hash: string;
  expires_at: Date;
  deleted_at: Date | null;
  downloaded_at: Date | null;
  created_at: Date;
}

export interface AuditEventRow {
  id: string;
  actor_user_id: string | null;
  actor_label: string;
  kiosk_id: string | null;
  order_id: string | null;
  event_type: string;
  safe_metadata: Record<string, unknown>;
  created_at: Date;
}

export interface AdminSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  last_seen_at: Date;
}

export interface AppSettingRow {
  key: string;
  value: unknown;
  updated_at: Date;
}
