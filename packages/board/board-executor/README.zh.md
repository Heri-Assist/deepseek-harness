---
description: "面向维护者与部署者的宿主级看板派发器：把就绪任务转换为委派 subagent 运行，用于自动化项目工作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-board-executor

[English](README.md) | 中文

## 概述

`dsh-board-executor` 把看板变成正在运行的工作。它规划已就绪且写入范围不与运行中任务冲突的任务（上限为并发数），对每个任务执行 compare-and-set 认领，并为每个任务启动一次委派 subagent 运行。每次运行都可以在自己的 git worktree 中执行，因此任务编辑的是隔离检出而非共享检出。运行结束时，executor 把任务置为 `review`，失败时置为 `blocked`。派发器是宿主服务；目前还没有模型工具调用它。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

把它与 [`@deepseek-ai/dsh-board`](../board/README.zh.md) 以及一个 subagent provider 一起挂载。宿主调用方随后为每个看板运行一次派发。

```yaml
- name: '@deepseek-ai/dsh-board-executor'
  config:
    provider: spawn
    maxConcurrent: 1
    useWorktrees: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | 每次派发必填 | 具名 subagent provider；单次请求可覆盖 |
| `maxConcurrent` | `1` | 允许同时处于 `in_progress` 的最大任务数 |
| `useWorktrees` | `true` | 让每个任务在自己的 git worktree 中运行 |
| `worktreeRoot` | `$DSH_HOME/worktrees` | 存放所创建工作树的目录 |
| `branchPrefix` | `board/` | 所创建工作树的分支名前缀 |
| `auto` | `false` | 在每次已提交的看板变更时自动派发 |

生成式[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-board-executor)是这些已接受字段的详尽来源。

### 一次派发如何解析父 agent

每次委派运行都需要一个父 Agent。调用方提供显式 `parent` 时使用它；否则通过 agent 注册表解析任务的 `createdBy` 会话。无法解析父 agent 的任务会被跳过，而不是失败。

### 自动派发

开启 `auto: true`（需要配置 `provider`）后，executor 订阅 `board/changed`，为每个看板 workspace 排空一次派发，并合并派发运行期间到达的变更。它为 worktree 隔离从 workspace 注册表解析每个 workspace 的仓库路径，并在启用 worktrees 时跳过没有已注册路径的 workspace。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`planDispatch` 是纯函数：过滤就绪任务（状态为 `backlog` 且所有阻塞任务为 `done`），按优先级再按时间排序，并在进行中预算允许且写入范围不与运行中或已选中任务重叠时接纳。空 scope 集合视为未知，会与一切冲突。随后 `runDispatch` 认领每个被选中的任务，在开启隔离时创建工作树，以该工作树作为 `cwd` 启动运行，并在完成时结算任务。`WorktreeManager` 通过 shell 调用 `git worktree`。不发布 invariant 伴随包，因为派发器收容每次派发的失败。

| 文件 | 作用 |
|---|---|
| [`src/plan.ts`](src/plan.ts) | 就绪选择、WIP 预算与 scope 不相交判断 |
| [`src/dispatch.ts`](src/dispatch.ts) | 在注入端口上的认领、启动与结算 |
| [`src/worktrees.ts`](src/worktrees.ts) | git worktree 的创建、列出与删除 |
| [`src/index.ts`](src/index.ts) | `BoardExecutor`、配置与面向宿主的 `dispatch` 调用 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [看板包](../board/README.zh.md) — 此派发器读取并结算的任务。
- [Subagent 子系统](../../../docs/subsystems/subagent.zh.md) — 它所接受的 `cwd` 与委派运行。
- [看板子系统](../../../docs/subsystems/board.zh.md) — 任务、状态与依赖词汇。

-----

<a id="model-experience"></a>
## 模型体验

Indirectly, through the delegated subagent runs it starts.

#### KV Cache effect

Indirect: each child's cache behavior belongs to its own provider; the dispatcher adds no request content of its own.

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 自动派发从 workspace 注册表解析每个 workspace 的仓库路径；启用 worktrees 时会跳过没有已注册路径的 workspace。未开启 `auto` 时，派发只能由宿主调用。
- 完成的工作树会保留以供审查，从不合并；集成与清理是手动的。
- 写入范围按精确字符串比较；glob 感知的重叠检查被推迟。
- 失败或取消的运行把任务置为 `blocked`；目前没有重试策略或尝试计数。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
