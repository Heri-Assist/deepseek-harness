---
description: "The memory package group: durable Host-wide layered agent memory."
kind: "package-group"
---

# memory/ — durable layered agent memory

English | [中文](README.zh.md)

## Summary

This group owns the harness's durable memory store: facts, decisions, and preferences that should outlive the Session that produced them. Records are layered by scope, carry source back to the work that produced them, and are recalled by keyword over an FTS5 index. The optional bundle mounts the store into a profile that leaves it out.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`memory/`](memory/README.md) | Durable Host-wide layered memory with FTS5 recall and the `remember`, `recall`, and `forget` tools |
| [`memory-context/`](memory-context/README.md) | Automatic recall of saved facts into eligible steps |

-----

<a id="related-documentation"></a>
## Related documentation

- [Memory package](memory/README.md) — store, scopes, config, and tool schemas.
- [Memory recall](memory-context/README.md) — automatic injection rules and bounds.
- [Memory bundle](../experimental/memory-bundle/README.md) — optional bundle that mounts the memory row.
- [Agent memory subsystem](../../docs/subsystems/memory.md) — record, scope, source, and retrieval vocabulary.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
