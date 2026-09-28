/** The board Remote namespace a future Web Kanban surface calls. */
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import BoardService from '@deepseek-ai/dsh-board'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Storage from '@deepseek-ai/dsh-storage'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import BoardController from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  ctx.effect(() => ctx.storage.backend.register('fixture', new MemoryStorageBackend(pool)))
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return () => { unmount() }
  })
  await ctx.plugin(BoardService, {})
  await ctx.plugin(BoardController)
  return ctx
}

describe('the board Remote namespace', () => {
  it('publishes the board namespace from its own service key', async () => {
    const ctx = await boot()
    const binding = ctx.boardController.typertRemote
    expect(binding.serviceKey).toBe('boardController')
    expect(binding.namespace).toBe('board')
    expect(remoteMethods(ctx.boardController)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'update', invocation: { kind: 'direct' } },
    ])
  })

  it('reads a board with derived readiness after creating tasks', async () => {
    const ctx = await boot()
    const controller = ctx.boardController
    const first = await controller.create({ workspaceId: 'ws-1', title: 'Design' })
    const second = await controller.create({ workspaceId: 'ws-1', title: 'Implement', blockedBy: [first.id] })

    expect(first.ready).toBe(true)
    expect(second.ready).toBe(false)
    const listed = await controller.list({ workspaceId: 'ws-1' })
    expect(listed.tasks.map(task => task.title)).toEqual(['Design', 'Implement'])
  })

  it('surfaces a stale update as a bad-request Remote failure', async () => {
    const ctx = await boot()
    const task = await ctx.boardController.create({ workspaceId: 'ws-1', title: 'Ship' })
    await ctx.boardController.update({ id: task.id, revision: task.revision, status: 'in_progress' })
    let failure: unknown
    try {
      await ctx.boardController.update({ id: task.id, revision: task.revision, status: 'done' })
    } catch (error: unknown) {
      failure = error
    }
    expect(remoteErrorOf(failure)?.code).toBe('gateway/bad-request')
  })

  it('round-trips every optional field and derives readiness', async () => {
    const ctx = await boot()
    const blocked = await ctx.boardController.create({ workspaceId: 'ws-1', title: 'Blocker' })
    const created = await ctx.boardController.create({
      workspaceId: 'ws-1',
      title: 'Detailed',
      description: 'detail',
      priority: 'high',
      labels: ['a'],
      blockedBy: [blocked.id],
      writeScopes: ['src/a.ts'],
    })
    expect(created.description).toBe('detail')
    expect(created.ready).toBe(false)

    const updated = await ctx.boardController.update({
      id: created.id,
      revision: created.revision,
      title: 'Detailed v2',
      description: 'more',
      priority: 'low',
      labels: ['b'],
      status: 'blocked',
      blockedBy: [],
      writeScopes: ['src/b.ts'],
    })
    expect(updated.status).toBe('blocked')
    expect(updated.ready).toBe(false)
    const ready = await ctx.boardController.create({ workspaceId: 'ws-1', title: 'Ready now' })
    expect(ready.ready).toBe(true)

    const minimal = await ctx.boardController.update({ id: ready.id, revision: ready.revision, title: 'Minimal edit' })
    expect(minimal.title).toBe('Minimal edit')
  })

  it('surfaces an unknown blocker as a bad-request Remote failure', async () => {
    const ctx = await boot()
    let failure: unknown
    try {
      await ctx.boardController.create({ workspaceId: 'ws-1', title: 'Bad', blockedBy: ['ghost'] })
    } catch (error: unknown) {
      failure = error
    }
    expect(remoteErrorOf(failure)?.code).toBe('gateway/bad-request')
  })

  it('maps an unexpected service fault to gateway/internal', async () => {
    const ctx = await boot()
    const board: { list: BoardService['list'] } = ctx.board
    board.list = () => { throw new Error('boom') }
    let failure: unknown
    try {
      await ctx.boardController.list({ workspaceId: 'ws-1' })
    } catch (error: unknown) {
      failure = error
    }
    expect(remoteErrorOf(failure)?.code).toBe('gateway/internal')

    const literal: { list: BoardService['list'] } = ctx.board
    literal.list = () => { throw 'boom' }
    let raw: unknown
    try {
      await ctx.boardController.list({ workspaceId: 'ws-1' })
    } catch (error: unknown) {
      raw = error
    }
    expect(remoteErrorOf(raw)?.message).toBe('boom')
  })
})
