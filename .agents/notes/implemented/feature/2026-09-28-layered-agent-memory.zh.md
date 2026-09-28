# Agent Note: Layered agent memory

Status: implemented

[English](2026-09-28-layered-agent-memory.md) | 中文

## Problem

harness 曾没有记忆子系统。会话日志是单次对话的事实来源，compaction 在 token 压力下总结旧历史，spill 与 attachment 卸载体量大的内容，skill 承载程序性知识——但在产生某个事实的会话结束之后，没有任何东西记住它。跨会话知识只能通过按部署配置的外部 MCP 记忆服务器获得。检索曾基于新近度：compaction 压缩表层最旧的开头，而压缩摘要会丢弃后续任务需要的细节。由[看板](2026-09-28-worktree-isolated-agent-board.zh.md)派发的工作项启动时没有此前尝试学到内容的记录。

## Decision

一个记忆包加一个上下文消费者，组合在 `packages/memory/` 下。

- `@deepseek-ai/dsh-memory` 定义 `ctx.memory` 并拥有存储：记录模型、scope、`remember`、`recall`、`search`、`forget` 与 `list`；位于 `$DSH_HOME/memory/memory.sqlite` 的单个 SQLite 数据库，对文本与标签建立 FTS5 `unicode61` 索引，具有单调的 `MEMORY_SCHEMA_VERSION` 与拒绝外来数据库的 application id；模型工具 `remember`、`recall` 与 `forget`；以及 `memory/changed` 通知。存储只做关键词与标签搜索。
- `@deepseek-ai/dsh-memory-context` 在 `agent/pre-step` 检索并把结果作为持久用户消息注入，搜索配置的 `global`、`project` 或 `task` scope，并在 `extractOnCompaction` 开启时把每个已提交的 `compaction/summary` 存为一条 `project` scope 事实。

### Memory model

记录携带品牌化 `MemoryId`、取值为 `global`、`project` 或 `task` 的 `MemoryScope`、适用时的所属 `workspaceId` 与 `taskId`、可选的 `key` 与 `tags`、事实 `text`、`MemorySource`、`pinned` 标记、`deleted` 墓碑，以及 created、updated、last-used 与 use-count 字段。`MemorySource` 记录产生它的会话 id、事件序号、存在时的工具调用 id，以及 `explicit` 或 `extracted` 的 origin。`project` 写入需要 workspace id，`task` 写入还额外需要 task id；缺失任一项的写入会在存储前以 `MemoryInputError` 拒绝。文本会被去除首尾空白、受 `maxTextBytes` 限制，且不经过任何脱敏器——harness 没有面向自由文本的脱敏器，因此调用方不得写入凭据。

### Scopes and lifecycle

scope 分层：`global` 用于用户事实与偏好，`project` 用于仓库约定与决策，`task` 用于一个工作项可复用的上下文。抽取消费者在配置的 workspace 或会话工作目录写入 `project`；`global` 由显式工具调用写入。`forget` 是保留可审计墓碑的软删除，每次写入都会淘汰超过 `maxRecordsPerScope` 的最旧未固定记录，按稳定的 `(updated_at, rowid)` 顺序保留最旧的。

### Retrieval and injection

检索是对 FTS5 索引的关键词与标签搜索，支持 `match: 'all'` 或 `'any'` 与按 scope 的过滤。上下文消费者从进入消息的内容词（去掉停用词与极短词语）构建查询，以 `match: 'any'` 搜索每个符合条件的 scope，按 FTS5 分数对合并命中排序，截断到配置的 `limit` 与 `maxChars`，并追加一条携带 `recall` form 与记录 id 的持久 `user/message`。注入文本被标记为来自早前会话的笔记，是信息而非指令。`memoryContext` 会话投影折叠已注入记录 id，使一个会话绝不重复注入同一记录。一个会话的已注入集合上限为 500 个 id。

### Context efficiency

记忆补充 compaction 而非取代它。`memory-context` 把每个已提交摘要抽取为带 `compaction-summary` 标签的 `project` 记忆，因此压缩后的摘要可以丢弃那些在记忆存储中存活、且只在相关时才被重新检索的细节。只有当部署指定 `workspaceId` 时才搜索 `project` 与 `task`，因为会话不会把它的 workspace 身份带入本插件。

## Alternatives considered

### Why not ship only the external MCP memory servers?

部署中已带有可选的 MCP 记忆示例，它们不需要任何 harness 代码。但它们也位于会话日志可重建性之外，无法把记录限定到 workspace 或看板任务，无法参与 compaction，并要求用户运行并承担一个独立服务器。原生能力让检索与 harness 其余部分处于同一套来源规则之内，而 MCP 仍作为外部知识存储的路径。

### Why not embeddings and a vector store?

语义检索通常能召回更多改述匹配，但 harness 没有 embedding provider、没有向量索引，也没有基准表明召回收益足以证明每次写入与查询都要新增一次外部模型调用。FTS5 是确定性的，无需模型即可测试，并已在 `session-query-sqlite` 中得到验证。该能力把检索留在 `ctx.memory` 之后，因此 embedding provider 之后可以替换排序而无需改变消费者。

### Why not store only compaction summaries?

把摘要本身当作记忆可以避免第二个存储，但摘要绑定于某个会话的表层区域，并且在压力下写入，而非在事实被学到时写入。按新近度在摘要上检索会重读整个区域，而不是任务需要的那一个事实；删除会话也会删除其知识。分层存储把持久事实与产生它的对话分离。

### Why not declare memory events in the session log?

会话日志是仅追加且按会话的，而记忆是项目级、可变且跨会话共享的；把每次写入记录为会话事件，要么必须为共享状态挑一个归属会话，要么重复状态。模型可见的召回以用户消息传递，因此既有的可重建性规则无需新事件类型或格式版本即可成立。新增 `memory-context` 用户消息来源 kind 是唯一一个持久化类型变化，已作为 same-version 的可加分支记录。

### Why not separate definition, store, and tool packages?

首个实现把 `ctx.memory`、其 SQLite 存储与工具放在一个包里。记录模型、存储与工具一起演进，且没有独立 provider，拆分它们会造出一个两侧各只有一个实现的跨包 seam。日后的 provider 或第二个存储可以把定义拆出而不改变消费者。

## Consequences

- 不提供 `ui-memory` 页面：存储只能通过模型工具读写，人只能通过这些工具编辑它。
- 召回是精确词语的 FTS5；改述与语义相似度不在范围内。
- 停用词表是英文；其他语言退回到长度过滤。
- 文本不脱敏，因为 harness 没有面向自由文本的脱敏器；存储文档说明调用方不得写入凭据。
- 抽取只读取 `compaction/summary`；没有任何东西从普通轮次推导事实。
- `memoryContext` 投影的 `stateVersion` 为 1；该投影折叠记录 id 与时间戳的 wire payload。
