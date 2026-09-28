# Agent Note: Worktree-isolated agent board

Status: implemented

[English](2026-09-28-worktree-isolated-agent-board.md) | 中文

## Problem

Agent 工作管理被分散在多个单一用途的原语中。`todo_write` 整体替换每个会话的清单，plan 模式只持久保存一个布尔值并把计划正文留在工具调用历史里，`ctx.goals` 每个会话只拥有一个持久目标，schedule 负责任务提醒，job 跟踪进行中的进程，而实验性的 Agent Teams 看板把任务保存在单个 Lead 会话的日志中。没有任何原语是项目级队列：工作无法比创建它的会话存活更久，无法携带依赖边或写入范围，也无法在没有人打开会话的情况下启动。已发布的组合让并行 agent 共用一个检出，因此重叠编辑只能靠模型自律协调；Agent Teams 包明确声明它不提供 worktree、merge 或文件系统锁。

## Decision

一个位于 `packages/board/` 下的看板能力家族、一个位于 `packages/api/` 下的面向宿主的 Remote owner，以及一个位于 `packages/client/` 下的 Web 界面。

- `@deepseek-ai/dsh-board` 定义 `ctx.board`：任务记录、状态、依赖图、compare-and-set 修订与就绪选择。它拥有版本 1 的 `board` 存储 domain（一张以任务 id 为键的 `tasks` 表，每条记录带所属 workspace），并注册工具 `board_create`、`board_list`、`board_get`、`board_update`、`board_complete`、`board_claim` 与 `board_merge`。变更通过进程本地的串行链执行，因此 compare-and-set 不会与同进程内的另一次写入竞争；每次提交写入都会发出 `board/changed`。就绪是派生的，绝不存储。
- `@deepseek-ai/dsh-board-executor` 负责派发：`planDispatch` 在并发预算内选择就绪且 scope 不相交的任务；`runDispatch` 认领每个任务、创建 git worktree、以该 worktree 为 `cwd` 启动一次委派 subagent 运行，并把任务结算为 `review` 或 `blocked`；`WorktreeManager` 拥有 worktree 的创建、列出、删除、合并与中止。该服务从 workspace 注册表发现每个 workspace 的仓库路径，并在 `auto: true` 时于 `board/changed` 为每个 workspace 排空一次派发。
- `@deepseek-ai/dsh-api-board-controller` 发布 `board` Remote namespace，供浏览器读取与 compare-and-set 写入。
- `@deepseek-ai/dsh-client-ui-board` 渲染会话头部中当前项目任务的只读列表，按状态分组。

### Task model

`BoardTask` 携带品牌化 `BoardTaskId`、所属 `WorkspaceId`、`revision`、`title`、可选 `description`、`BoardPriority`、`labels`、`BoardTaskStatus`、`blockedBy` 任务 id、`writeScopes`、可选 `BoardAssignee`、可选的创建 `SessionId`，以及可选的 `BoardExecution`（尝试计数与最近的工作树路径与分支）。存储的状态为 `backlog`、`in_progress`、`review`、`done`、`cancelled` 与 `blocked`。当所有阻塞任务都为 `done` 时，backlog 任务即就绪。每次变更都会递增 `revision`；过期修订会在任何改变之前以 `BoardConflictError` 被拒绝，且依赖图在每次写入时都会被校验为无环。

### Dispatch and isolation

executor 只有在进行中任务数低于配置上限，且该任务的 `writeScopes` 不与运行中或已被选中的任务重叠时，才接纳一个就绪任务。scope 重叠是 glob 感知的：字面量会与对方的 glob 比对，而两个 glob 在任一静态前缀包含另一个时冲突。空 scope 集合视为未知，会与一切冲突。每个被接纳的任务获得一个分支与一个 worktree、一个以该 worktree 为工作目录启动的 subagent，以及任务上的执行记录。结算时，完成的运行把任务置为 `review`，绝不直接置为 `done`；失败的运行在 `maxAttempts` 允许时重试为 `backlog`，否则保持 `blocked`。合并是针对已存分支的显式 `board_merge` 操作。

### Subagent working-directory field

`SubagentStartRequest` 新增了可选的 `cwd`。进程内 provider 将其记录到子会话以替代父 cwd；进程外 provider 优先使用它而非父与部署 cwd。`SubagentRuntime.start` 将其校验为绝对且可进入的目录。

### Composition

该家族通过可选的 `@deepseek-ai/dsh-experimental-board-bundle` 发布，它插入 `board` 与 `board-executor` 条目，并列在 `OPTIONAL_BUNDLES` 中，因此插件管理器以默认关闭的方式提供它。

## Alternatives considered

### Why not extend the Agent Teams board?

Agent Teams 看板已经建模了状态、负责人、依赖与 compare-and-set 修订，但其任务存在于单个 Lead 会话日志中，其成员共用一个检出。就地扩展它，要么保留本决策旨在移除的会话级生命周期，要么为既有回放改变其持久事件的含义。本看板借用其任务图推导，并把团队协调界面留给该包。

### Why not one board per session?

会话级看板正是 `todo_write` 与 Agent Teams 看板已经提供的东西。它无法在会话删除后存活，无法表达等待其他会话完成依赖的工作，也没有跨重启持久化的位置。以 workspace 为键的项目级范围，是排队工作能比一次对话存活更久的最小范围。

### Why not a shared checkout with serialized dispatch?

executor 可以把并发限制为在项目检出上一次一个任务，并完全跳过 worktree。这消除了合并路径，但让每个任务都编辑实时工作树，因此中断或失败的运行会在工作目录留下部分改动，且没有运行能被隔离审查。worktree 的代价是合并步骤与磁盘，换来回滚、审查与不相交工作的并行。

### Why not auto-merge on completion?

自动合并会让闭环无需人工步骤，但循环中途失败的合并会破坏项目检出并隐藏是哪个任务造成的。review 状态加显式合并操作让每次集成都成为具名、可审计的行为。

### Why not create child sessions directly instead of extending the subagent request?

executor 可以用 `ctx.agents.create` 创建子会话并自行设置 `meta.cwd`。那会重复委派逻辑并失去工具过滤、persona 与持久 subagent 目录。扩展请求让每个需要隔离检出的调用方共用一条委派路径。

## Consequences

- 看板与 executor 是两个包：定义与存储，以及消费它们的派发器。
- worktree 隔离需要 git 仓库；启用 worktrees 时，仓库路径未知的 workspace 会被跳过。
- 派发需要一个活动的父 agent；创建者会话已结束的任务会被跳过，直到调用方提供父 agent。
- UI 是只读的，并在打开时重新读取；它不创建、移动、完成或合并任何内容。
- UI 的看板键是会话的工作目录，因此即使同属一个仓库，两个目录也绝不共享同一个看板。
- 没有运行可结算的启动失败会把已认领任务释放为 `blocked`。
- 未配置 provider 的 `auto: true` 会在加载时失败。
