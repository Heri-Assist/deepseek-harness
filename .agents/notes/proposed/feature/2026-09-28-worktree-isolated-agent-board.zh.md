# Agent Note: Worktree-isolated agent board

Status: proposed

[English](2026-09-28-worktree-isolated-agent-board.md) | 中文

## Problem

Agent 工作管理被分散在多个单一用途的原语中。`todo_write` 整体替换每个会话的清单，plan 模式只持久保存一个布尔值并把计划正文留在工具调用历史里，`ctx.goals` 每个会话只拥有一个持久目标，schedule 负责任务提醒，job 跟踪进行中的进程，而实验性的 Agent Teams 看板把任务保存在单个 Lead 会话的日志中。没有任何原语是项目级队列：工作无法比创建它的会话存活更久，无法携带依赖边或写入范围，也无法在没有人打开会话的情况下启动。已发布的组合让并行 agent 共用一个检出，因此重叠编辑只能靠模型自律协调；Agent Teams 包明确声明它不提供 worktree、merge 或文件系统锁。

## Proposal

一个看板能力，包含定义、持久化 provider 与 worktree provider，以及一个 executor，作为一个家族组合在 `packages/board/` 下。

- `@deepseek-ai/dsh-board` 定义 `ctx.board`：任务记录、状态、依赖图、compare-and-set 修订、就绪选择与写入范围冲突检测。它不拥有持久化。
- `@deepseek-ai/dsh-board-storage` 把任务持久化到以 workspace id 为键的 `board` storage domain，并在每次提交变更后发出 `board/changed`。
- `@deepseek-ai/dsh-board-worktrees` 负责 git worktree 的创建、列出、删除、清理与 merge-back，根目录配置在仓库之外。
- `@deepseek-ai/dsh-board-executor` 监听 `board/changed`，选择可派发的任务，并通过 `ctx.subagents` 从各自的 worktree 启动每个任务。
- `@deepseek-ai/dsh-tool-board` 注册模型工具，`@deepseek-ai/dsh-command-board` 提供面向人的 `/board` 命令，`packages/client/ui-board` 在 Web 客户端渲染看板。
- [分层 agent 记忆](2026-09-28-layered-agent-memory.zh.md) 提供被派发运行所接收并回写的每任务上下文。

### Task model

`BoardTask` 携带品牌化 id、workspace id、修订号、标题、描述、优先级、标签、状态、`blockedBy` 任务 id、`writeScopes`、负责人、执行记录与记忆引用。存储的状态为 `backlog`、`in_progress`、`review`、`done`、`cancelled` 与 `blocked`。就绪是派生的，不存储：当所有阻塞任务都完成时，backlog 任务即就绪，与 Agent Teams 的 `taskReady` 推导一致。每次变更都是对修订号的 compare-and-set，因此两个派发者无法认领同一任务。

### Dispatch and isolation

executor 在每次 `board/changed` 和每次运行结算时重新计算就绪集合。只有当进行中的任务数低于配置上限，且该任务的 `writeScopes` 与任何运行中任务都不重叠时，才会接纳一个就绪任务；重叠的任务在队列中等待。每个被接纳的任务获得一个分支与一个 worktree、一个以该 worktree 为工作目录启动的 subagent，以及关联的会话 id 与 job id。结算时任务进入 `review`，绝不直接进入 `done`：完成路径挂载本次运行改动的文件与已呈现的交付物，然后通知所属会话。失败会把任务置为 `blocked` 并记录原因、递增尝试计数；重试策略由配置决定。合并是显式的 `board_complete` 操作，因此冲突会变成带有记录原因的阻塞任务，而不是静默的错误集成。

### Subagent working-directory seam

`SubagentStartRequest` 没有工作目录字段。进程内子 agent 通过 `childSessionMeta` 继承父会话的 `cwd`，进程外 provider 只接受部署级的 `cwd` 配置。因此 worktree 隔离式派发为该请求扩展一个可选且经校验的 `cwd`：进程内 provider 将其应用到子会话元数据，进程外 provider 用它替代父 cwd。这是 Service Definition 变更：需要更新各 provider、其测试、JSDoc，以及携带该请求的 SDK 投影。另一方案是让 executor 用 `ctx.agents.create` 直接创建子会话，但那会重复委派逻辑并失去工具过滤、persona 与持久 subagent 目录。

### Composition

该家族既可随自身 bundle 发布，也可作为 base 与 web-app bundle 中的条目，并附带 `verify-cordis-config` 要求的依赖声明。worktree 根目录位于 `$DSH_HOME` 下，绝不在仓库内；清理是配置行为而非急切执行。

## Alternatives considered

### Why not extend the Agent Teams board?

Agent Teams 看板已经建模了状态、负责人、依赖与 compare-and-set 修订，但其任务存在于单个 Lead 会话日志中，其成员共用一个检出。就地扩展它，要么保留本提案旨在移除的会话级生命周期，要么为既有回放改变其持久事件的含义。新看板借用其任务图推导，并把团队协调界面留给该包。

### Why not one board per session?

会话级看板正是 `todo_write` 与 Agent Teams 看板已经提供的东西。它无法在会话删除后存活，无法表达等待其他会话完成依赖的工作，也没有跨重启持久化的位置。以 workspace 为键的项目级范围，是排队工作能比一次对话存活更久的最小范围。

### Why not a shared checkout with serialized dispatch?

executor 可以把并发限制为在项目检出上一次一个任务，并完全跳过 worktree。这消除了合并路径，但让每个任务都编辑实时工作树，因此中断或失败的运行会在工作目录留下部分改动，且没有运行能被隔离审查。worktree 的代价是合并步骤与磁盘，换来回滚、审查与不相交工作的并行。

### Why not auto-merge on completion?

自动合并会让闭环无需人工步骤，但循环中途失败的合并会破坏项目检出并隐藏是哪个任务造成的。review 状态加显式完成操作让每次集成都成为具名、可审计的行为；该步骤的自动化可以之后叠加，而无需改变任务模型。

## Acceptance criteria

- 两个并发派发者无法启动同一任务；第二次 compare-and-set 失败，且不会启动重复运行。
- executor 绝不运行写入范围重叠的两个任务，也绝不超过配置的进行中上限。
- 每个被派发的任务都在自己的 worktree 中运行；项目检出只通过显式的 `board_complete` 合并发生变化。
- 结算的运行把任务置为 `review`，并关联会话、job、改动文件与交付物；失败的运行把任务置为 `blocked`，附原因并递增尝试计数。
- subagent 的 `cwd` 扩展通过真实 Loader 组合在 product-visible 测试中被执行，且 SDK 投影反映新增字段。

## Risks

- worktree 隔离假设项目是 git 仓库；不是仓库的项目需要文档化的共享检出回退，或者根本不执行看板派发。
- 从看板服务派发 agent 会跨越请求工作者的权限边界；executor 继承 subagent 权限范围且无法扩大它，因此被拒绝的操作必须表现为被阻塞的任务，而不是自动批准。
- 累积的 `review` 任务是预期的安全阀，也是有运营成本的一项；没有配置清理策略时，未清理的 worktree 根目录会持续增长。
- 派发 subagent 的看板服务使看板成为长期存活的 host 服务；其自身生命周期、重启恢复与重启后的重复派发防护需要显式处理。