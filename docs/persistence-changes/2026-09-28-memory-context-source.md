---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-28-memory-context-source

English | [中文](2026-09-28-memory-context-source.zh.md)

## Summary

Adds the `memory-context` user-message source kind with the `recall` context form, used by automatic memory recall.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The change adds one optional arm to the merge-extensible user-source union. Existing logs cannot contain it, a reader that does not know the kind falls through it without changing replay, and no existing arm's supported policy changes, so accepted format 4 stays valid.

<a id="verification"></a>
## Verification

pnpm run verify-persistence-changes and pnpm run verify-persistence-catalog pass. packages/memory/memory-context/tests/injection.spec.ts drives the injected message through the real agent loop and asserts it is a durable user message.

<a id="dev-note"></a>
## Dev Note

None.
