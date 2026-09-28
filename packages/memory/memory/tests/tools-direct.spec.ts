/** Every memory-tool input path and render arm through the real registry. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import MemoryStore from '../src/index.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemoryStore, { databasePath: ':memory:' })
  return ctx
}

function execute(ctx: Context, name: string, callId: string, args: Record<string, unknown>) {
  return ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(callId), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

describe('memory tools direct input paths', () => {
  it('covers remember with required fields and with every optional field', async () => {
    const ctx = await harness()
    const minimal = await execute(ctx, 'remember', 'r1', { text: 'plain fact' })
    expect(minimal.isError).toBe(false)

    const full = await execute(ctx, 'remember', 'r2', {
      text: 'scoped fact',
      scope: 'task',
      key: 'deploy',
      tags: ['deploy'],
      workspaceId: 'ws-1',
      taskId: 'task-1',
      pinned: true,
    })
    expect(full.isError).toBe(false)
    expect(text(full)).toContain('Remembered')
  })

  it('rejects an empty fact and an unscoped project write as tool errors', async () => {
    const ctx = await harness()
    expect((await execute(ctx, 'remember', 'r3', { text: '   ' })).isError).toBe(true)
    expect((await execute(ctx, 'remember', 'r4', { text: 'x', scope: 'project' })).isError).toBe(true)
  })

  it('covers recall with and without filters, and an empty result', async () => {
    const ctx = await harness()
    await execute(ctx, 'remember', 'r5', { text: 'alpha note', tags: ['t'] })
    const byQuery = await execute(ctx, 'recall', 'r6', { query: 'alpha' })
    expect(byQuery.isError).toBe(false)
    expect(text(byQuery)).toContain('- [global] alpha note')
    const filtered = await execute(ctx, 'recall', 'r7', { query: 'alpha', tags: ['t'], scope: 'global', workspaceId: 'ws-1', taskId: 'task-1', limit: 2 })
    expect(filtered.isError).toBe(false)
    const empty = await execute(ctx, 'recall', 'r8', { query: 'nonexistentterm' })
    expect(text(empty)).toContain('No matching memories')
  })

  it('covers forget for a known and an unknown record', async () => {
    const ctx = await harness()
    const created = await execute(ctx, 'remember', 'r9', { text: 'temporary' })
    const record = await ctx.memory.list({})
    const id = record[0]?.id
    expect(created.isError).toBe(false)
    if (id === undefined) throw new Error('expected a record')
    expect(text(await execute(ctx, 'forget', 'r10', { id }))).toContain('Memory forgotten')
    expect(text(await execute(ctx, 'forget', 'r11', { id }))).toContain('No such memory')
  })

  it('publishes a call presentation for every memory tool', async () => {
    const ctx = await harness()
    const remember = ctx.tools.get('remember')
    const recall = ctx.tools.get('recall')
    const forget = ctx.tools.get('forget')
    expect(remember?.presentCall?.({ text: 'fact' })).toMatchObject({ title: 'Remember' })
    expect(recall?.presentCall?.({})).toMatchObject({ rawInput: '' })
    expect(recall?.presentCall?.({ query: 'term' })).toMatchObject({ rawInput: 'term' })
    expect(forget?.presentCall?.({ id: 'x' })).toMatchObject({ title: 'Forget' })
  })
})
