---
description: "看板包组：项目级 agent 任务看板。"
kind: "package-group"
---

# board/ — 项目任务看板

[English](README.md) | 中文

## 概述

本组拥有项目级任务看板：带依赖边、compare-and-set 写入与派生的就绪状态的持久任务。它为 agent 工作提供一个比单个会话存活更久、并由同一目录下每个会话共享的队列。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 作用 |
|---|---|
| [`board/`](board/README.zh.md) | 带依赖就绪选择与 `board_*` 工具的持久项目看板 |

-----

<a id="related-documentation"></a>
## 相关文档

- [看板子系统](../../docs/subsystems/board.zh.md) — 任务、状态与依赖词汇。
- [看板包](board/README.zh.md) — 配置、语义与工具 schema。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

None.

</details>
