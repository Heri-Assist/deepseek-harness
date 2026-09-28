# Agent Note: Layered agent memory

Status: proposed

[English](2026-09-28-layered-agent-memory.md) | 中文

## Problem

harness 没有记忆子系统。会话日志是单次对话的事实来源，compaction 在 token 压力下总结旧历史，spill 与 attachment 卸载体量大的内容，skill 承载程序性知识——但在产生某个事实的会话结束之后，没有任何东西记住它。跨会话知识只能通过按部署配置的外部 MCP 记忆服务器获得。检索基于新近度：compaction 压缩表层最旧的开头，而压缩摘要会丢弃后续任务需要的细节。由[看板](2026-09-28-worktree-isolated-agent-board.zh.md)派发的工作项启动时没有此前尝试学到内容的记录，被恢复的任务会重新推导已经确立的上下文。

## Proposal

一个记忆能力，包含定义、一个存储 provider，以及工具、上下文与 compaction 消费者，组合在 `packages/memory/` 下。

- `@deepseek-ai/dsh-memory` 定义 `ctx.memory`：记录模型、scope、`remember`、`recall`、`search` 与 `forget` 操作、限额，以及 `memory/changed` 通知。
- `@deepseek-ai/dsh-memory-sqlite` 提供存储：位于 `$DSH_HOME` 下的单个 SQLite 数据库，对文本与标签建立 FTS5 `unicode61` 索引，具有单调 schema 版本与按 scope 的列，沿用 `session-query-sqlite` 的模式。
- `@deepseek-ai/dsh-tool-memory` 注册模型工具 `remember`、`recall` 与 `forget`，写入时各自记录来源。
- `@deepseek-ai/dsh-memory-context` 在 `agent/pre-step` 检索，并把结果作为持久用户消息注入。
- `@deepseek-ai/dsh-memory-compaction` 在 compaction 摘要提交时、以及看板任务完成时抽取持久事实，并让 pinned 记录跨 compaction 保持可用。
- `packages/client/ui-memory` 渲染设置页面，按 scope 浏览、搜索、编辑与遗忘记录。

### Memory model

记录携带品牌化 id、scope、适用时的所属 workspace id 与 task id、可选 key、标签、文本、来源、pinned 标记、可选 supersedes id、deleted 墓碑，以及 created、updated、last-used 与 use-count 字段。来源记录产生它的会话 id、事件序号、存在时的工具调用 id，以及 `explicit` 或 `extracted` 的 origin。文本在存储前经过既有的密钥脱敏器；凭据绝不作为记忆持久化。

### Scopes and lifecycle

scope 分层：`global` 用于用户事实与偏好，`project` 用于仓库约定与决策，`task` 用于一个工作项可复用的上下文。写入选择最窄的适用 scope；抽取消费者只写 `project` 与 `task`，而 `global` 由显式工具调用或人工编辑写入。forget 是软删除，保留可审计的墓碑；配置的过期策略会移除超过保留窗口未使用、或超出每 scope 上限的记录。

### Retrieval and injection

检索是对 FTS5 索引的关键词与标签搜索。查询组合来自进入的消息批次、活动目标，以及看板任务标题、描述与标签的词语。结果被排序、截断到配置的 top-k，并通过 `ctx.tokenMeter` 按每次注入的 token 预算计价。上下文消费者在 `agent/pre-step` 把选中的记录作为持久用户消息注入，携带 `recall` form 与来源头，因此到达模型的内容仍可从会话日志重建。注入文本被标记为不可信，与 session-reference 快照完全一致：它是信息，绝不是指令，也绝不执行。每会话投影会对已注入对话的记录去重。

### Context efficiency

记忆补充 compaction 而非取代它。当 compaction 总结某一区域时，compaction 消费者在同一次调用中向模型索要持久事实，并存储到 project 或 task scope；压缩后的摘要因此可以丢弃那些在记忆存储中存活、且只在相关时才被重新检索的细节。pinned 记录会在 compaction 边界之后重新注入，使会话正据以工作的决策不会被总结掉。抽取复用既有生成选项上的 `compaction` purpose，而不扩展该联合类型，从而避免改动 `dsh-llm`。

## Alternatives considered

### Why not ship only the external MCP memory servers?

部署中已带有可选的 MCP 记忆示例，它们不需要任何 harness 代码。但它们也位于会话日志可重建性之外，无法把记录限定到 workspace 或看板任务，无法参与 compaction，并要求用户运行并承担一个独立服务器。原生 seam 让检索与 harness 其余部分处于同一套来源与脱敏规则之内，而 MCP 仍作为外部知识存储的路径。

### Why not embeddings and a vector store?

语义检索通常能召回更多改述匹配，但 harness 没有 embedding provider、没有向量索引，也没有基准表明召回收益足以证明每次写入与查询都要新增一次外部模型调用。FTS5 是确定性的，无需模型即可测试，并已在 `session-query-sqlite` 中得到验证。该定义把检索留在 `ctx.memory` 之后，因此 embedding provider 之后可以替换排序而无需改变消费者。

### Why not store only compaction summaries?

把摘要本身当作记忆可以避免第二个存储，但摘要绑定于某个会话的表层区域，并且在压力下写入，而非在事实被学到时写入。按新近度在摘要上检索会重读整个区域，而不是任务需要的那一个事实；删除会话也会删除其知识。分层存储把持久事实与产生它的对话分离。

### Why not declare memory events in the session log?

会话日志是仅追加且按会话的，而记忆是项目级、可变且跨会话共享的；把每次写入记录为会话事件，要么必须为共享状态挑一个归属会话，要么重复状态。模型可见的召回以用户消息传递，因此既有的可重建性规则无需新事件类型或格式版本即可成立。

## Acceptance criteria

- 在一个会话写入的事实，能在同一 workspace 的新会话中按关键词检索到。
- 记录受 scope 约束：task scope 记录不会被注入无关任务，project scope 记录不会被注入另一个 workspace。
- 每条被注入的记录都是带 recall form 与来源的持久用户消息；仅凭会话日志即可重建模型收到的内容。
- compaction 抽取持久事实，并在摘要提交后重新注入 pinned 记录。
- 已存储的记录绝不包含密钥脱敏器会移除的值，且 forget 留下可审计的墓碑。

## Risks

- 自动抽取消耗一次模型调用，并可能持久化错误或误导性的事实；抽取是配置项，默认按窄 scope 执行，且每条记录都带来源以供审查。
- 召回文本是不可信输入；一条被塑造成指令的记录，不得在 session-reference 快照既有的提示注入防御之外改变行为。
- 无界存储会降低检索质量；top-k、token 预算、上限与过期都是配置，且 UI 提供删除。
- FTS5 分词对精确词语排序良好，对改述则较差；该定义的检索边界是文档化的位置，用于在有证据支持时换入语义排序。