---
description: "The board package group: project-scoped agent task boards."
kind: "package-group"
---

# board/ — project task boards

English | [中文](README.zh.md)

## Summary

This group owns the project-scoped task board: durable tasks with dependency edges, compare-and-set writes, and derived readiness. It gives agent work a queue that outlives one Session and is shared by every Session working in a directory.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`board/`](board/README.md) | Durable project board with dependency-ready selection and the `board_*` tools |

-----

<a id="related-documentation"></a>
## Related documentation

- [Board subsystem](../../docs/subsystems/board.md) — task, status, and dependency vocabulary.
- [Board package](board/README.md) — config, semantics, and tool schemas.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
