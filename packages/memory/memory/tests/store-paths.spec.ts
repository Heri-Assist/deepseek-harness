/** Memory store input validation, match modes, filters, eviction, and schema ownership. */
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import MemoryStore, { buildMatchExpression, openMemoryDatabase, MEMORY_APPLICATION_ID } from '../src/index.ts'
import { MemoryInputError } from '../src/types.ts'
import type { MemoryScope } from '../src/types.ts'

const source = { origin: 'explicit' as const }

async function harness(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemoryStore, { databasePath: ':memory:', ...config })
  return ctx
}

afterEach(async () => {
  // Temp roots are created per test and removed there; nothing global to clean.
})

describe('memory input validation', () => {
  it('rejects an oversized fact, an empty key, an unknown scope, and a task without a task id', async () => {
    const ctx = await harness({ maxTextBytes: 4 })
    await expect(ctx.memory.remember({ text: 'too long', source })).rejects.toBeInstanceOf(MemoryInputError)
    await expect(ctx.memory.remember({ text: 'ok', key: '  ', source })).rejects.toBeInstanceOf(MemoryInputError)
    await expect(ctx.memory.remember({ text: 'ok', scope: 'bogus' as MemoryScope, source })).rejects.toBeInstanceOf(MemoryInputError)
    await expect(ctx.memory.remember({ text: 'ok', scope: 'task', workspaceId: 'ws', source })).rejects.toBeInstanceOf(MemoryInputError)
  })

  it('drops blank tags while keeping distinct ones', async () => {
    const ctx = await harness()
    const record = await ctx.memory.remember({ text: 'tags', tags: ['a', ' ', 'a', 'b'], source })
    expect(record.tags).toEqual(['a', 'b'])
  })
})

describe('memory query building and matching', () => {
  it('returns no expression without a token and quotes phrases', () => {
    expect(buildMatchExpression('!!! ...')).toBeUndefined()
    expect(buildMatchExpression('alpha beta')).toBe('"alpha" AND "beta"')
    expect(buildMatchExpression('alpha beta', 'any')).toBe('"alpha" OR "beta"')
    expect(buildMatchExpression('a"b')).toBe('"a" AND "b"')
  })

  it('filters by scope, workspace, task, and match mode', async () => {
    const ctx = await harness()
    await ctx.memory.remember({ text: 'global alpha', source })
    await ctx.memory.remember({ text: 'ws-1 note', scope: 'project', workspaceId: 'ws-1', source })
    await ctx.memory.remember({ text: 'ws-2 note', scope: 'project', workspaceId: 'ws-2', source })
    await ctx.memory.remember({ text: 'task note', scope: 'task', workspaceId: 'ws-1', taskId: 't-1', source })

    expect((await ctx.memory.search({ scope: 'project', workspaceId: 'ws-1' })).map(hit => hit.record.text)).toEqual(['ws-1 note'])
    expect((await ctx.memory.search({ scope: 'task', taskId: 't-1' })).map(hit => hit.record.text)).toEqual(['task note'])
    expect((await ctx.memory.search({ text: 'ws note', match: 'any' })).length).toBeGreaterThanOrEqual(2)
    // `all` requires every term, so a word absent from a record excludes it.
    expect(await ctx.memory.search({ text: 'ws absentterm' })).toHaveLength(0)
    expect((await ctx.memory.list({ scope: 'project' })).map(record => record.text)).toContain('ws-1 note')
  })
})

describe('memory change notification containment', () => {
  it('keeps the committed write when a changed listener throws', async () => {
    const ctx = await harness()
    ctx.on('memory/changed', () => { throw new Error('listener boom') })
    const record = await ctx.memory.remember({ text: 'resilient fact', source })
    expect((await ctx.memory.recall({ text: 'resilient' }))[0]?.record.id).toBe(record.id)
  })
})

describe('memory database ownership', () => {
  it('rejects a database owned by another application', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-mem-bad-'))
    const path = join(directory, 'memory.sqlite')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA application_id = 12345')
    db.close()
    await expect(openMemoryDatabase(path)).rejects.toThrow('belongs to another application')
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects a non-empty unrecognized database and unknown tables', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-mem-foreign-'))
    const path = join(directory, 'memory.sqlite')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE other (id TEXT)')
    db.close()
    await expect(openMemoryDatabase(path)).rejects.toThrow('not empty and not a recognized memory database')

    const owned = join(directory, 'owned.sqlite')
    const db2 = new DatabaseSync(owned)
    db2.exec(`PRAGMA application_id = ${String(MEMORY_APPLICATION_ID)}; CREATE TABLE squatter (id TEXT)`)
    db2.close()
    await expect(openMemoryDatabase(owned)).rejects.toThrow('holds unknown tables')
    await rm(directory, { recursive: true, force: true })
  })

  it('rebuilds owned tables when the schema version is older', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-mem-reset-'))
    const path = join(directory, 'memory.sqlite')
    const first = await openMemoryDatabase(path)
    first.prepare('INSERT INTO memories_fts (id, text, tags) VALUES (?, ?, ?)').run('x', 'stale', '')
    first.exec('PRAGMA user_version = 0')
    first.close()
    const reopened = await openMemoryDatabase(path)
    const rows = reopened.prepare('SELECT count(*) AS count FROM memories_fts').get() as { count: number }
    expect(rows.count).toBe(0)
    reopened.close()
    await rm(directory, { recursive: true, force: true })
  })
})
