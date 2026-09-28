/** Every board-tool input path, render arm, and call presentation. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import BoardService from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

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

function execute(ctx: Context, name: string, callId: string, args: Record<string, unknown>) {
  return ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(callId), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

describe('board tools direct input paths', () => {
  it('creates with required fields and with every optional field, then reads it back', async () => {
    const ctx = await harness()
    const required = await execute(ctx, 'board_create', 'c1', { workspaceId: 'ws-1', title: 'Required only' })
    expect(required.isError).toBe(false)

    const gate = await ctx.board.create({ workspaceId: 'ws-1' as never, title: 'gate' })
    await ctx.board.complete(gate.id, gate.revision)
    const full = await execute(ctx, 'board_create', 'c2', {
      workspaceId: 'ws-1',
      title: 'Full task',
      description: 'detail',
      priority: 'high',
      labels: ['a', 'b'],
      blockedBy: [String(gate.id)],
      writeScopes: ['src/a.ts'],
    })
    expect(full.isError).toBe(false)
    expect(text(full)).toContain('Full task')

    const listed = await execute(ctx, 'board_list', 'l1', { workspaceId: 'ws-1', status: 'backlog', readyOnly: true })
    expect(listed.isError).toBe(false)
    expect(text(listed)).toContain('Full task')

    const got = await execute(ctx, 'board_get', 'g1', { id: String(gate.id) })
    expect(text(got)).toContain('gate')
  })

  it('renders an empty list and reports a missing task', async () => {
    const ctx = await harness()
    expect(text(await execute(ctx, 'board_list', 'l2', { workspaceId: 'empty' }))).toContain('No matching tasks')
    expect((await execute(ctx, 'board_get', 'g2', { id: 'missing' })).isError).toBe(true)
  })

  it('updates every optional field, completes, and claims', async () => {
    const ctx = await harness()
    const created = await ctx.board.create({ workspaceId: 'ws-1' as never, title: 'Work' })
    const blocker = await ctx.board.create({ workspaceId: 'ws-1' as never, title: 'Blocker' })
    const updated = await execute(ctx, 'board_update', 'u1', {
      id: String(created.id),
      revision: created.revision,
      title: 'Work updated',
      description: 'now with detail',
      priority: 'low',
      labels: ['x'],
      status: 'blocked',
      blockedBy: [String(blocker.id)],
      writeScopes: ['src/z.ts'],
    })
    expect(updated.isError).toBe(false)
    expect(text(updated)).toContain('blocked-by')

    const completed = await execute(ctx, 'board_complete', 'k1', { id: String(blocker.id), revision: blocker.revision })
    expect(text(completed)).toContain('[done/')

    const second = await ctx.board.create({ workspaceId: 'ws-1' as never, title: 'Claim me' })
    const claimed = await execute(ctx, 'board_claim', 'cl1', { id: String(second.id), revision: second.revision, label: 'me' })
    expect(text(claimed)).toContain('[in_progress/')
  })

  it('surfaces a stale update and a missing update as tool errors', async () => {
    const ctx = await harness()
    const created = await ctx.board.create({ workspaceId: 'ws-1' as never, title: 'Stale' })
    await ctx.board.update({ id: created.id, revision: created.revision, title: 'moved on' })
    expect((await execute(ctx, 'board_update', 'u2', { id: String(created.id), revision: created.revision, title: 'again' })).isError).toBe(true)
    expect((await execute(ctx, 'board_update', 'u3', { id: 'missing', revision: 1, title: 'x' })).isError).toBe(true)
  })

  it('publishes a call presentation for every board tool', async () => {
    const ctx = await harness()
    expect(ctx.tools.get('board_create')?.presentCall?.({ workspaceId: 'ws-1', title: 't' })).toMatchObject({ title: 'Create board task' })
    expect(ctx.tools.get('board_list')?.presentCall?.({ workspaceId: 'ws-1' })).toMatchObject({ title: 'List board tasks' })
    expect(ctx.tools.get('board_get')?.presentCall?.({ id: 'x' })).toMatchObject({ title: 'Read board task' })
    expect(ctx.tools.get('board_update')?.presentCall?.({ id: 'x', revision: 1 })).toMatchObject({ title: 'Update board task' })
    expect(ctx.tools.get('board_complete')?.presentCall?.({ id: 'x', revision: 1 })).toMatchObject({ title: 'Complete board task' })
    expect(ctx.tools.get('board_claim')?.presentCall?.({ id: 'x', revision: 1 })).toMatchObject({ title: 'Claim board task' })
  })

  it('records the creating session, claims with an agent owner, and updates required fields only', async () => {
    const ctx = await harness()
    const agent = { session: { header: { id: SessionId('agent-1') } } } as Agent
    const call = (name: string, id: string, args: Record<string, unknown>) => ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId(id), name, arguments: args, agent,
    })
    const created = await call('board_create', 'c3', { workspaceId: 'ws-1', title: 'Owned', description: 'detail' })
    expect(created.isError).toBe(false)
    const [task] = await ctx.board.list({ workspaceId: WorkspaceId('ws-1') })
    if (task === undefined) throw new Error('expected the created task')
    expect(task.createdBy).toBe('agent-1')

    const claimed = await call('board_claim', 'cl2', { id: String(task.id), revision: task.revision })
    expect(text(claimed)).toContain('[in_progress/')

    const second = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Minimal update' })
    const minimal = await call('board_update', 'u4', { id: String(second.id), revision: second.revision, priority: 'high' })
    expect(text(minimal)).toContain('[backlog/high]')
  })
})
