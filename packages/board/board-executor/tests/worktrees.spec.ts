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
})
