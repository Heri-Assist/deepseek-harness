---
description: "会话头部的项目看板列表，按状态分组展示某项目的任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-board

[English](README.md) | 中文

## 概述

`dsh-client-ui-board` 把项目看板放进会话头部。一个操作汇总当前会话所属项目——有多少任务进行中或就已绪——其弹层按状态分组任务：待办、进行中、待审、受阻、已完成与已取消。每行标出任务是否可开始或仍在等待前置任务，并显示优先级。看板本身是宿主级并按该会话项目共用的工作目录为键，因此该目录中的每个会话看到同一个看板。本包只负责渲染，不拥有任何任务状态。

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

Web 组合包会挂载它；无需配置。只要项目看板有任务，该操作就会出现在会话头部。打开它会通过 `board` Remote namespace 读取该项目的看板；没有任务的项目显示空看板。

### 各部分展示什么

触发器先读取进行中数量，其次是就绪数量，最后是空看板。弹层为每个非空状态列出一组，每个任务一行，带状态点、标题、就绪或等待标记与优先级。读取失败会报告其消息；没有工作目录的会话不读取任何内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`apply` 注册 `board` 字典与一个 `conversation.session.header.actions` 条目。该条目的 inject face 从客户端会话列表解析会话的工作目录，并调用 `ctx.remote.board.list`；组件只持有打开/关闭与已加载状态。node 半部是一个惰性的 Loader 条目。不发布 invariant 伴随包，因为该插件只拥有自身的注册。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 字典与头部操作注册、inject face |
| [`src/client/BoardListAction.tsx`](src/client/BoardListAction.tsx) | 头部触发器、汇总与按列任务弹层 |
| [`src/client/locales.ts`](src/client/locales.ts) | `board` namespace 字典 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [看板控制器](../../api/board-controller/README.zh.md) — 此操作读取的 Remote namespace。
- [看板子系统](../../../docs/subsystems/board.zh.md) — 任务、状态与依赖词汇。
- [任务 UI](../ui-jobs/README.zh.md) — 本包遵循的头部操作模式。

-----

<a id="model-experience"></a>
## 模型体验

None, as the header summary and task rows are browser UI copy.

#### KV Cache effect

Independent: no request prefix changes when this plugin mounts or updates.

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 该操作是只读的：它列出任务，但不能创建、移动、完成或合并它们。
- 看板以会话的工作目录为键；即使同属一个仓库，两个不同目录也绝不共享同一个看板。
- 没有实时更新：弹层在打开时重新读取，因此别处的更改只在重新打开后出现。
- 没有工作目录的会话不显示看板。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
