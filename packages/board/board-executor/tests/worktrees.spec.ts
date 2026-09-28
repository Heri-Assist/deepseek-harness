/** Git worktree isolation against a real repository. */
import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from '../src/worktrees.ts'

const execFileAsync = promisify(execFile)

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function gitRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-wt-repo-'))
  roots.push(repo)
  await execFileAsync('git', ['-C', repo, 'init'])
  await execFileAsync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
  await execFileAsync('git', ['-C', repo, 'config', 'user.name', 'Test'])
  await writeFile(join(repo, 'README.md'), 'hi\n')
  await execFileAsync('git', ['-C', repo, 'add', '.'])
  await execFileAsync('git', ['-C', repo, 'commit', '-m', 'init'])
  return repo
}

describe('WorktreeManager', () => {
  it('creates a branch and worktree, lists it, and removes it', async () => {
    const repo = await gitRepo()
    const root = await mkdtemp(join(tmpdir(), 'dsh-wt-root-'))
    roots.push(root)
    const manager = new WorktreeManager(root)

    const ref = await manager.create('task-1', repo)
    expect(ref.branch).toBe('board/task-1')
    expect(existsSync(ref.path)).toBe(true)
    expect(await manager.list(repo)).toContain(realpathSync(ref.path))

    await manager.remove(ref.path, repo)
    expect(existsSync(ref.path)).toBe(false)
  }, 30_000)

  it('merges a task branch back into the repository and removes its worktree', async () => {
    const repo = await gitRepo()
    const root = await mkdtemp(join(tmpdir(), 'dsh-wt-merge-'))
    roots.push(root)
    const manager = new WorktreeManager(root)

    const ref = await manager.create('task-merge', repo)
    await writeFile(join(ref.path, 'work.txt'), 'from the task\n')
    await execFileAsync('git', ['-C', ref.path, 'add', '.'])
    await execFileAsync('git', ['-C', ref.path, 'commit', '-m', 'task work'])

    await manager.merge(ref, repo)
    expect(existsSync(join(repo, 'work.txt'))).toBe(true)
    expect(existsSync(ref.path)).toBe(false)
  }, 30_000)

  it('leaves a conflicted merge in place so a human resolves it', async () => {
    const repo = await gitRepo()
    const root = await mkdtemp(join(tmpdir(), 'dsh-wt-conflict-'))
    roots.push(root)
    const manager = new WorktreeManager(root)

    const ref = await manager.create('task-conflict', repo)
    await writeFile(join(ref.path, 'README.md'), 'task version\n')
    await execFileAsync('git', ['-C', ref.path, 'commit', '-am', 'task edit'])
    await writeFile(join(repo, 'README.md'), 'main version\n')
    await execFileAsync('git', ['-C', repo, 'commit', '-am', 'main edit'])

    await expect(manager.merge(ref, repo)).rejects.toThrow()
    expect(existsSync(join(ref.path, 'README.md'))).toBe(true)
    await manager.abortMerge(repo)
    expect((await manager.list(repo)).map(path => realpathSync(path))).toContain(realpathSync(ref.path))
  }, 30_000)
})
