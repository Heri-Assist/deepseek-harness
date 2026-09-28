// Proves the memory plugin mounts through the real Cordis Loader from a
// cordis.yml row, registers its three tools, and round-trips a fact, using the
// real tool registry and the real service — no model is involved.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import MemoryStore from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Boot a cordis.yml carrying the given memory config block.
 * @param configLines - YAML lines nested under the memory `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-memory'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-memory', MemoryStore],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

describe('dsh-memory real Loader composition through cordis.yml', () => {
  it('registers the three tools and round-trips a fact', async () => {
    const ctx = await boot(["    databasePath: ':memory:'"])
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining(['remember', 'recall', 'forget']))

    const written = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('remember-1'),
      name: 'remember',
      arguments: { text: 'The loader mounts the memory row.', tags: ['loader'] },
    })
    expect(written.isError).toBe(false)

    const found = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('recall-1'),
      name: 'recall',
      arguments: { query: 'loader memory row', tags: ['loader'] },
    })
    expect(found.isError).toBe(false)
    expect(resultText(found)).toContain('The loader mounts the memory row.')
  }, 30_000)

  it('fails loading on an out-of-range cap', async () => {
    await expect(boot(['    maxRecordsPerScope: 0'])).rejects.toThrow()
  }, 30_000)
})
