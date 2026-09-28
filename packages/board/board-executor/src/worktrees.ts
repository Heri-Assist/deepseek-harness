/**
 * Git worktree isolation for a dispatched task: one worktree and one branch
 * per task under a configured root outside the repository.
 *
 * @module @deepseek-ai/dsh-board-executor
 */

import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One created worktree. */
export interface WorktreeRef {
  /** Absolute worktree path. */
  readonly path: string
  /** Branch checked out in it. */
  readonly branch: string
}

/** Replace characters that cannot appear in a worktree directory name. */
function sanitize(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9._-]/gu, '_')
}

/** Creates and removes one git worktree per task under a single root. */
export class WorktreeManager {
  private readonly root: string
  private readonly branchPrefix: string

  /**
   * @param root - absolute directory holding every worktree; created on demand.
   * @param branchPrefix - branch-name prefix for created worktrees.
   */
  constructor(root: string, branchPrefix = 'board/') {
    this.root = root
    this.branchPrefix = branchPrefix
  }

  /**
   * Create a worktree and branch for one task.
   * @param taskId - task identity used in the branch and directory names.
   * @param workspace - the repository the task works in.
   * @returns the created worktree.
   */
  async create(taskId: string, workspace: string): Promise<WorktreeRef> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const branch = `${this.branchPrefix}${sanitize(taskId)}`
    const path = join(this.root, sanitize(taskId))
    await execFileAsync('git', ['-C', workspace, 'worktree', 'add', '-b', branch, path])
    return { path, branch }
  }

  /**
   * Remove one worktree, discarding uncommitted changes.
   * @param path - the worktree path returned by {@link create}.
   * @param workspace - the repository the worktree belongs to.
   */
  async remove(path: string, workspace: string): Promise<void> {
    await execFileAsync('git', ['-C', workspace, 'worktree', 'remove', '--force', path])
  }

  /**
   * List the worktrees registered for one repository.
   * @param workspace - the repository to inspect.
   * @returns absolute worktree paths, including the main checkout.
   */
  async list(workspace: string): Promise<string[]> {
    const { stdout } = await execFileAsync('git', ['-C', workspace, 'worktree', 'list', '--porcelain'])
    return stdout.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length))
  }

  /**
   * Merge one task's branch into the repository's current branch, then remove
   * its worktree. A conflict aborts the merge and leaves both the branch and
   * the worktree in place for a human.
   * @param ref - the worktree returned by {@link create}.
   * @param workspace - the repository the worktree belongs to.
   * @throws when the merge conflicts or the repository is not a clean checkout.
   */
  async merge(ref: WorktreeRef, workspace: string): Promise<void> {
    await execFileAsync('git', ['-C', workspace, 'merge', '--no-edit', ref.branch])
    await this.remove(ref.path, workspace)
  }

  /**
   * Abort an in-progress merge in one repository, restoring its pre-merge state.
   * @param workspace - the repository to reset.
   */
  async abortMerge(workspace: string): Promise<void> {
    await execFileAsync('git', ['-C', workspace, 'merge', '--abort'])
  }
}
