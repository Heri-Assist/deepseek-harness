/** Dispatch orchestration over injected ports. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BoardTaskId, type BoardTask, type BoardUpdateInput } from '@deepseek-ai/dsh-board'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it } from 'vitest'
import { runAuto, runDispatch, type DispatchPorts } from '../src/dispatch.ts'

const WS = WorkspaceId('ws-1')

function task(id: string, over: Partial<BoardTask> = {}): BoardTask {
  return {
    id: BoardTaskId(id),
    workspaceId: WS,
    revision: 1,
    title: id,
    priority: 'normal',
    labels: [],
    status: 'backlog',
    blockedBy: [],
    writeScopes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function agent(id: string): Agent {
  return { session: { header: { id: SessionId(id) } } } as Agent
}

function run(stopReason: string): SubagentRun {
  return { result: Promise.resolve({ stopReason }) } as SubagentRun
}

interface Recorder {
  readonly ports: DispatchPorts
  readonly claims: string[]
  readonly starts: SubagentStartRequest[]
  readonly updates: BoardUpdateInput[]
}

function recorder(
  tasks: BoardTask[],
  resolve: (sessionId: SessionId) => Agent | undefined,
  stopReason = 'completed',
  workspaces: string[] = ['ws-1'],
): Recorder {
  const claims: string[] = []
  const starts: SubagentStartRequest[] = []
  const updates: BoardUpdateInput[] = []
  const ports: DispatchPorts = {
    list: () => Promise.resolve(tasks),
    listWorkspaces: () => Promise.resolve(workspaces),
    get: id => Promise.resolve(tasks.find(t => t.id === id) ?? task(String(id))),
    claim: (id) => {
      claims.push(String(id))
      return Promise.resolve(task(String(id), { status: 'in_progress', revision: 2 }))
    },
    update: (input) => {
      updates.push(input)
      return Promise.resolve(task(String(input.id), { status: input.status ?? 'backlog', revision: input.revision + 1 }))
    },
    resolveAgent: sessionId => resolve(sessionId),
    start: (_provider, request) => {
      starts.push(request)
      return Promise.resolve(run(stopReason))
    },
  }
  return { ports, claims, starts, updates }
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('runDispatch', () => {
  it('claims ready tasks, starts a delegated run, and settles them to review', async () => {
    const tasks = [task('a')]
    const record = recorder(tasks, () => agent('parent'))
    const outcome = await runDispatch(record.ports, {
      workspaceId: 'ws-1', provider: 'test', maxConcurrent: 1, useWorktrees: false,
      parent: agent('parent'), signal: new AbortController().signal,
    })
    await tick()
    expect(outcome).toEqual({ started: [String(tasks[0]?.id)], skipped: [] })
    expect(record.claims).toEqual([String(tasks[0]?.id)])
    expect(record.starts).toHaveLength(1)
    expect(record.updates).toEqual([{ id: tasks[0]?.id, revision: 1, status: 'review' }])
  })

  it('marks a failed run blocked', async () => {
    const tasks = [task('a')]
    const record = recorder(tasks, () => agent('parent'), 'error')
    await runDispatch(record.ports, {
      workspaceId: 'ws-1', provider: 'test', maxConcurrent: 1, useWorktrees: false,
      parent: agent('parent'), signal: new AbortController().signal,
    })
    await tick()
    expect(record.updates[0]?.status).toBe('blocked')
  })

  it('skips a task whose creator session has no live agent', async () => {
    const tasks = [task('a', { createdBy: SessionId('gone') })]
    const record = recorder(tasks, () => undefined)
    const outcome = await runDispatch(record.ports, {
      workspaceId: 'ws-1', provider: 'test', maxConcurrent: 1, useWorktrees: false,
      signal: new AbortController().signal,
    })
    expect(outcome).toEqual({ started: [], skipped: [String(tasks[0]?.id)] })
    expect(record.claims).toEqual([])
  })

  it('runs in the worktree path when isolation is enabled', async () => {
    const tasks = [task('a')]
    const record = recorder(tasks, () => agent('parent'))
    await runDispatch(record.ports, {
      workspaceId: 'ws-1', provider: 'test', maxConcurrent: 1, useWorktrees: true,
      workspacePath: '/repo', parent: agent('parent'), signal: new AbortController().signal,
      createWorktree: () => Promise.resolve({ path: '/worktrees/a' }),
    })
    await tick()
    expect(record.starts[0]?.cwd).toBe('/worktrees/a')
  })

  it('starts a creator-less task with a supplied parent and folds its description into the prompt', async () => {
    const tasks = [task('a', { description: 'extra detail' })]
    const record = recorder(tasks, () => undefined)
    const outcome = await runDispatch(record.ports, {
      workspaceId: 'ws-1', provider: 'test', maxConcurrent: 1, useWorktrees: false,
      parent: agent('parent'), signal: new AbortController().signal,
    })
    expect(outcome).toEqual({ started: [String(tasks[0]?.id)], skipped: [] })
    const prompt = record.starts[0]?.prompt.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    expect(prompt).toContain('extra detail')
  })

  it('omits cwd when worktrees are enabled but no repository path is known, and skips a parentless task', async () => {
    const tasks = [task('a')]
    const record = recorder(tasks, () => agent('parent'))
    await runDispatch(record.ports, {
      workspaceId: 'ws-1', provider: 'test', maxConcurrent: 1, useWorktrees: true,
      parent: agent('parent'), signal: new AbortController().signal,
      createWorktree: () => Promise.resolve({ path: '/worktrees/a' }),
    })
    expect(record.starts[0]?.cwd).toBeUndefined()

    const orphan = recorder([task('b')], () => undefined)
    const outcome = await runDispatch(orphan.ports, {
      workspaceId: 'ws-1', provider: 'test', maxConcurrent: 1, useWorktrees: false,
      signal: new AbortController().signal,
    })
    expect(outcome).toEqual({ started: [], skipped: [String(BoardTaskId('b'))] })
  })
})

describe('runAuto', () => {
  it('dispatches every board workspace', async () => {
    const tasks = [task('a')]
    const record = recorder(tasks, () => agent('parent'), 'completed', ['ws-1', 'ws-2'])
    const outcome = await runAuto(record.ports, {
      provider: 'test', maxConcurrent: 1, useWorktrees: false,
      parent: agent('parent'), signal: new AbortController().signal,
    })
    await tick()
    expect(outcome.started).toEqual([String(tasks[0]?.id), String(tasks[0]?.id)])
  })

  it('skips a workspace whose repository path is unknown when worktrees are on', async () => {
    const tasks = [task('a')]
    const record = recorder(tasks, () => agent('parent'), 'completed', ['known', 'unknown'])
    const outcome = await runAuto(record.ports, {
      provider: 'test', maxConcurrent: 1, useWorktrees: true,
      parent: agent('parent'), signal: new AbortController().signal,
      workspacePath: workspaceId => workspaceId === 'known' ? '/repo' : undefined,
      createWorktree: () => Promise.resolve({ path: '/worktrees/a' }),
    })
    await tick()
    expect(outcome.started).toEqual([String(tasks[0]?.id)])
    expect(record.starts).toHaveLength(1)
  })

  it('skips every workspace when no path resolver is configured', async () => {
    const tasks = [task('a')]
    const record = recorder(tasks, () => agent('parent'))
    const outcome = await runAuto(record.ports, {
      provider: 'test', maxConcurrent: 1, useWorktrees: true,
      parent: agent('parent'), signal: new AbortController().signal,
    })
    expect(outcome).toEqual({ started: [], skipped: [] })
    expect(record.starts).toHaveLength(0)
  })
})
