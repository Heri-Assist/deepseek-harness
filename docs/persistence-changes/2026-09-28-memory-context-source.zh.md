---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-28-memory-context-source

[English](2026-09-28-memory-context-source.md) | 中文

## 概述

新增 `memory-context` 用户消息来源 kind 与 `recall` 上下文 form，供自动记忆召回使用。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-28-memory-context-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "fad5a6c0226a2b0d804e74924fc581181e8dec3290be39cc5f8c860d2b4ae994"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "14ab4806b67751f7743dbad3814b5b364dc026f5eaef52e027011d8896016bc4"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "905d986a3f185178c60578e6017a55d694193ce67451c2e0eb9570a057602ece"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "a4cb4d13b0374687ef99fde29820befc8bb05d90f679ec47b07c504169acb365"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

该变更为 merge-extensible 用户来源联合新增一个可选分支。既有日志不可能包含它，不了解该 kind 的读取器会穿透它而不改变回放，且没有任何既有分支的支持策略变化，因此已接受的格式 4 仍然有效。

<a id="verification"></a>
## 验证

`pnpm run verify-persistence-changes` 与 `pnpm run verify-persistence-catalog` 通过。`packages/memory/memory-context/tests/injection.spec.ts` 通过真实 agent loop 执行注入消息，并断言它是一条持久用户消息。

<a id="dev-note"></a>
## 开发备注

无。
