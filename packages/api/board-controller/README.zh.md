---
description: "供未来 Web 看板界面调用的看板 Remote owner：通过生成的 board namespace 暴露看板读取与 compare-and-set 写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-board-controller

[English](README.md) | 中文

## 概述

`dsh-api-board-controller` 是看板浏览器界面的宿主侧。它发布 `board` Remote namespace，使客户端无需自己持有看板存储即可列出某个 workspace 的任务并创建或修改它们。就绪在每次读取时推导，因此浏览器从不自行计算。写入保留看板的 compare-and-set 规则：调用方发送它上次读取到的修订号，过期的修订会作为 bad request 被拒绝。本包不提供客户端 UI。

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

把它与 [`@deepseek-ai/dsh-board`](../../board/board/README.zh.md) 一起挂载。它注入 board 服务，并把 `ctx.boardController` 注册为 `board` Remote namespace 的 owner。

```yaml
- name: '@deepseek-ai/dsh-board'
- name: '@deepseek-ai/dsh-api-board-controller'
```

### Remote 方法

`list` 读取某个 workspace 的任务（最新的在最后），每个任务带有由 blockers 推导的 `ready` 标记。`create` 添加一个 `backlog` 任务。`update` 在 compare-and-set 下替换所列字段。看板校验、not-found 或过期修订失败会以 `gateway/bad-request` Remote 失败到达调用方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`BoardController` 继承 `TypertRemoteService`，namespace 为 `board`，带三个 `@Remote` 方法。它把存储的 `BoardTask` 值映射为客户端安全的 `BoardTaskValue` 对象，并从 workspace 的整个任务集计算 `ready`。已知的看板错误变为 `RemoteError('gateway/bad-request', …)`；其他错误变为 `gateway/internal`。生成的 `./typert` 与 `./remote` 产物由仓库宿主构建产出。不发布 invariant 伴随包，因为该 owner 不持有运行时状态。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `BoardController`、三个 Remote 方法与错误映射 |
| [`src/types.ts`](src/types.ts) | 客户端安全的请求与值类型 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [看板包](../../board/board/README.zh.md) — 此 owner 读写的任务存储。
- [看板子系统](../../../docs/subsystems/board.zh.md) — 任务、状态与依赖词汇。
- [Typert 子系统](../../../docs/subsystems/typert.zh.md) — Remote 调用与 namespace 契约。

-----

<a id="model-experience"></a>
## 模型体验

None, as the Remote owner exposes board reads and writes to the browser only.

#### KV Cache effect

None: the owner adds no request content; it serves browser calls over the generated namespace.

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此处不提供客户端 UI；生成的 namespace 已为尚未构建的 Web 看板界面就绪。
- `list` 每次调用读取整个 workspace 的任务；没有变更流，因此浏览器必须轮询或重新获取。
- 该 owner 只暴露读取、创建与更新；claim、complete 与 dispatch 仍由宿主或工具驱动。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
