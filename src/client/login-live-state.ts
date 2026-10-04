/** Cross-card live Devin login phase for the browser client.
 *
 * Slash `/devin-login` settles as soon as the auth URL is ready, so the durable
 * command/done text stays "Open this URL…". OAuth success cannot rewrite that
 * row. Status cards (and any later success text) publish here so waiting login
 * cards can flip to the completed UI without another Host round-trip.
 */

export type DevinLivePhase = 'unknown' | 'pending' | 'authorized' | 'logged-out' | 'cancelled'

export interface DevinLiveState {
  readonly phase: DevinLivePhase
  /** Session event time of the publisher; older cards must not clobber newer. */
  readonly at: number
  readonly expiresAt?: string
}

let state: DevinLiveState = { phase: 'unknown', at: 0 }
const listeners = new Set<() => void>()

export function getDevinLiveState(): DevinLiveState {
  return state
}

export function subscribeDevinLiveState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Publish only if `at` is at least as new as the last publication. */
export function publishDevinLiveState(next: {
  readonly phase: DevinLivePhase
  readonly at: number
  readonly expiresAt?: string
}): void {
  if (next.at < state.at) return
  const expiresAt = next.expiresAt
  const candidate: DevinLiveState = expiresAt === undefined
    ? { phase: next.phase, at: next.at }
    : { phase: next.phase, at: next.at, expiresAt }
  if (
    candidate.phase === state.phase
    && candidate.at === state.at
    && candidate.expiresAt === state.expiresAt
  ) {
    return
  }
  state = candidate
  for (const listener of [...listeners]) listener()
}

/** Test helper — reset between unit cases. */
export function resetDevinLiveState(): void {
  state = { phase: 'unknown', at: 0 }
  listeners.clear()
}
