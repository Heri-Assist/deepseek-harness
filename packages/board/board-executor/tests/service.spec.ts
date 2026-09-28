/** The board-executor Host service, including automatic dispatch and worktrees. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import BoardService, { BoardTaskId } from '@deepseek-ai/dsh-board'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Storage from '@deepseek-ai/dsh-storage'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { afterEach, describe, expect, it } from 'vitest'
import BoardExecutor from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function agent(id: string): Agent {
  return { session: { header: { id: SessionId(id) } } } as Agent
}

function run(stopReason: string): SubagentRun {
  return { result: Promise.resolve({ stopReason }) } as SubagentRun
}

async function gitRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-exec-repo-'))
  roots.push(repo)
  await execFileAsync('git', ['-C', repo, 'init'])
  await execFileAsync('git', ['-C', repo, 'config', 'user.email', 't@e.com'])
  await execFileAsync('git', ['-C', repo, 'config', 'user.name', 'T'])
  await writeFile(join(repo, 'README.md'), 'hi\n')
  await execFileAsync('git', ['-C', repo, 'add', '.'])
  await execFileAsync('git', ['-C', repo, 'commit', '-m', 'init'])
  return repo
}

interface MountOptions {
  config?: Record<string, unknown>
  stopReason?: string
  rejectStart?: boolean
  registryPath?: string
}

async function mount(options: MountOptions = {}): Promise<{ ctx: Context; repo: string }> {
  const repo = await gitRepo()
  const root = await mkdtemp(join(tmpdir(), 'dsh-exec-root-'))
  roots.push(root)
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
  ctx.provide('agents', { get: (id: SessionId) => id === SessionId('owner') ? agent('owner') : undefined } as never)
  ctx.provide('subagents', {
    start: () => options.rejectStart === true
      ? Promise.reject(new Error('provider refused'))
      : Promise.resolve(run(options.stopReason ?? 'completed')),
  } as never)
  ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => id === WorkspaceId('ws-1') ? { path: options.registryPath ?? repo } : undefined } as never)
  await ctx.plugin(BoardExecutor, { worktreeRoot: root, ...options.config })
  return { ctx, repo }
}

async function waitFor(fn: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('condition not reached')
}

describe('BoardExecutor service', () => {
  it('dispatches a ready task in its own worktree and settles it to review', async () => {
    const { ctx } = await mount({ config: { provider: 'fake', maxConcurrent: 1, useWorktrees: true } })
    const task = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Do work', createdBy: SessionId('owner') })
    const outcome = await ctx.boardExecutor.dispatch({ workspaceId: 'ws-1', workspacePath: (await ctx.get('workspaceRegistry')!.get(WorkspaceId('ws-1'))!.path) })
    expect(outcome.started).toEqual([String(task.id)])
    await waitFor(async () => (await ctx.board.get(task.id)).status === 'review')
    expect((await ctx.board.get(task.id)).status).toBe('review')
  }, 30_000)

  it('marks a failed run blocked and a missing provider fails loud', async () => {
    const { ctx } = await mount({ config: { provider: 'fake', maxConcurrent: 1, useWorktrees: false }, stopReason: 'error' })
    const task = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Fail', createdBy: SessionId('owner') })
    await ctx.boardExecutor.dispatch({ workspaceId: 'ws-1' })
    await waitFor(async () => (await ctx.board.get(task.id)).status === 'blocked')

    const bare = new Context()
    await bare.plugin(SystemPrompt, {})
    await bare.plugin(ToolRuntime)
    await bare.plugin(Storage)
    const pool = new MemoryMediaPool()
    bare.effect(() => bare.storage.backend.register('fixture', new MemoryStorageBackend(pool)))
    const facility = new DomainFacility(bare, { backend: 'fixture' })
    bare.effect(() => { const u = bare.storage.mount('domain', facility); bare.provide('storageDomain', facility); return () => { u() } })
    await bare.plugin(BoardService, {})
    bare.provide('agents', { get: () => undefined } as never)
    bare.provide('subagents', { start: () => Promise.resolve(run('completed')) } as never)
    await bare.plugin(BoardExecutor, {})
    expect(() => bare.boardExecutor.dispatch({ workspaceId: 'ws-1' })).toThrow('no subagent provider configured')
  }, 30_000)

  it('dispatches automatically on a committed board change and contains a provider failure', async () => {
    const { ctx } = await mount({ config: { provider: 'fake', maxConcurrent: 1, useWorktrees: true, auto: true } })
    const task = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Auto', createdBy: SessionId('owner') })
    // Drive one automatic pass explicitly so the assertion never races the create's own notification.
    ctx.emit('board/changed')
    await waitFor(async () => (await ctx.board.get(task.id)).status === 'review')

    const rejecting = await mount({ config: { provider: 'fake', maxConcurrent: 1, useWorktrees: false, auto: true }, rejectStart: true })
    const failing = await rejecting.ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Reject', createdBy: SessionId('owner') })
    rejecting.ctx.emit('board/changed')
    // The automatic pass swallows the provider rejection and releases the claimed task as blocked.
    await waitFor(async () => (await rejecting.ctx.board.get(failing.id)).status === 'blocked')
    expect((await rejecting.ctx.board.get(failing.id)).status).toBe('blocked')
  }, 30_000)

  it('takes a provider override for one pass', async () => {
    const { ctx } = await mount({ config: { maxConcurrent: 1, useWorktrees: false } })
    const task = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Override', createdBy: SessionId('owner') })
    const outcome = await ctx.boardExecutor.dispatch({ workspaceId: 'ws-1', provider: 'override' })
    expect(outcome.started).toEqual([String(task.id)])
    await waitFor(async () => (await ctx.board.get(task.id)).status === 'review')

    const creatorless = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Parent supplied' })
    const withParent = await ctx.boardExecutor.dispatch({ workspaceId: 'ws-1', provider: 'override', parent: agent('owner') })
    expect(withParent.started).toEqual([String(creatorless.id)])
  }, 30_000)

  it('contains an automatic pass failure and closes its controller on dispose', async () => {
    const notGit = await mkdtemp(join(tmpdir(), 'dsh-exec-notgit-'))
    roots.push(notGit)
    const { ctx } = await mount({ config: { provider: 'fake', maxConcurrent: 1, useWorktrees: true, auto: true }, registryPath: notGit })
    const task = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Broken', createdBy: SessionId('owner') })
    ctx.emit('board/changed')
    await new Promise(resolve => setTimeout(resolve, 50))
    // The worktree creation failed inside the automatic pass, which contained the error.
    expect((await ctx.board.get(task.id)).status).toBe('backlog')
    await ctx.fiber.dispose()

    const plain = await mount({ config: { provider: 'fake', maxConcurrent: 1, useWorktrees: false } })
    await plain.ctx.fiber.dispose()
  }, 30_000)

  it('skips a task whose creator has no live agent', async () => {
    const { ctx } = await mount({ config: { provider: 'fake', maxConcurrent: 1, useWorktrees: false } })
    const task = await ctx.board.create({ workspaceId: WorkspaceId('ws-1'), title: 'Orphan', createdBy: SessionId('gone') })
    const outcome = await ctx.boardExecutor.dispatch({ workspaceId: 'ws-1' })
    expect(outcome.skipped).toEqual([String(task.id)])
    expect(String(task.id)).toBe(String(BoardTaskId(String(task.id))))
  }, 30_000)
})
