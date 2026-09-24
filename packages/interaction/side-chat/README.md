---
description: "Ephemeral side conversations for users and maintainers asking a question beside a session without disturbing its durable log."
kind: "package-reference"
---

# @deepseek-ai/dsh-side-chat

English | [中文](README.zh.md)

## Summary

Use `dsh-side-chat` to fork one Session's history into an **ephemeral** child that answers a question beside the main thread. The child inherits the parent's history as reference material, receives a boundary message that forbids continuing the parent's task, and is never written to disk — closing it leaves no durable trace. One side conversation may be open per parent Session.

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

Mount `dsh-side-chat` wherever Sessions run: it provides `ctx.sideChat`, the Host service that owns the live parent/child relation. The Web composition mounts it beside the session controller.

### Open and close a side conversation

```ts
const result = await ctx.sideChat.openFor(parentSessionId)
if (!result.ok) return show(result.message)
const { sideChat } = result

// ...the reader talks to sideChat.agent...

await ctx.sideChat.closeFor(sideChat.sessionId)
```

| Method | Meaning |
|---|---|
| `openFor(parentSessionId)` | Fork the parent's history into a new ephemeral child |
| `closeFor(sessionId)` | Cancel the child and dispose it; `true` when one was open |
| `findByParent(parentSessionId)` | The open side conversation for one parent, if any |
| `get(sessionId)` / `listOpen()` | Identity and roster reads over the in-memory relation |
| `closeAll()` | Close everything; wired to the plugin's own disposal |

A refusal is data, not an exception. `SideChatFailure` is one of `parent-turn-unavailable` (the parent has recorded nothing yet, so there is nothing to inherit), `parent-not-found`, `already-open` (one per parent), or `composition-failed`.

### Over the Remote surface

The generated `sideChat` namespace exposes `open`, `close`, `list`, and `send` with JSON-only boundary types, so a browser client never sees a branded id or a live Agent. `send` admits a question while the child is still replying — `mode: 'steer'` delivers it at the running turn's next step, `queue` at the next turn — and `list` reports the questions still waiting as `snapshot.pending`. `@deepseek-ai/dsh-side-chat/client` wraps them as `ctx.sideChatClient` for UI plugins.

### Boundary copy

`SIDE_BOUNDARY_PROMPT` and `SIDE_DEVELOPER_INSTRUCTIONS` in [`src/boundary.ts`](src/boundary.ts) are the model-visible contract; `withSideDeveloperInstructions` appends the latter to a deployment's own developer instructions without replacing them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The shape mirrors the session controller's ordinary `fork` — observe the source, cut at the last `turn/end`, compose the recorded preset, create the child with a seed and `isSeeded` lineage — with two differences that define the feature:

1. The child is created with `ephemeral: true`, so `agent-loop` acquires no persistence handle and nothing reaches the storage backend.
2. The inherited prefix is the parent's history as it stands, so a question the thread is still waiting on is readable here. A parent whose final turn is still open is inherited whole, with the platform's own interrupted-turn closers closing it — a transcript carrying a dangling tool call is one no provider accepts.
3. A boundary prompt is injected immediately after creation.

Because the child was never stored, disposal is the only cleanup that exists: there is no record to prune and nothing to recover after a Host restart. The parent/child relation therefore lives in memory and is deliberately not reconstructed from storage.

A quiescent parent is inherited up to its last completed turn, the cut the controller's own `fork` uses. A parent whose final turn is still open is inherited whole and closed by the interrupted-turn closers, so the child can read a question the thread is still waiting on. Only a parent that has recorded nothing at all refuses, because there is nothing to inherit.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SideChatService`: open, close, lookup, and the `@Remote` surface |
| [`src/boundary.ts`](src/boundary.ts) | The boundary prompt and side-conversation developer instructions |
| [`src/types.ts`](src/types.ts) | Wire contract for the Remote surface (lossless JSON only) |
| [`src/client/index.ts`](src/client/index.ts) | Browser `SideChatClient` over the generated namespace |

### Why the boundary is a prompt, not a guard

A guard could remove mutating tools, but that would also remove the ability to act when the reader explicitly asks for a change. The boundary is therefore instruction text — the same tradeoff the reference implementation makes — and is not a security boundary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Right Sidebar subsystem](../../../docs/subsystems/sidebar-right.md) — where the `side-chat` tab type appears.
- [Tools package](../../core/tools/README.md) — the registry the child's tools come from.
- [Session persistence](../../session/session-persistence/README.md) — why "no handle" means "not stored".

-----

<a id="model-experience"></a>
## Model Experience

### What the model sees

The child's request carries the parent's completed-turn prefix, the boundary prompt as a user-role message, and the side-conversation developer instructions. The boundary names the cut and demotes everything before it to reference-only.

#### Token effect

The inherited prefix is resent until compaction, so a side conversation starts with the parent's history already in context. This is the deliberate cost of answering with awareness instead of asking the reader to repeat themselves.

#### KV Cache effect

The child is a distinct Session, so the parent's warmed prefix is not reused and the side conversation pays its own first-request cost.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The boundary is an instruction, not enforcement** — a model that ignores it can still act on inherited history. Enforcing it would require restricting tools, which costs the "explicitly asked" path.
- **Host restart discards conversations** — a child survives a page reload while its Host remains alive, but has no stored record to restore after the Host exits.
- **One side conversation per parent** — the service refuses a second open rather than keeping a roster.
- **No sub-agent cooperation** — the boundary forbids sub-agent interaction, so a side conversation cannot orchestrate work.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because its ephemeral child roster has no persisted cross-process contract; service tests verify the one-child-per-parent lifecycle.

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

### Browser questions

`send` admits one non-empty question to an open, idle child; a running or closed child returns a refusal. `list` includes child-owned text messages, running state, and model failures. Inherited history and the injected instruction are excluded from the displayed transcript. Concurrent opens reserve the parent before awaiting composition; teardown invalidates unfinished opens.
