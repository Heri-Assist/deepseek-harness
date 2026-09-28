/**
 * Project-board plugin, browser half: contributes one session-header action
 * that renders the tasks of the project the open session works in. The action
 * resolves the open session's working directory through the sessions client
 * and asks the board Remote namespace for that project's tasks; this plugin
 * holds no transport state.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoardTaskValue, BoardListValue } from '@deepseek-ai/dsh-api-board-controller/types'
import { BoardListAction } from './BoardListAction.tsx'
import type { BoardListInjected } from './BoardListAction.tsx'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-board-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { en, NS, zh, type BoardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project-board list copy. */
    'board': BoardKey
  }
}

export type { BoardListActionProps, BoardListInjected } from './BoardListAction.tsx'

/** Required services: the board Remote client, session cwd lookup, slots, and dictionaries. */
export const inject = ['remote', 'slots', 'locale']

/** The client session-list face this plugin reads; the client Session layer provides it. */
interface SessionListFace {
  readonly list: { getSnapshot(): { byId: Record<string, { cwd?: string } | undefined> } }
}

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-board: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'board-list',
      // Planning state follows the preset label in the header actions band.
      order: 25,
      locale: NS,
      inject: (): BoardListInjected => ({
        // A board is keyed by workspace; the open session's cwd is that key here,
        // because a project's sessions share the directory they work in.
        cwdOf: (sessionId: string): string | undefined => (ctx.get('sessions') as SessionListFace | undefined)?.list.getSnapshot().byId[sessionId]?.cwd,
        list: async (workspaceId: string): Promise<BoardListValue> => {
          const result = await ctx.remote.board.list({ workspaceId })
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
      }),
    }, BoardListAction),
  )
}

/** The task shape a row renders, re-exported for the action's props. */
export type { BoardTaskValue }
