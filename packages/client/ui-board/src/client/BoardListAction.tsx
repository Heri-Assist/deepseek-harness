import { useEffect, useMemo, useState } from 'react'
import type { BoardListValue, BoardTaskValue } from '@deepseek-ai/dsh-api-board-controller/types'
import { StateDot, useDismissOnOutsidePointer, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './BoardListAction.module.css'

/** Registration-side business face for the project board. */
export interface BoardListInjected {
  /** The open session's working directory, the board key its project sessions share. */
  cwdOf: (sessionId: string) => string | undefined
  /** Read one workspace's tasks through the board Remote namespace. */
  list: (workspaceId: string) => Promise<BoardListValue>
}

/** Full props for the session-header board-list action. */
export type BoardListActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<BoardListInjected>

/** The board columns a task can occupy, in display order. */
const COLUMNS: readonly BoardTaskValue['status'][] = ['backlog', 'in_progress', 'review', 'blocked', 'done', 'cancelled']

/** Status marker semantics: an in-flight, blocked, or settled task. */
function dotState(status: BoardTaskValue['status']): StateDotState {
  switch (status) {
    case 'in_progress': return 'ongoing'
    case 'blocked': return 'warning'
    case 'done': return 'done'
    case 'cancelled': return 'warning'
    case 'review': return 'ongoing'
    case 'backlog': return 'idle'
    /* v8 ignore next -- closed wire status union */
    default: return 'idle'
  }
}

/** The summary line: running work first, then ready work, then an empty board. */
function summary(tasks: readonly BoardTaskValue[], t: TranslateNS<typeof NS>): string {
  const running = tasks.filter(task => task.status === 'in_progress').length
  const ready = tasks.filter(task => task.ready).length
  if (running > 0) return t(running === 1 ? 'summary.running.one' : 'summary.running.other', { count: running })
  if (ready > 0) return t(ready === 1 ? 'summary.ready.one' : 'summary.ready.other', { count: ready })
  return t('summary.empty')
}

/** Whether the popover lists a settlement column with no tasks. */
function visibleColumns(tasks: readonly BoardTaskValue[]): readonly BoardTaskValue['status'][] {
  return COLUMNS.filter(column => tasks.some(task => task.status === column))
}

/**
 * Session-header action listing the open project's board tasks.
 * @param props - runtime session, translated copy, and the board client face.
 * @returns the header trigger and its task popover.
 */
export function BoardListAction({ sessionId, t, cwdOf, list }: BoardListActionProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<readonly BoardTaskValue[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const root = useMemo(() => ({ current: null as HTMLDivElement | null }), [])
  /* v8 ignore next -- outside-pointer dismissal is the shared primitive's own contract */
  useDismissOnOutsidePointer(root, open, () => { setOpen(false) })

  const workspaceId = sessionId === undefined ? undefined : cwdOf(sessionId)
  useEffect(() => {
    if (open) return
    setTasks(undefined)
    setError(undefined)
  }, [open])

  useEffect(() => {
    if (!open || workspaceId === undefined) return
    let cancelled = false
    void list(workspaceId).then(
      /* v8 ignore start -- the cancelled guard fires only when the component unmounts mid-read */
      (value) => { if (!cancelled) setTasks(value.tasks) },
      (failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)) },
      /* v8 ignore stop */
    )
    return () => { cancelled = true }
  }, [open, workspaceId, list])

  return (
    <div className={css.root} ref={root}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('list.aria')}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        {tasks === undefined ? t('list.aria') : summary(tasks, t)}
      </button>
      {open && (
        <div className={css.popover} role="region" aria-label={t('list.aria')}>
          {error !== undefined && <p className={css.error}>{t('list.error', { error })}</p>}
          {error === undefined && tasks === undefined && <p className={css.empty}>{t('list.loading')}</p>}
          {error === undefined && tasks !== undefined && tasks.length === 0 && <p className={css.empty}>{t('list.empty')}</p>}
          {error === undefined && tasks !== undefined && visibleColumns(tasks).map(column => (
            <div key={column} className={css.column}>
              <p className={css['column-title']}>{t(`column.${column}`)}</p>
              {tasks.filter(task => task.status === column).map(task => (
                <div key={task.id} className={css.task}>
                  <StateDot state={dotState(task.status)} />
                  <span className={css['task-title']}>{task.title}</span>
                  {task.ready && <span className={css['task-ready']}>{t('task.ready')}</span>}
                  {!task.ready && task.blockedBy.length > 0 && (
                    <span className={css['task-blocked']}>{t('task.blockedBy', { count: task.blockedBy.length })}</span>
                  )}
                  <span className={css.priority}>{t(`priority.${task.priority}`)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
