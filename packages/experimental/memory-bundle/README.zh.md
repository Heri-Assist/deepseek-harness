---
description: "从插件管理页加入分层持久记忆与 remember、recall、forget 工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-memory-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 插入随发行版交付的组合所不含的那一个记忆条目：`memory`，它拥有 `$DSH_HOME` 下的持久 SQLite 存储，并注册三个模型工具。随包配置默认禁用。

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

在插件列表中选择 Agent 记忆。活动的根 Agent 随即获得 `remember`、`recall` 与 `forget`，并且在一个会话写入的事实可在同一安装的后续会话中检索到。保留默认的 `global` scope 会让事实跨项目共享；`project` 把记录绑定到一个 workspace id，`task` 绑定到一个看板任务。存储位于 `$DSH_HOME/memory/memory.sqlite`，因此事实能在会话删除与进程重启后存活。禁用该 Bundle 会移除工具，并把这些记录留在磁盘上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`cordis.patch.yml` 插入 `memory` 条目，`package.json` 依赖 `@deepseek-ai/dsh-memory`，因此该条目从此 Bundle 解析。不发布运行时 invariant 伴随包，因为存储自身的约束由服务内部强制执行。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 插入 `memory` 条目 |
| [`package.json`](package.json) | 把该条目所属包列为依赖 |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | 插件管理页的标题与描述 |
| [`src/index.ts`](src/index.ts) | 空的模块入口；patch 才是运行时内容 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [记忆服务](../../memory/memory/README.zh.md) — 存储、scope 与工具 schema。
- [Web 组合包](../../bundle/web-app/README.zh.md) — 此 Bundle 向其添加条目的组合。

-----

<a id="model-experience"></a>
## 模型体验

### 记忆工具

#### 模型看到什么

活动的根 Agent 获得 `remember`、`recall` 与 `forget`。`remember` 接收事实文本、可选的 scope、key、标签、所属 id 以及 pinned 标记；`recall` 返回所请求 scope 内最佳的关键词匹配；`forget` 按 id 软删除一条记录。

#### Token 影响

选择该 Bundle 会为每个活动的根 Agent 请求增加三个工具 schema；返回的记录只出现在请求它们的工具结果中。

#### KV Cache 影响

工具 schema 在 Bundle 挂载时改变一次请求前缀；召回结果是该前缀之后的新内容，因此既有条目不会被失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 召回是基于 FTS5 索引的关键词与标签搜索；它不会匹配与已存文本没有任何共同词语的改述。
- 抽取不是自动的：只有模型调用 `remember` 时才会存储事实。从 compaction 摘要与看板任务完成中自动抽取被推迟。
- `agent/pre-step` 处的自动召回注入被推迟；模型必须自行调用 `recall`。
- 记忆文本未经过密钥脱敏器，因为 harness 没有面向自由文本的脱敏器；不要存储凭据。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
