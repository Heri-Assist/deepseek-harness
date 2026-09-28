/** `board` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'board'

/** How many tasks the header summary counts before it says "more". */
export const SUMMARY_MAX = 3

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'summary.empty': '看板为空',
  'summary.ready.one': '{count} 个任务可就绪',
  'summary.ready.other': '{count} 个任务可就绪',
  'summary.running.one': '{count} 个任务进行中',
  'summary.running.other': '{count} 个任务进行中',
  'list.aria': '项目任务看板',
  'list.empty': '此项目暂无任务。',
  'list.loading': '正在加载任务…',
  'list.error': '无法加载看板：{error}',
  'column.backlog': '待办',
  'column.in_progress': '进行中',
  'column.review': '待审',
  'column.done': '已完成',
  'column.blocked': '受阻',
  'column.cancelled': '已取消',
  'task.ready': '可开始',
  'task.blockedBy': '等待 {count} 个前置任务',
  'task.updated': '更新于 {time}',
  'priority.high': '高',
  'priority.normal': '中',
  'priority.low': '低',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<BoardKey, string> = {
  'summary.empty': 'Board is empty',
  'summary.ready.one': '{count} task ready',
  'summary.ready.other': '{count} tasks ready',
  'summary.running.one': '{count} task in progress',
  'summary.running.other': '{count} tasks in progress',
  'list.aria': 'Project task board',
  'list.empty': 'No tasks on this project yet.',
  'list.loading': 'Loading tasks…',
  'list.error': 'The board failed to load: {error}',
  'column.backlog': 'Backlog',
  'column.in_progress': 'In progress',
  'column.review': 'Review',
  'column.done': 'Done',
  'column.blocked': 'Blocked',
  'column.cancelled': 'Cancelled',
  'task.ready': 'Ready',
  'task.blockedBy': 'Waiting on {count} task(s)',
  'task.updated': 'Updated {time}',
  'priority.high': 'High',
  'priority.normal': 'Normal',
  'priority.low': 'Low',
}

/** Key domain of the `board` namespace (zh is the source of truth). */
export type BoardKey = keyof typeof zh
