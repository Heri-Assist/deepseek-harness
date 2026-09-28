/** Dispatch planning: ready selection, WIP budget, and scope disjointness. */
import { BoardTaskId, type BoardTask } from '@deepseek-ai/dsh-board'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it } from 'vitest'
import { planDispatch, scopesOverlap } from '../src/plan.ts'

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

describe('scopesOverlap', () => {
  it('treats an empty scope set as conflicting with everything', () => {
    expect(scopesOverlap([], ['src/a.ts'])).toBe(true)
    expect(scopesOverlap(['src/a.ts'], [])).toBe(true)
  })

  it('detects shared and disjoint paths', () => {
    expect(scopesOverlap(['src/a.ts', 'src/b.ts'], ['src/b.ts'])).toBe(true)
    expect(scopesOverlap(['src/a.ts'], ['src/b.ts'])).toBe(false)
  })

  it('treats a literal and a matching glob as conflicting', () => {
    expect(scopesOverlap(['src/**'], ['src/a/b.ts'])).toBe(true)
    expect(scopesOverlap(['src/a/b.ts'], ['src/**'])).toBe(true)
    expect(scopesOverlap(['src/**'], ['test/a.ts'])).toBe(false)
  })

  it('treats two globs as conflicting when one static prefix contains the other', () => {
    expect(scopesOverlap(['src/**/*.ts'], ['src/a/*.ts'])).toBe(true)
    expect(scopesOverlap(['src/**/*.ts'], ['test/**/*.ts'])).toBe(false)
  })
})

describe('planDispatch', () => {
  it('admits ready, scope-disjoint tasks up to the WIP budget', () => {
    const tasks = [
      task('a', { writeScopes: ['src/a.ts'] }),
      task('b', { writeScopes: ['src/b.ts'] }),
      task('c', { writeScopes: ['src/c.ts'] }),
    ]
    expect(planDispatch(tasks, 2).map(t => t.id)).toEqual(['a', 'b'])
  })

  it('skips a task overlapping a running one', () => {
    const tasks = [
      task('running', { status: 'in_progress', writeScopes: ['src/a.ts'] }),
      task('conflict', { writeScopes: ['src/a.ts'] }),
      task('free', { writeScopes: ['src/b.ts'] }),
    ]
    expect(planDispatch(tasks, 2).map(t => t.id)).toEqual(['free'])
  })

  it('returns nothing when the in-progress count reached the budget', () => {
    const tasks = [
      task('running', { status: 'in_progress', writeScopes: ['src/a.ts'] }),
      task('next', { writeScopes: ['src/b.ts'] }),
    ]
    expect(planDispatch(tasks, 1)).toEqual([])
  })

  it('excludes a task whose blocker is not done, and orders by priority', () => {
    const tasks = [
      task('blocked', { blockedBy: [BoardTaskId('gate')], writeScopes: ['src/b.ts'] }),
      task('gate', { writeScopes: ['src/gate.ts'] }),
      task('low', { priority: 'low', writeScopes: ['src/c.ts'] }),
      task('high', { priority: 'high', writeScopes: ['src/d.ts'] }),
    ]
    expect(planDispatch(tasks, 3).map(t => t.id)).toEqual(['high', 'gate', 'low'])
  })
})
