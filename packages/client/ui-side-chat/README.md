---
description: "The right-Sidebar side-chat tab: users and maintainers opening, reading, and closing an ephemeral conversation beside the current session."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-side-chat

English | [中文](README.zh.md)

## Summary

Use `dsh-client-ui-side-chat` to work with an [ephemeral side conversation](../../interaction/side-chat/README.md) inside the Web right Sidebar. A **Side chat** action in the Session header opens one tab per parent Session: a compact transcript, a line saying the inherited history is reference only, and a composer. The tab type is `side-chat`, single-instance, and closing the tab is what ends the side conversation.

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

Mount this plugin in a Web composition that already composes `dsh-side-chat` and the right Sidebar. It registers itself. The optional `pollIntervalMs` setting defaults to 1000 milliseconds.

### What it registers

| Seat | What it adds |
|---|---|
| `ctx.sidebarRightTabs` | The `side-chat` type, single-instance, titled **Side chat**, with a guide capsule so it also appears among the sidebar's own choices |
| `sidebar.right.pane.tab` | The body: transcript, boundary banner, and composer, with attachments and the main composer's **Stop**, **Queue**/**Steer**, and pending-queue strip (the shared `QueueStrip`) |
| `conversation.session.header.utilities` | The **Side chat** action that opens the tab |
| `ctx.sidebarRight.registerCloseHandler('side-chat', …)` | Closing the tab closes the Host side conversation |

### Reading the action's refusals

**Side chat** reports a refusal inline instead of throwing, because the ordinary refusals are states the reader resolves:

- **Send a message first** — the Session has recorded nothing yet, so there is nothing to inherit. Sending one normal message makes the action work. A thread that is still waiting on a question already opens, so its question can be explored here.
- **This session already has an open side conversation** — a side conversation is already live for this Session. The action reveals that tab instead of opening a second.

The tab carries `{ sideChatId }` in its navigation parameters, so a tab knows which child it shows without asking the Host again. The parameter is optional: the guide opens a page type with no parameters at all, so a tab without it opens its own conversation on mount. Both entry points therefore land on the same body.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The tab is a thin shell over one ephemeral child. The plugin owns the whole open — call `ctx.sideChatClient`, then place the tab — so the body never handles opening state and the action only renders the outcome. Placing the tab in the plugin also keeps the tab type's placement knowledge with the type itself.

Closing the tab is the only cleanup path, which is exactly right for an ephemeral child: there is no stored record to prune, and the close handler must not throw, because a failed close would remove the reader's tab while leaving the child running.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Registrations: tab type, close handler, body, header action |
| [`src/client/SideChatBody.tsx`](src/client/SideChatBody.tsx) | Transcript shell, boundary banner, and composer |
| [`src/client/SideChatOpenAction.tsx`](src/client/SideChatOpenAction.tsx) | The header action and its refusal message |
| [`src/client/locales.ts`](src/client/locales.ts) | Copy for the tab, body, and action (zh, en) |
| [`src/client/contract.ts`](src/client/contract.ts) | Tab navigation parameters and injected faces |

### Presentation notes

The panel takes the Sidebar's ground colour and content font sizes rather than a raised layer, matching the right column. The boundary banner is the human-readable counterpart of the hidden boundary message, so a reader knows why the transcript above the tab is not a task.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Side-chat Host package](../../interaction/side-chat/README.md) — the service, the boundary prompt, and the Remote surface.
- [Right Sidebar subsystem](../../../docs/subsystems/sidebar-right.md) — tab types, seats, and the navigation controller.
- [Terminal tab](../../client/ui-sidebar-terminal/README.md) — the closest shipped example of a plugin-owned tab type.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly: this plugin registers no prompt, schema, or result of its own. It opens tabs for a child Session whose model experience belongs to the [Host package](../../interaction/side-chat/README.md#model-experience).

#### KV Cache effect

None of its own. It changes which tabs are open, never the request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Text replies** — the panel displays child-owned text messages after each model step completes. Rich tool cards, attachments, and token-by-token streaming are not rendered.
- **No parent-status readout** — the reference implementation shows whether the parent needs input or approval while a side conversation is open; this tab does not yet.
- **One tab per parent** — the type is single-instance, matching the Host service's one-per-parent rule.
- **Host lifetime** — reopening the panel reconnects to the existing child while the Host is running. Closing its tab or restarting the Host discards the child.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because this package adds a browser view and transient controller; client and browser tests cover its send and close behavior.

<details>
<summary>Working context for maintainers — click to expand</summary>

The panel owns a text transcript rather than mounting the main conversation slot twice. A controller publishes Host snapshots through a renderer-bound hook and polls only while a panel is mounted. `pollIntervalMs` defaults to 1000 and is validated by the Client plugin schema. Sending uses the generated `sideChat.send` operation; failures preserve the draft. Japanese IME confirmation does not submit a message.

</details>
