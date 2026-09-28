// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { BoardTaskValue } from '@deepseek-ai/dsh-api-board-controller/types'
import { BoardListAction, type BoardListActionProps } from '../src/client/BoardListAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: BoardListActionProps['t'] = makeTranslate(zh)

function task(over: Partial<BoardTaskValue> = {}): BoardTaskValue {
  return {
    id: 'task-1',
    workspaceId: 'ws-1',
    revision: 1,
    title: 'Write the parser',
    priority: 'normal',
    labels: [],
    status: 'backlog',
    blockedBy: [],
    writeScopes: [],
    ready: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function props(over: Partial<BoardListActionProps> = {}): BoardListActionProps {
  return {
    sessionId: 's-1' as never,
    t,
    cwdOf: () => '/work/ws-1',
    list: async () => ({ tasks: [] }),
    ...over,
  } as BoardListActionProps
}

async function openBoard(element: React.ReactElement): Promise<void> {
  render(element)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['list.aria'] })) })
}

describe('BoardListAction', () => {
  it('summarizes ready work on the trigger', async () => {
    await openBoard(<BoardListAction {...props({ list: async () => ({ tasks: [task()] }) })} />)
    expect(within(screen.getByRole('button', { name: zh['list.aria'] })).getByText(zh['summary.ready.one'].replace('{count}', '1'))).toBeTruthy()
  })

  it('groups tasks by column and marks ready and blocked rows', async () => {
    const tasks = [
      task({ id: 'a', title: 'Ready task', ready: true }),
      task({ id: 'b', title: 'Running task', status: 'in_progress', ready: false }),
      task({ id: 'c', title: 'Blocked task', blockedBy: ['a', 'b'], ready: false }),
    ]
    await openBoard(<BoardListAction {...props({ list: async () => ({ tasks }) })} />)
    const region = screen.getByRole('region', { name: zh['list.aria'] })
    expect(within(region).getByText('Ready task')).toBeTruthy()
    expect(within(region).getByText('Running task')).toBeTruthy()
    expect(within(region).queryByText(zh['column.done'])).toBeNull()
    expect(within(region).getByText(zh['task.ready'])).toBeTruthy()
    expect(within(region).getByText(zh['task.blockedBy'].replace('{count}', '2'))).toBeTruthy()
  })

  it('renders every status marker, including settled and blocked work', async () => {
    const statuses = ['backlog', 'in_progress', 'review', 'blocked', 'done', 'cancelled'] as const
    const tasks = statuses.map((status, index) => task({ id: `t${index}`, title: `Task ${status}`, status, ready: false }))
    await openBoard(<BoardListAction {...props({ list: async () => ({ tasks }) })} />)
    const region = screen.getByRole('region', { name: zh['list.aria'] })
    for (const status of statuses) expect(within(region).getByText(zh[`column.${status}`])).toBeTruthy()
    expect(within(region).getByText('Task done')).toBeTruthy()
    expect(within(region).getByText('Task cancelled')).toBeTruthy()
  })

  it('clears a loaded board when the popover is closed', async () => {
    await openBoard(<BoardListAction {...props({ list: async () => ({ tasks: [task()] }) })} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['list.aria'] })) })
    expect(screen.queryByRole('region', { name: zh['list.aria'] })).toBeNull()
  })

  it('summarizes plural running work and plural ready work', async () => {
    const running = [
      task({ id: 'a', title: 'One', status: 'in_progress', ready: false }),
      task({ id: 'b', title: 'Two', status: 'in_progress', ready: false }),
    ]
    await openBoard(<BoardListAction {...props({ list: async () => ({ tasks: running }) })} />)
    expect(within(screen.getByRole('button', { name: zh['list.aria'] })).getByText(zh['summary.running.other'].replace('{count}', '2'))).toBeTruthy()

    cleanup()
    const ready = [task({ id: 'a' }), task({ id: 'b' })]
    await openBoard(<BoardListAction {...props({ list: async () => ({ tasks: ready }) })} />)
    expect(within(screen.getByRole('button', { name: zh['list.aria'] })).getByText(zh['summary.ready.other'].replace('{count}', '2'))).toBeTruthy()
  })

  it('renders without a session identity', async () => {
    // No session id means no workspace key, so the popover stays empty.
    await openBoard(<BoardListAction {...props({ sessionId: undefined as never, cwdOf: () => undefined })} />)
    expect(screen.getByRole('region', { name: zh['list.aria'] })).toBeTruthy()
    expect(screen.queryByText('Write the parser')).toBeNull()
  })

  it('reports the summary as an empty board while the read is pending', async () => {
    render(<BoardListAction {...props({ list: () => new Promise(() => {}) })} />)
    expect(screen.getByRole('button', { name: zh['list.aria'] }).textContent).toBe(zh['list.aria'])
  })

  it('reports a non-Error load failure as text', async () => {
    await openBoard(<BoardListAction {...props({ list: async () => { throw 'plain failure' } })} />)
    expect(screen.getByText(zh['list.error'].replace('{error}', 'plain failure'))).toBeTruthy()
  })

  it('reports an empty board', async () => {
    await openBoard(<BoardListAction {...props()} />)
    expect(screen.getByText(zh['list.empty'])).toBeTruthy()
  })

  it('reports a load failure', async () => {
    await openBoard(<BoardListAction {...props({ list: async () => { throw new Error('offline') } })} />)
    expect(screen.getByText(zh['list.error'].replace('{error}', 'offline'))).toBeTruthy()
  })

  it('shows the empty board when the session has no working directory', async () => {
    await openBoard(<BoardListAction {...props({ cwdOf: () => undefined, list: async () => ({ tasks: [task()] }) })} />)
    // No workspace key means no read is attempted, so the popover stays empty.
    expect(screen.queryByText('Write the parser')).toBeNull()
  })
})
