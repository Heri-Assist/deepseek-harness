/**
 * ui-board plugin halves: the browser entry's dictionary and header-slot
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal), the injected board face, and the inert node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { BoardListInjected } from '../src/client/BoardListAction.tsx'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Header entries currently registered in the header list. */
function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('conversation.session.header.actions').map(entry => entry.options.id)
}

/** Board reads handed to the stubbed board Remote namespace. */
const calls: string[] = []

async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', {
    $on: () => () => {},
    board: {
      list: async (request: { workspaceId: string }) => {
        calls.push(request.workspaceId)
        return { ok: true, value: { tasks: [] } }
      },
    },
  } as never)
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: { 's-1': { cwd: '/work/ws-1' } } }) } } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-board browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['remote', 'slots', 'locale'])
  })

  it('exposes the cwd lookup and board read through the inject face', async () => {
    const { ctx } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.actions').find(candidate => candidate.options.id === 'board-list')
    const injectFace = entry?.inject as (() => BoardListInjected) | undefined
    if (injectFace === undefined) throw new Error('board-list entry registered no inject face')
    const face = injectFace()
    expect(face.cwdOf('s-1')).toBe('/work/ws-1')
    expect(face.cwdOf('missing')).toBeUndefined()
    await expect(face.list('/work/ws-1')).resolves.toEqual({ tasks: [] })
    expect(calls).toEqual(['/work/ws-1'])
  })

  it('reports the cwd of a session the client Session store does not hold', async () => {
    const { ctx } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.actions').find(candidate => candidate.options.id === 'board-list')
    const injectFace = entry?.inject as (() => BoardListInjected) | undefined
    const face = injectFace?.()
    expect(face?.cwdOf('nope')).toBeUndefined()
  })

  it('raises the failure message when the board Remote call fails', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({ name: 'root', children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } } as never, () => null)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {}, board: { list: async () => ({ ok: false, error: { message: 'offline' } }) } } as never)
    ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {} }) } } as never)
    ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = ctx.slots.entries('conversation.session.header.actions').find(candidate => candidate.options.id === 'board-list')
    const face = (entry?.inject as (() => BoardListInjected) | undefined)?.()
    await expect(face?.list('/work/ws-1')).rejects.toThrow('offline')
  })

  it('reports no cwd when the client Session store service is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({ name: 'root', children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } } as never, () => null)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {}, board: { list: async () => ({ ok: true, value: { tasks: [] } }) } } as never)
    ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = ctx.slots.entries('conversation.session.header.actions').find(candidate => candidate.options.id === 'board-list')
    const face = (entry?.inject as (() => BoardListInjected) | undefined)?.()
    expect(face?.cwdOf('s-1')).toBeUndefined()
  })

  it('registers the header action, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(headerEntryIds(ctx)).toContain('board-list')
    await fiber.dispose()
    expect(headerEntryIds(ctx)).not.toContain('board-list')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('list.aria')).toBe(zh['list.aria'])
    ctx.locale.setLocale('en')
    expect(translate('list.aria')).toBe(en['list.aria'])
    await fiber.dispose()
    expect(translate('list.aria')).not.toBe(en['list.aria'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-board node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})
