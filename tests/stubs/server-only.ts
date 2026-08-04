/**
 * Stub for the `server-only` package.
 *
 * The real module throws when imported outside a server context, which is the
 * point of it — it stops a client component from pulling in a file that reads
 * secrets. Integration tests import those modules deliberately, in Node, so the
 * guard is replaced here rather than weakened in the source.
 */
export {};
