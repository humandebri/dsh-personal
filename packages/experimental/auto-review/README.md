---
description: "Add experimental per-call Auto review to a Web profile, using the current agent's model before tools execute with Full access."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-auto-review

English | [中文](README.zh.md)

## Summary

Add Auto review to the current-session permission pickers in a Web profile. Before each native or PTC inner tool call, the current agent's provider and model assess the pending action; an allowed call executes with Full access. The dsh installation ships this layer switched off; default Web keeps its three permission modes until it is switched on from the Web sidebar's Plugins page or installed explicitly. Auto review is experimental: it can allow unsafe actions, deny useful work, and spend additional tokens.

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

### Install into a profile

From this source checkout, install the package into the Web profile through the existing CLI:

```sh
pnpm dsh plugin --profile web add ./packages/experimental/auto-review
```

The CLI initializes the profile when needed and appends this package's declared patch after the base and Web layers. Reconciliation activates the patch as a profile layer; a package without `dsh.bundle.patch` is only an installed dependency. Select `Auto review` with its superscript `EXP` badge in the composer or `/permission` picker and confirm the current-session risk dialog. An explicit `/permission auto` command switches directly. General settings and future-session defaults do not offer Auto.

Remove the layer through the same CLI:

```sh
pnpm dsh plugin --profile web remove @deepseek-ai/dsh-experimental-auto-review
```

### What you get

Auto reviews every supported call once before its body, including each started PTC `tools.*` inner call. It classifies actual effects: ordinary project-local work, credential-free read-only diagnostics, reversible edits inside a Git tree the Session already works in, and exact cleanup of objects created in this Session are low risk and allowed; irreversible deletion of pre-existing objects, production operations, external writes, and security changes are medium risk and need current human or direct-parent authorization of the action and its target or capability, including a step of a plan the human approved and the minimal reversible command the agent derived for a requested goal. A medium verdict without that authorization asks the current human through the ordinary approval channel for exactly that call, and a grant runs it once; a disconnected answerer leaves the call pending until reconnection or cancellation, while a human refusal has its own error identity. Sensitive exfiltration across a trust boundary is high risk and always denied as a final verdict that is never put to anyone. Ambiguous effects and unresolved authorization conflicts require a human decision. Malformed responses and technical failures offer manual approval or an explicit review retry; neither executes the action automatically.

The reviewer re-sends its own request when that request fails transiently. The retryable codes, attempt budget, and backoff come from the retry policy of the provider route it reviews with, so an empty response, rate limit, server error, timeout, or transport failure recovers inside the review instead of reaching the human; an authentication failure, a context overflow, a protocol violation, or a cancellation never retries. Only this plugin's own provider-neutral diagnostic — the attempt count and the stable failure code — is retained for a failure that exhausts the budget, and a provider message is never durable.

A denied call uses the ordinary tool card. The collapsed row identifies Auto review; expanded output states that the body did not execute and displays the optional reason. [The Web permission package](../../client/ui-permission-presets/README.md) owns picker interaction, and [the tool UI](../../client/ui-tool/README.md) owns reason display.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) inserts the package itself as the `auto-review` row. [`src/index.ts`](src/index.ts) requires the LLM, permission, Session, and tools services, then installs the preset contribution and prepended pre-execute listener in one effect. The [permission owner](../../interaction/permission-presets/README.md) supplies the current identity and process catalog; Auto reuses Full access's sandbox value and the ordinary approval channel — a medium verdict asks the current human for exactly that call — without changing tool definitions.

The reviewer reconstructs five sections from the current Session surface and pending execution: fixed policy, cwd-only environment, sourced project constraints, filtered sourced history, and the complete pending action. Native schema comes from the latest request header. A PTC binding freezes its schema and carries it through the scheduler into transient execution metadata; start and settle events never serialize description or parameters. Main-agent `system/message` nodes, assistant text and reasoning, and tool results are excluded. The outer review input is a frozen `RequestUserInput` without durable identity or source; retained history keeps its original source attribution in the review text. [The decision record](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.md) owns authority, lifecycle, and child-inheritance rationale.

The reviewer reads one stream from `ctx.llm.stream()`, which the agent-step [retry executor](../../llm/llm-retry/README.md) never covers, so the integration owns its own bounds: it re-sends the complete request while the route policy classifies the reported failure as retryable, waits that policy's own backoff — including a provider-requested delay — and reports one attempt budget to the human when it expires. Every attempt is a fresh request, because nothing is retained from a failed one.

Unloading aborts and drains the integration’s in-flight reviews, but preserves every Session’s Auto selection. The permission service requests one-time human approval for subsequent calls while the reviewer is unavailable, including restored Auto Sessions. Other permission modes continue unchanged. Reinstalling restores automatic review for those Sessions.

No runtime invariant companion is published: this single effect owns selection admission, review enrollment, cancellation, and cleanup; it has no independent observation that can diverge from those owned operations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md) — publication policy and dependency isolation.
- [Web bundle](../../bundle/web-app/README.md) — the stable profile this patch extends.
- [Auto review decision](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.md) — fixed risk policy, authority, and lifecycle.
- [Tools](../../core/tools/README.md) — execution, cancellation, and PTC result propagation.

-----

<a id="model-experience"></a>
## Model Experience

### Per-call reviewer

#### What the model sees

The reviewer uses the latest `request/header.config` provider and model with the shipped adapter's default reasoning. Its fixed `REVIEW_POLICY` decides one call: allow executes immediately with Full access, and a medium verdict without authorization becomes a one-time question to the current human with only that session waiting. The other four sections contain only the retained facts described above. It returns one strict JSON text object with `risk` and `decision`; deny may include a string `reason`. Reasoning blocks may precede that single text block. Only `low + allow`, `medium + allow/deny`, and `high + deny` are valid.

#### Token effect

One additional model request per supported call, plus any transparent provider-failure retry and any user-requested review retry, without caching, truncation, compaction, or a separate small output budget. An oversized request waits for a human decision.

#### KV Cache effect

The fixed reviewer policy can share a prefix; retained history and the pending action vary per call. Auto adds no dedicated runtime context or mode-switch prompt to the main agent.

### Tool denial

#### What the model sees

The denial message is `Auto review rejected tool "<name>"; its body was not executed`. Ordinary native error rendering prefixes it with `Error: `. PTC uses the existing inner-call exception and catch behavior; a caught denial does not force the outer `run_code` to fail. The raw optional reason is durable structured error detail for users, never main-model content. Risk, reviewer prompt, reasoning, and raw response are not persisted.

#### Token effect

A denied call contributes only the ordinary fixed error result to the main conversation.

#### KV Cache effect

The denial appends an ordinary tool result; it does not rewrite earlier context or hide existing model-visible information.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Auto requires this Web layer switched on; it is absent from default Web, Headless, General settings, and new-session defaults.
- Auto provides no file sandbox. The outer `run_code` transport and direct Node effects inside a PTC program do not pass through inner-tool review.
- Model classification can be wrong. There are no deterministic tool exemptions, persistent grants, or configurable policy; the only automatic retry repeats the reviewer's own transiently failed request under the route's own policy, never a reviewer decision, and a medium verdict reaches the human as a one-time approval rather than a standing grant.
- In-process Auto children review their own calls. Out-of-process children retain their native permission systems after the parent delegation call is allowed.
- The reviewer reads the Session action history through the deprecated synchronous `snapshotEvents()` reader under a line-scoped waiver. Prior calls, PTC starts, and the direct parent's initial prompt have no projection or paged reader yet, so the migration stays deferred by [the synchronous-read decision](../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
