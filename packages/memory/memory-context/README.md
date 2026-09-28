---
description: "Automatic recall of durable memory into eligible agent steps, for maintainers and deployers configuring when saved facts reach the model."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-context

English | [中文](README.zh.md)

## Summary

`dsh-memory-context` closes the loop on the durable memory store: instead of waiting for the model to call `recall`, it searches saved facts with the text already entering a step and appends the best matches as one durable user message. Recall keys on content terms, so a common word in the incoming message does not pull every record. The same record is injected at most once per Session. Every injection is a logged user message, so a reader can reconstruct exactly what the model received. Use it when an agent should benefit from remembered facts without having to ask for them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it beside [`@deepseek-ai/dsh-memory`](../memory/README.md). It needs the memory store, the agent registry, and the session-projection registry.

```yaml
- name: '@deepseek-ai/dsh-memory-context'
  config:
    scopes: ['global']
    limit: 3
```

| Field | Default | Meaning |
|---|---|---|
| `scopes` | `['global']` | Scopes searched automatically; `project` and `task` need a scope binding the deployment does not yet supply |
| `limit` | `3` | Maximum records appended in one step |
| `maxChars` | `2000` | Maximum total characters appended in one step |
| `refreshIntervalMs` | `0` | Minimum delay between injections in one session; `0` injects at every eligible step |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-context) is the exhaustive source for the accepted fields.

### When it injects

A step is eligible when its incoming text still has a content term after stopwords and very short tokens are dropped, at least one saved record in an eligible scope matches one of those terms, and no record in the batch was already injected in this Session. Nothing is appended when no content term matches.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The plugin registers an `agent/pre-step` listener that runs the existing decision chain, builds a content-term query from the entering messages, searches each eligible scope with `match: 'any'`, ranks the merged hits by FTS5 score, and appends one `user/message` with the `memory-context` source and the `recall` form. It also registers the `memoryContext` session projection, which folds the injected record ids from those messages so a replay re-derives the same dedup state.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Pre-step listener, query terms, rendering, and the dedup projection |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory service](../memory/README.md) — the store, scopes, and recall operation.
- [Memory bundle](../../experimental/memory-bundle/README.md) — the optional bundle that mounts both rows.
- [Agent memory subsystem](../../../docs/subsystems/memory.md) — record, scope, source, and retrieval vocabulary.

-----

<a id="model-experience"></a>
## Model Experience

### Automatic recall message

#### What the model sees

One durable user message appended to the step, prefixed as untrusted notes from earlier sessions, listing up to `limit` records as `- [scope] text` within `maxChars`.

#### Token effect

One bounded user message per eligible step, capped by `limit` records and `maxChars` characters; a step with no matching content term adds nothing.

#### KV Cache effect

The injected message is new visible content after the stable request prefix, so existing cache entries are not invalidated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the `global` scope is eligible by default; binding `project` or `task` records to a Session needs a workspace identity this plugin does not yet resolve.
- Match is exact-term FTS5 over content words; it does not rank paraphrase or semantic similarity.
- The query is filtered by an English stopword list; other languages fall back to a length filter.
- The plugin injects but never extracts: nothing derives new facts from the conversation.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
