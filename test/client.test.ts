import { describe, it, expect, vi } from 'vitest'
import { name, inject, apply } from '../src/client/index.js'
import {
  DEVIN_COMMANDS,
  devinCommandInputDefinition,
  devinCommandText,
  isDevinCommandName,
} from '../src/client/devin-command-input.js'
import { DevinCommandInputView } from '../src/client/components/DevinCommandInputView.js'

describe('client UI plugin', () => {
  it('exports correct Cordis metadata', () => {
    expect(name).toBe('dsh-devin-search-client')
    expect(inject).toContain('slots')
    expect(inject).toContain('uiConversation')
  })

  it('registers command UI but leaves every tool to the native DSH renderer', () => {
    const registrations: Array<{ name: string; key: string; component: unknown }> = []
    const registerEvent = vi.fn()

    const mockSlots = {
      inject: vi.fn((_slotName: string, factory: () => unknown) => {
        const res = factory()
        if (res && typeof (res as Iterable<unknown>)[Symbol.iterator] === 'function') {
          for (const _item of res as Iterable<unknown>) {
            // drain generator registrations
          }
        }
      }),
      register: vi.fn((meta: { name: string; key: string }, component: unknown) => {
        registrations.push({ name: meta.name, key: meta.key, component })
        return () => {}
      }),
    }

    const mockCtx = {
      slots: mockSlots,
      configForms: { get: vi.fn(() => ({})) },
      uiConversation: { events: { register: registerEvent } },
    } as never

    apply(mockCtx)

    expect(registrations.some(r => r.name === 'plugins.bundle.config' && r.key === 'dsh-devin-search')).toBe(true)
    expect(registerEvent).toHaveBeenCalledWith(devinCommandInputDefinition)
    expect(mockSlots.inject).toHaveBeenCalledWith('conversation.chat.node', expect.any(Function))
    expect(mockSlots.inject).toHaveBeenCalledWith('conversation.chat.commandview', expect.any(Function))
    expect(mockSlots.inject).not.toHaveBeenCalledWith('tool.call.toolview', expect.any(Function))

    const nodeKeys = registrations
      .filter(r => r.name === 'conversation.chat.node')
      .map(r => r.key)
    expect(nodeKeys).toContain('devin-command-input')
    expect(registrations.find(r => r.key === 'devin-command-input')?.component).toBe(DevinCommandInputView)

    const commandKeys = registrations
      .filter(r => r.name === 'conversation.chat.commandview')
      .map(r => r.key)

    expect(commandKeys).toEqual(expect.arrayContaining([...DEVIN_COMMANDS]))

    const toolKeys = registrations
      .filter(r => r.name === 'tool.call.toolview')
      .map(r => r.key)

    expect(toolKeys).toEqual([])
  })
})

describe('devin command-input projection', () => {
  it('recognizes only the four /devin-* names', () => {
    expect(isDevinCommandName('devin-status')).toBe(true)
    expect(isDevinCommandName('goal')).toBe(false)
  })

  it('matches command/run for devin commands and builds a non-command view node', () => {
    const run = {
      type: 'command/run',
      seq: 3,
      time: 1_700_000_000_000,
      data: { commandId: 'c1', name: 'devin-status', args: undefined },
    }
    expect(devinCommandInputDefinition.match(run)).toEqual({ id: 'c1', role: 'start' })
    expect(devinCommandInputDefinition.match({
      type: 'command/run',
      seq: 1,
      time: 0,
      data: { commandId: 'x', name: 'goal' },
    })).toBeNull()
    expect(devinCommandInputDefinition.match({
      type: 'command/done',
      seq: 4,
      time: 0,
      data: { commandId: 'c1', name: 'devin-status' },
    })).toBeNull()

    const state = devinCommandInputDefinition.start({}, { event: run, location: { kind: 'unresolved' } })
    expect(state).toEqual({
      commandId: 'c1',
      seq: 3,
      time: 1_700_000_000_000,
      text: '/devin-status',
    })

    const node = devinCommandInputDefinition.buildViewNode({
      key: 'devin-command-input:c1',
      id: 'c1',
      state,
      start: { event: run, location: { kind: 'unresolved' } },
    })
    expect(node).toMatchObject({
      kind: 'devin-command-input',
      target: 'chat',
      visibility: 'visible',
      data: { commandId: 'c1', text: '/devin-status', time: 1_700_000_000_000 },
    })
    expect(node?.kind).not.toBe('command')
  })

  it('formats command text with optional args', () => {
    expect(devinCommandText({
      type: 'command/run',
      seq: 1,
      time: 0,
      data: { commandId: 'a', name: 'devin-login', args: '  ' },
    })).toBe('/devin-login')
    expect(devinCommandText({
      type: 'command/run',
      seq: 1,
      time: 0,
      data: { commandId: 'a', name: 'devin-status', args: ' verbose' },
    })).toBe('/devin-status verbose')
  })
})
