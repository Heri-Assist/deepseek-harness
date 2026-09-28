---
description: "面向维护者与部署者的宿主级持久分层 agent 记忆，基于 FTS5 文本召回，配置 remember、recall 与 forget 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

`dsh-memory` 为 harness 提供了一个持久保存事实的地方：应当比产生它的会话存活更久的决策、约定与偏好。每条记录携带一个 scope（整个安装、单个项目或单个看板任务）、标签，以及指回写入它的会话与工具调用的来源。文本与标签使用 SQLite FTS5 索引，因此召回能快速匹配关键词，而无需加载整个存储。存储是宿主级且独立于任何会话的，因此在一个会话工作时写入的事实，可从后续会话或被委派的子 agent 检索到。不要存储凭据。

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

挂载该插件后，活动的根 Agent 获得三个工具。该服务拥有单个 SQLite 数据库，除工具注册表外不需要其他服务。可选的 [`@deepseek-ai/dsh-experimental-memory-bundle`](../../experimental/memory-bundle/README.zh.md) 会为缺少该条目的 profile 插入它。

```yaml
- name: '@deepseek-ai/dsh-memory'
  config:
    maxRecordsPerScope: 2000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `databasePath` | `$DSH_HOME/memory/memory.sqlite` | 存储位置；`:memory:` 使其仅存活于当前进程 |
| `maxRecordsPerScope` | `2000` | 每个 scope 保留的未固定记录数；超出后最旧的被淘汰 |
| `retrievalLimit` | `5` | `recall` 与 `search` 的默认结果数 |
| `maxTextBytes` | `8192` | 可接受记录文本的最大 UTF-8 字节数 |

生成式[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory)是这些已接受字段的详尽来源。

### 每次调用的行为

`remember` 写入一条去除首尾空白且非空的事实，并返回其 id、scope、标签与 pinned 标记。`recall` 返回所请求 scope 与标签内最佳的关键词匹配；没有查询文本时按最新优先，并把每条返回的记录标记为已使用。`forget` 按 id 软删除一条记录并保留墓碑，使来源仍可审计。在 `project` 或 `task` scope 写入需要所属 id；不一致的写入会被拒绝，而不是被静默存储。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`MemoryStore` 在首次使用时通过 `openMemoryDatabase` 打开数据库，后者会拒绝外来的 SQLite application id，并在 `MEMORY_SCHEMA_VERSION` 变化时重建自有表。`remember` 插入行及其 FTS5 文档，淘汰超出上限的最旧未固定记录，然后在提交后发出 `memory/changed`。`search` 连接 FTS5 索引以过滤已删除行、scope、workspace、task 与标签；`recall` 增加使用计数更新。工具 schema 位于 `src/tools.ts`，通过 `ctx.tools.register` 注册。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `MemoryStore`、配置、scope 解析、召回与淘汰 |
| [`src/schema.ts`](src/schema.ts) | SQLite 打开、归属校验、FTS5 schema |
| [`src/types.ts`](src/types.ts) | 记录、scope、来源、查询与命中类型 |
| [`src/tools.ts`](src/tools.ts) | `remember`、`recall` 与 `forget` 工具 schema |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [记忆组合包](../../experimental/memory-bundle/README.zh.md) — 挂载该条目的可选 Bundle。
- [存储子系统](../../../docs/subsystems/storage.zh.md) — harness 其余部分使用的持久存储；本包改为自持一个 SQLite 文件。

-----

<a id="model-experience"></a>
## 模型体验

### 记忆工具

#### 模型看到什么

活动的根 Agent 获得 `remember`、`recall` 与 `forget`。`remember` 接收事实文本以及可选的 scope、key、标签、所属 id 与 pinned 标记；`recall` 返回匹配记录及其 scope、文本与标签；`forget` 接收一个记录 id。召回文本是不可信信息，绝不是指令。

#### Token 影响

三个工具 schema 加入每个活动的根 Agent 请求。召回结果只携带匹配记录，受 `retrievalLimit` 与记录自身大小限制。

#### KV Cache 影响

三个 schema 在插件挂载时改变一次请求前缀。召回结果是该前缀之后的新内容，因此既有缓存条目不会被失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 抽取不是自动的：目前没有任何东西从 compaction 摘要或已完成的看板任务推导事实，因此只有显式 `remember` 才会存储事实。
- `agent/pre-step` 处的自动召回注入被推迟；目前模型必须自行决定调用 `recall`。
- 召回是精确词语的 FTS5 搜索；它不会对改述排序，也没有可用的 embedding provider。
- 记忆文本未经过密钥脱敏器，因为 harness 没有面向自由文本的脱敏器；调用方不得存储凭据。
- 存储是宿主级的，除 scope 列外没有按 workspace 的访问校验。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
