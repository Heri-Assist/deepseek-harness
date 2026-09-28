---
description: "记忆包组：宿主级持久分层 agent 记忆。"
kind: "package-group"
---

# memory/ — 持久分层 agent 记忆

[English](README.md) | 中文

## 概述

本组拥有 harness 的持久记忆存储：应当比产生它的会话存活更久的事实、决策与偏好。记录按 scope 分层，携带指回产生它的工作的来源，并通过 FTS5 索引按关键词召回。可选组合包把该存储挂载进缺少它的 profile。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 作用 |
|---|---|
| [`memory/`](memory/README.zh.md) | 宿主级持久分层记忆，基于 FTS5 召回，并提供 `remember`、`recall` 与 `forget` 工具 |

-----

<a id="related-documentation"></a>
## 相关文档

- [记忆包](memory/README.zh.md) — 存储、scope、配置与工具 schema。
- [记忆组合包](../experimental/memory-bundle/README.zh.md) — 挂载记忆条目的可选 Bundle。
- [Agent 记忆子系统](../../docs/subsystems/memory.zh.md) — 记录、scope、来源与召回词汇。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

None.

</details>
