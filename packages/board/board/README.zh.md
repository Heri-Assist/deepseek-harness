---
description: "面向维护者与部署者的项目级 agent 任务看板，支持依赖就绪选择与 compare-and-set 写入，用于跨会话编排工作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-board

[English](README.md) | 中文

## 概述

`dsh-board` 为一个项目提供一个能在会话之后存活的持久工作队列：任务带有标题、优先级、标签、依赖边与预期写入范围。任务经历 `backlog`、`in_progress`、`review`、`done`、`cancelled` 与 `blocked`；就绪由依赖图推导而非存储，因此当所有阻塞任务完成时任务即就绪。每次变更都是对修订号的 compare-and-set，因此两个调用方不会静默互相覆盖。任务按 workspace 存储，因此该看板由在该目录工作的每个会话共享。用它跟踪跨会话的多步 agent 工作。

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

在存储枢纽提供后端与 domain facility 之后挂载它。活动的根 Agent 随即获得看板工具。

```yaml
- name: '@deepseek-ai/dsh-board'
  config:
    maxTasksPerWorkspace: 256
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxTasksPerWorkspace` | `256` | 每个 workspace 保留的任务数；超出上限的创建会被拒绝 |

生成式[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-board)是这些已接受字段的详尽来源。

### 每次调用的行为

`board_create` 添加一个 `backlog` 任务。`board_list` 读取一个看板，可选只返回就绪任务。`board_get` 按 id 读取一个任务。`board_update`、`board_complete` 与 `board_claim` 修改一个任务并要求当前修订号；过期修订会失败，调用方必须重新读取。依赖环、缺失的阻塞任务、自阻塞以及超过上限的写入都会在存储之前被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`BoardService` 打开版本 1 的 `board` 存储 domain，并保留一张以任务 id 为键的 `tasks` 表，每条记录带有 `workspaceId`。变更通过进程本地的串行链执行，因此 compare-and-set 不会与同进程内的另一次写入竞争；每次提交写入都会发出 `board/changed`。就绪是任务及其阻塞任务的纯函数，依赖图在每次写入时都会被校验为无环。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `BoardService`、配置、图校验、就绪推导、串行 CAS 变更 |
| [`src/schema.ts`](src/schema.ts) | 版本 1 的看板 domain schema |
| [`src/types.ts`](src/types.ts) | 任务、状态、优先级、负责人与输入类型 |
| [`src/tools.ts`](src/tools.ts) | `board_*` 工具 schema |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [看板子系统](../../../docs/subsystems/board.zh.md) — 任务、状态与依赖词汇。
- [存储子系统](../../../docs/subsystems/storage.zh.md) — 看板据以存储的持久存储枢纽。

-----

<a id="model-experience"></a>
## 模型体验

### 看板工具

#### 模型看到什么

活动的根 Agent 获得 `board_create`、`board_list`、`board_get`、`board_update`、`board_complete` 与 `board_claim`。每个任务呈现为 `- <id> r<revision> [<status>/<priority>] <title>`，存在阻塞时附带 blockers。schema 来源是 [`src/tools.ts`](src/tools.ts)。

#### Token 影响

六个工具 schema 加入每个活动的根 Agent 请求；列表为每个匹配任务返回一行。

#### KV Cache 影响

六个 schema 在插件挂载时改变一次请求前缀。列表结果是该前缀之后的工具结果内容，因此既有缓存条目不会被失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 自动派发被推迟：看板记录并选择就绪任务，但它自身不启动 agent、不创建 worktree，也不合并结果。
- 写入范围是建议性的：看板存储它们供未来的派发器串行化使用；目前没有任何东西强制执行路径归属。
- 会话结束后，除非调用方持续读取，没有任何东西消费看板任务；目前没有调度器、重试策略或通知。
- 看板只能通过工具读写；目前尚不提供 Web 看板 UI。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
