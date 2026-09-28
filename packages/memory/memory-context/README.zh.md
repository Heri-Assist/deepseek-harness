---
description: "面向维护者与部署者的自动记忆召回：将已保存的事实召回进符合条件的 agent 步骤，并配置其触发时机。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-context

[English](README.md) | 中文

## 概述

`dsh-memory-context` 为持久记忆存储闭合并发：它不再等待模型调用 `recall`，而是用已进入某一步的文本搜索已保存的事实，并把最佳匹配作为一条持久用户消息追加进去。召回以内容词为键，因此进入消息中的常见词不会拉出所有记录。同一记录每个会话至多注入一次。每次注入都是一条已记录的用户消息，因此读者可以精确重建模型收到的内容。当一个 agent 应当无需主动索取即可受益于已记住的事实时使用它。

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

把它与 [`@deepseek-ai/dsh-memory`](../memory/README.zh.md) 一起挂载。它需要记忆存储、agent 注册表与会话投影注册表。

```yaml
- name: '@deepseek-ai/dsh-memory-context'
  config:
    scopes: ['global']
    limit: 3
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `scopes` | `['global']` | 自动搜索的 scope；`project` 与 `task` 需要部署尚未提供的 scope 绑定 |
| `limit` | `3` | 单步追加的最大记录数 |
| `maxChars` | `2000` | 单步追加的最大字符总数 |
| `refreshIntervalMs` | `0` | 一个会话内两次注入之间的最小间隔；`0` 表示每个符合条件的步骤都注入 |
| `workspaceId` | 无 | 绑定到 `project` 与 `task` scope 搜索的 workspace；缺少它时不会搜索这些 scope |
| `extractOnCompaction` | `false` | 从每个已提交的 compaction 摘要中抽取一条持久事实 |
| `extractionMaxChars` | `500` | 单条抽取事实的字符预算 |

生成式[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-context)是这些已接受字段的详尽来源。

### 何时注入

当进入文本在去掉停用词与极短词语后仍含内容词、某个符合条件 scope 中至少有一条已存记录匹配其中一个词，且该批次没有任何记录已在本会话注入过时，该步骤即符合条件。没有任何内容词匹配时不追加内容。开启 `extractOnCompaction` 时，每个已提交摘要还会作为一条带 `compaction-summary` 标签的 `project` scope 事实存储，落在绑定 workspace 或会话工作目录；存储失败绝不改变 compaction 结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

该插件注册一个 `agent/pre-step` 监听器，它运行既有的决策链，从进入消息构建内容词查询，以 `match: 'any'` 搜索每个符合条件的 scope，按 FTS5 分数对合并后的命中排序，并追加一条带 `memory-context` 来源与 `recall` form 的 `user/message`。它还注册 `memoryContext` 会话投影，从这些消息折叠出已注入记录 id，使回放能重新推导出相同的去重状态。不发布 invariant 伴随包，因为该插件只拥有自身的注册。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Pre-step 监听器、查询词、渲染与去重投影 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [记忆服务](../memory/README.zh.md) — 存储、scope 与召回操作。
- [记忆组合包](../../experimental/memory-bundle/README.zh.md) — 同时挂载两个条目的可选 Bundle。
- [Agent 记忆子系统](../../../docs/subsystems/memory.zh.md) — 记录、scope、来源与召回词汇。

-----

<a id="model-experience"></a>
## 模型体验

### 自动召回消息

#### 模型看到什么

追加到该步骤的一条持久用户消息，以来自早前会话的不可信笔记为前缀，在 `maxChars` 内以 `- [scope] text` 列出至多 `limit` 条记录。

#### Token 影响

每个符合条件的步骤一条有界用户消息，受 `limit` 条记录与 `maxChars` 字符限制；没有匹配内容词的步骤不追加内容。

#### KV Cache 影响

注入的消息是稳定请求前缀之后的新可见内容，因此既有缓存条目不会被失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 默认只有 `global` scope 符合条件；搜索 `project` 或 `task` 需要配置 `workspaceId`。
- 抽取只读取 compaction 摘要；没有任何东西从普通轮次推导事实。
- 匹配是对内容词的精确 FTS5 搜索；它不对改述或语义相似度排序。
- 查询由英文停用词表过滤；其他语言退回到长度过滤。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
