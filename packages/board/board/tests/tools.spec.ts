/** Board tools executed through the real tool registry. */
import { Context } from '@deepseek-ai/cordis'
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

describe('board tools through the real registry', () => {
  it('creates and lists tasks, and reports a missing task', async () => {
    const ctx = await harness()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining(['board_create', 'board_list', 'board_get', 'board_update', 'board_complete', 'board_claim']))

    const created = await execute(ctx, 'board_create', 'c1', { workspaceId: 'ws-1', title: 'Write tests' })
    expect(created.isError).toBe(false)

    const listed = await execute(ctx, 'board_list', 'c2', { workspaceId: 'ws-1', readyOnly: true })
    expect(listed.isError).toBe(false)
    const asText = listed.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(asText).toContain('Write tests')

    const missing = await execute(ctx, 'board_get', 'c3', { id: 'missing' })
    expect(missing.isError).toBe(true)
  })
})
