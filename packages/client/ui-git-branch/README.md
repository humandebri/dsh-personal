---
description: "Composer stats-row git chip for the web GUI: the checkout the current Session workspace lives in — GitHub repository, branch, and worktree directory — read over the workspaceGit Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-branch

English | [中文](README.zh.md)

## Summary

This package renders the lead chip of the composer's session-stats row, naming the checkout the current Session workspace lives in. A page-lifetime controller watches the Sessions whose chips are mounted, polls the Host's [`workspaceGit`](../../api/workspace-git/README.md) Remote namespace every 15 seconds while the page is visible, refreshes every watched checkout when the page becomes visible again, and publishes one snapshot the chip reads. A GitHub `origin` makes the chip read `owner/repo:branch (worktree)`; a detached HEAD reads `owner/repo@abc1234 (worktree)`. A directory outside a repository, an unavailable git, and a failed read show nothing at all.

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

Mount this plugin beside [`dsh-api-workspace-git`](../../api/workspace-git/README.md), [`dsh-client-ui-chat`](../ui-chat/README.md) (which declares the seat), and the conversation surface; the chip then appears on the stats line of every Session whose workspace is a repository. The plugin takes no configuration.

### What to expect

The chip is read-only: behind the branch glyph it reads the checkout's GitHub repository and ref, followed by the worktree directory that holds it, and the tooltip and screen-reader label name the role ("Branch shiguredo/moqt-js:main (worktree moqt-js)"). With a GitHub remote the whole chip is a link that opens `https://github.com/<owner>/<repo>` in a new tab, wearing the same hover and focus affordances as the stats pills beside it; without one it stays a plain reading. It renders nothing before the first answer, outside a repository, and when the remote names no GitHub repository — the worktree directory still shows then. The row holds its place for the chip even before the Session's first figures exist, and a contentless row stays out of the layout. Unloading the plugin removes the chip, the controller, and its timer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers one `conversation.composer.stats.lead` occupant (`GitBranchChip`) into the seat ui-chat's stats row declares, plus one dictionary effect. The row mounts with the composer and collapses through `:has` while neither a pill nor the seat contributes content, so the chip is not gated on the first closed step. The chip calls `acquire(sessionId)` on mount and `release(sessionId)` on unmount through its inject face; the controller starts its single interval and its `visibilitychange` listener with the first watched Session and stops both with the last. Reads are at most one in flight per Session, a repeat poll while one is in flight is skipped rather than queued, and each settlement is fenced by the watch generation, so a released or re-acquired Session drops late answers. A failed read keeps the last published answer, and an unchanged answer publishes nothing, so the store's snapshot identity moves only when the checkout does — the ref, the worktree directory, or the repository.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the chip alone is not enough; they move from the browser entry to its data and the composition model.

- [dsh-api-workspace-git](../../api/workspace-git/README.md) — the Host service this chip polls.
- [dsh-client-ui-chat](../ui-chat/README.md) — the stats row that declares the seat and renders the chip ahead of its pills.
- [Slots reference](../../../docs/subsystems/slots.md) — how a plugin registers into another plugin's declared slot.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the chip is browser chrome over a working-directory fact and touches no prompt, message, schema, or tool result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current chip and what it deliberately does not do.

- **Polling is time-based** — a branch or worktree switched in a terminal while the page stays visible appears within one poll interval (15 seconds), not at the moment of the checkout.
- **One read per watched Session** — the controller does not coalesce two Sessions on one workspace, so two chips on one repository cost one git read each per poll.
- **The chip reports, it does not act** — no branch switch, copy, or history surface is offered.
- **The worktree name is a directory base name** — a workspace nested inside a repository reports the checkout root's directory, and two checkouts sharing a base name read alike.
- **No link without GitHub** — a remote on another host leaves a plain chip; the repository URL is never guessed from the directory name.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns one slot registration and one dictionary effect whose disposal the HMR-safety spec proves, and the controller's published snapshot is its only cross-render state, with no independent observation to diverge from it.
