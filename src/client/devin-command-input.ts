/** Devin slash-command human input projection.
 *
 * DSH chat only marks a blank session "active" when it sees a non-`command`
 * node (`isActive` ignores pure command rows). Official `/goal` works on the
 * hero by projecting a separate `command-input` node. We mirror that for
 * `/devin-*` so New Session no longer looks dead after a bare status/login.
 */

export const DEVIN_COMMANDS = [
  'devin-login',
  'devin-status',
  'devin-logout',
  'devin-cancel',
] as const

export type DevinCommandName = (typeof DEVIN_COMMANDS)[number]

export function isDevinCommandName(name: string): name is DevinCommandName {
  return (DEVIN_COMMANDS as readonly string[]).includes(name)
}

export interface DevinCommandInputData {
  readonly commandId: string
  readonly text: string
  readonly time: number
}

interface DevinCommandInputState extends DevinCommandInputData {
  readonly seq: number
}

interface SessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: {
    readonly commandId?: string
    readonly name?: string
    readonly args?: string
  }
}

interface MatchLike {
  readonly event: SessionEventLike
  readonly location?: { readonly kind: string }
}

/** Visible `/name args` line from a durable command/run event. */
export function devinCommandText(event: SessionEventLike): string {
  const name = event.data.name ?? ''
  const args = (event.data.args ?? '').trimEnd()
  return args === '' ? `/${name}` : `/${name}${args.startsWith(' ') ? args : ` ${args}`}`
}

/**
 * Conversation event definition registered on `uiConversation.events`.
 * View node kind is intentionally NOT `command` so chat becomes active on a blank session.
 */
export const devinCommandInputDefinition = {
  kind: 'devin-command-input',
  target: 'chat',
  match: (event: SessionEventLike) => (
    event.type === 'command/run'
    && typeof event.data.name === 'string'
    && isDevinCommandName(event.data.name)
      ? { id: String(event.data.commandId), role: 'start' as const }
      : null
  ),
  start: (_context: unknown, match: MatchLike) => {
    if (match.event.type !== 'command/run') {
      throw new Error('devin-command-input start requires command/run')
    }
    return {
      commandId: String(match.event.data.commandId),
      seq: match.event.seq,
      time: match.event.time,
      text: devinCommandText(match.event),
    } satisfies DevinCommandInputState
  },
  update: (context: { readonly state: DevinCommandInputState }) => context.state,
  buildViewNode: (context: {
    readonly key: string
    readonly id: string
    readonly state?: DevinCommandInputState
    readonly start?: MatchLike
  }) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'devin-command-input',
      id: context.id,
      target: 'chat',
      // Sit just above the paired command result row.
      anchorSeq: context.state.seq - 0.1,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible' as const,
      data: {
        commandId: context.state.commandId,
        text: context.state.text,
        time: context.state.time,
      } satisfies DevinCommandInputData,
    }
  },
}
