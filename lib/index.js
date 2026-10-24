/**
 * Host half of the bundle. The rewind button is pure UI: cancel/fork/prefill are
 * all client-side services, so the host half only needs to exist and stay inert.
 * Keeping an explicit `apply` makes the package loadable by both the host roster
 * and the browser roster.
 */

export const name = "dsh-rewind-resend";

/** No host-side behaviour: rewinding a turn is a client feature. */
export function apply() {}
