/** Durable project board against real storage services. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it } from 'vitest'
import BoardService, { BoardConflictError, BoardInputError } from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const WS = WorkspaceId('ws-1')

async function harness(): Promise<Context> {
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
  return ctx
}

describe('BoardService', () => {
  it('creates tasks in backlog with the first revision', async () => {
    const ctx = await harness()
    const task = await ctx.board.create({ workspaceId: WS, title: 'Write the parser' })
    expect(task.status).toBe('backlog')
    expect(task.revision).toBe(1)
    expect(task.priority).toBe('normal')
    expect(await ctx.board.get(task.id)).toEqual(task)
  })

  it('derives ready tasks from dependency edges, not a stored flag', async () => {
    const ctx = await harness()
    const first = await ctx.board.create({ workspaceId: WS, title: 'Design schema' })
    const second = await ctx.board.create({ workspaceId: WS, title: 'Implement schema', blockedBy: [first.id] })

    expect((await ctx.board.list({ workspaceId: WS, readyOnly: true })).map(task => task.id)).toEqual([first.id])
    await ctx.board.complete(first.id, first.revision)
    expect((await ctx.board.list({ workspaceId: WS, readyOnly: true })).map(task => task.id)).toEqual([second.id])
  })

  it('rejects a stale compare-and-set revision', async () => {
    const ctx = await harness()
    const task = await ctx.board.create({ workspaceId: WS, title: 'Ship it' })
    await ctx.board.update({ id: task.id, revision: 1, title: 'Ship it now' })
    await expect(ctx.board.update({ id: task.id, revision: 1, title: 'again' })).rejects.toBeInstanceOf(BoardConflictError)
  })

  it('rejects a dependency cycle', async () => {
    const ctx = await harness()
    const first = await ctx.board.create({ workspaceId: WS, title: 'A' })
    const second = await ctx.board.create({ workspaceId: WS, title: 'B', blockedBy: [first.id] })
    await expect(ctx.board.update({ id: first.id, revision: 1, blockedBy: [second.id] })).rejects.toBeInstanceOf(BoardInputError)
  })

  it('claims a ready task and completes it', async () => {
    const ctx = await harness()
    const task = await ctx.board.create({ workspaceId: WS, title: 'Run the migration' })
    const claimed = await ctx.board.claim(task.id, task.revision, { kind: 'agent' })
    expect(claimed.status).toBe('in_progress')
    const done = await ctx.board.complete(claimed.id, claimed.revision)
    expect(done.status).toBe('done')
  })
})
