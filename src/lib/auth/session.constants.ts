/**
 * Shared with the Edge middleware, which cannot import the server-only session
 * module (it pulls in `pg` and `next/headers`).
 */
export const ADMIN_COOKIE = "wf_admin_session";
