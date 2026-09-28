/** Durable layered memory store against real Cordis services. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import MemoryStore from '../src/index.ts'
import { MemoryInputError } from '../src/types.ts'

async function harness(databasePath = ':memory:'): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemoryStore, { databasePath })
  return ctx
}

const source = { origin: 'explicit' as const }

describe('MemoryStore', () => {
  it('remembers and recalls one fact by keyword', async () => {
    const ctx = await harness()
    const record = await ctx.memory.remember({ text: 'The build uses pnpm workspaces.', tags: ['build'], source })
    const hits = await ctx.memory.recall({ text: 'pnpm workspaces' })
    expect(hits.map(hit => hit.record.id)).toEqual([record.id])
    expect(hits[0]?.record.tags).toEqual(['build'])
  })

  it('filters recall by tag and scope', async () => {
    const ctx = await harness()
    await ctx.memory.remember({ text: 'project convention one', scope: 'project', workspaceId: 'ws-1', tags: ['conv'], source })
    await ctx.memory.remember({ text: 'project convention two', scope: 'project', workspaceId: 'ws-2', tags: ['conv'], source })
    const hits = await ctx.memory.recall({ text: 'project convention', tags: ['conv'], workspaceId: 'ws-1' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.record.workspaceId).toBe('ws-1')
  })

  it('rejects an unscoped project write', async () => {
    const ctx = await harness()
    await expect(ctx.memory.remember({ text: 'x', scope: 'project', source })).rejects.toBeInstanceOf(MemoryInputError)
  })

  it('forgets a record but keeps its tombstone', async () => {
    const ctx = await harness()
    const record = await ctx.memory.remember({ text: 'temporary fact', source })
    expect(await ctx.memory.forget(record.id)).toBe(true)
    expect(await ctx.memory.recall({ text: 'temporary fact' })).toHaveLength(0)
    expect(await ctx.memory.forget(record.id)).toBe(false)
  })

  it('evicts the oldest unpinned record past the per-scope cap', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(MemoryStore, { databasePath: ':memory:', maxRecordsPerScope: 2 })
    const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 2))
    await ctx.memory.remember({ text: 'first fact alpha', source })
    await tick()
    await ctx.memory.remember({ text: 'second fact beta', source })
    await tick()
    await ctx.memory.remember({ text: 'third fact gamma', source })
    const remaining = await ctx.memory.list({})
    expect(remaining.map(record => record.text)).not.toContain('first fact alpha')
    expect(remaining).toHaveLength(2)
    const pinned = await ctx.memory.remember({ text: 'fourth fact delta', source, pinned: true })
    const afterPin = await ctx.memory.list({})
    expect(afterPin.map(record => record.id)).toContain(pinned.id)
    expect(afterPin).toHaveLength(3)
  })

  it('keeps records across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-memory-'))
    const path = join(directory, 'memory.sqlite')
    const first = await harness(path)
    await first.memory.remember({ text: 'durable fact across restart', source })
    await first.fiber.dispose()
    const second = await harness(path)
    const hits = await second.memory.recall({ text: 'durable fact restart' })
    expect(hits).toHaveLength(1)
  })
})
