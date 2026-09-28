---
description: "从插件管理页加入项目任务看板及其派发器。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-board-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 插入随发行版交付的组合所不含的两个看板条目：`board`，它拥有每个 workspace 的持久任务并注册看板工具；以及 `board-executor`，它把就绪任务派发为委派运行。随包配置默认禁用。

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

在插件列表中选择任务看板。活动的根 Agent 随即获得 `board_create`、`board_list`、`board_get`、`board_update`、`board_complete` 与 `board_claim`，宿主也获得用于驱动看板的 `ctx.boardExecutor.dispatch`。基础组合提供持久存储与一个 subagent provider。禁用该 Bundle 会移除工具与派发器，并把已存任务留在磁盘上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`cordis.patch.yml` 插入 `board` 与 `board-executor` 条目，`package.json` 依赖这两个包，因此条目从此 Bundle 解析。不发布运行时 invariant 伴随包，因为看板自身校验其图与修订号。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 插入 `board` 与 `board-executor` 条目 |
| [`package.json`](package.json) | 把条目所属包列为依赖 |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | 插件管理页的标题与描述 |
| [`src/index.ts`](src/index.ts) | 空的模块入口；patch 才是运行时内容 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [看板包](../../board/board/README.zh.md) — 任务模型、工具与配置。
- [看板派发器](../../board/board-executor/README.zh.md) — 规划、派发与 worktree 隔离。
- [看板子系统](../../../docs/subsystems/board.zh.md) — 任务词汇。

-----

<a id="model-experience"></a>
## 模型体验

### 看板工具

#### 模型看到什么

活动的根 Agent 获得 `board_create`、`board_list`、`board_get`、`board_update`、`board_complete` 与 `board_claim`；每个任务呈现为一行紧凑文本，含 id、修订号、状态、优先级与标题。

#### Token 影响

六个工具 schema 加入每个活动的根 Agent 请求；列表为每个匹配任务返回一行。

#### KV Cache 影响

六个 schema 在 Bundle 挂载时改变一次请求前缀。列表结果是该前缀之后的工具结果内容，因此既有缓存条目不会被失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 派发只能由宿主调用：目前还没有东西在 `board/changed` 时自动运行一次派发，因此本 Bundle 尚未把看板工具与派发器连接起来。
- 派发器需要一个活动的父 agent；创建者会话已结束的任务会被跳过，直到调用方提供父 agent。
- 本 Bundle 不提供 Web 看板 UI；看板通过工具读写。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
