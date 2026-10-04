import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { injectDevinStyles } from './styles/devin-theme.js'
import { DevinLoginCommandCard } from './components/DevinLoginCommandCard.js'
import { DevinStatusCommandCard } from './components/DevinStatusCommandCard.js'
import { DevinActionCommandCard } from './components/DevinActionCommandCard.js'
import { DevinCommandInputView } from './components/DevinCommandInputView.js'
import { devinCommandInputDefinition } from './devin-command-input.js'
import { SearchSettings, type SearchForm } from './components/SearchSettings.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject(name: string, callback: () => any): () => void
      register(options: { name: string; key?: string }, component: any): () => void
    }
    configForms: {
      get(namespace: string): SearchForm
    }
    uiConversation?: {
      events: {
        register(definition: unknown): void
      }
    }
  }
}

export const name = 'dsh-devin-search-client'
/**
 * slots: command cards only; tools use DSH's native/default renderer
 * uiConversation: blank-session activation via native-looking command-input projection
 * (DSH isActive ignores pure `command` rows — same pattern as /goal)
 */
export const inject = ['slots', 'uiConversation', 'configForms']

export function apply(ctx: Context): void {
  injectDevinStyles()

  // Required so blank sessions leave the hero and show /devin-* cards.
  // View is styled like DSH native user/goal bubbles — not a custom red capsule.
  ctx.uiConversation?.events.register(devinCommandInputDefinition)

  const form = ctx.configForms.get('devin-search')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
    { name: 'plugins.bundle.config', key: 'dsh-devin-search' },
    () => createElement(SearchSettings, { form }),
  ))

  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: 'devin-command-input' },
      DevinCommandInputView,
    ),
  )

  ctx.slots.inject('conversation.chat.commandview', function* () {
    yield ctx.slots.register(
      { name: 'conversation.chat.commandview', key: 'devin-login' },
      DevinLoginCommandCard,
    )

    yield ctx.slots.register(
      { name: 'conversation.chat.commandview', key: 'devin-status' },
      DevinStatusCommandCard,
    )

    yield ctx.slots.register(
      { name: 'conversation.chat.commandview', key: 'devin-cancel' },
      DevinActionCommandCard,
    )

    yield ctx.slots.register(
      { name: 'conversation.chat.commandview', key: 'devin-logout' },
      DevinActionCommandCard,
    )
  })

}
