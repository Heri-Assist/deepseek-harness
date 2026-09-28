/**
 * Dispatch planning for the board: which ready tasks may start now, given the
 * in-progress set and the write-scope disjointness rule.
 *
 * @module @deepseek-ai/dsh-board-executor
 */

import type { BoardTask } from '@deepseek-ai/dsh-board'

/** Priority order used to break ties between ready tasks; higher first. */
const PRIORITY_RANK: Record<BoardTask['priority'], number> = { high: 0, normal: 1, low: 2 }

/**
 * Whether two write-scope sets may touch the same paths. An empty set is
 * unknown scope and conflicts with everything, so a task that declares no
 * scopes never runs beside another.
 * @param a - one task's scopes.
 * @param b - the other task's scopes.
 * @returns true when the two tasks may not run concurrently.
 */
export function scopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return true
  return a.some(scope => b.includes(scope))
}

/** Whether a task's blockers have all reached `done`. */
function ready(task: BoardTask, byId: ReadonlyMap<string, BoardTask>): boolean {
  return task.status === 'backlog' && task.blockedBy.every(id => byId.get(id)?.status === 'done')
}

/**
 * Select the ready tasks that may start now.
 * @param tasks - one board's tasks.
 * @param maxConcurrent - maximum tasks allowed in `in_progress` at once.
 * @returns tasks to dispatch, highest priority and oldest first, scopes disjoint.
 */
export function planDispatch(tasks: readonly BoardTask[], maxConcurrent: number): BoardTask[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const running = tasks.filter(task => task.status === 'in_progress')
  const budget = maxConcurrent - running.length
  if (budget <= 0) return []
  const takenScopes: Array<readonly string[]> = running.map(task => task.writeScopes)
  const candidates = tasks.filter(task => ready(task, byId)).sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    return byPriority !== 0 ? byPriority : a.createdAt.localeCompare(b.createdAt)
  })
  const selected: BoardTask[] = []
  for (const candidate of candidates) {
    if (selected.length >= budget) break
    if (takenScopes.some(scopes => scopesOverlap(scopes, candidate.writeScopes))) continue
    selected.push(candidate)
    takenScopes.push(candidate.writeScopes)
  }
  return selected
}
