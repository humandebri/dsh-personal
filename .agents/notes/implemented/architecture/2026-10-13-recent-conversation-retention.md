# Agent Note: Retain recently viewed Conversations

Status: implemented

English | [中文](2026-10-13-recent-conversation-retention.zh.md)

## Problem

Releasing the final Client Session reference ends its history stream, Conversation assembly and image URLs. Opening another main Conversation and returning therefore opens history again even though the user has already viewed it.

## Decision

Workspace navigation retains up to `recentSessionLimit` non-visible Conversations, defaulting to three. Each entry owns a `recentConversation` reference under the existing [Client Session reference system](2026-09-15-client-session-references.md). The policy extends navigation ownership without changing the Controller's final-reference teardown rule.

The next reference is acquired before the preceding owner releases. Returning removes the cache reference only after `mainView` is retained. Map order records the most recent departure from the main view; returning removes that entry, and its next departure makes it newest. Overflow releases the oldest entry. Repeated selection acquires nothing unless the displayed history opening failed and needs a retry. Addressed children retain their direct-parent address.

Cached references leave on archive, Session removal, exact scope disposal or plugin disposal. Configuration recreation releases all old references. The existing Gateway supervises reconnection of retained history streams. Hidden views stay unmounted; data and image URL ownership follow the retained Session generation.

## Consequences

Recent switching avoids history I/O and reuses assembled data, while hidden Sessions continue processing live updates. Session-owned preview settings also survive a warm return. Client memory and update work increase with the retained histories; the count excludes the displayed Session. Zero disables retention. References do not create Host Agents, alter provider requests or change persisted Session formats. This policy does not accelerate first openings or restore memory after application restart.

## Alternatives considered

**Keep every viewed Session.** It makes memory and live update work grow with navigation rather than the configured bound.

**Copy transcripts into a separate cache.** It introduces another history owner and requires synchronizing events, assembly and image lifetimes that the existing reference system already coordinates.

**Keep three hidden UI trees mounted.** It retains render effects and controls in addition to the required data. Session references preserve the data without mounting hidden views.

## Verification

The real Loader/Web regression reproduces an extra history opening on A→B→A before the change and no extra opening afterward. Short-fixture return measurements are diagnostic, not a long-history benchmark. The Client assembly tests cover generation and Conversation identity, hidden updates, eviction, disabled retention, configuration recreation, rapid navigation during opening, archive, removal, scope disposal, retry and reconnection. Browser checks include long text, retained image URLs, composer drafts, scroll restoration and absence of the initial settling state. GUI-wide unrelated failures remain reported separately.
