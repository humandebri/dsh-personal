---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-07-claude-request-usage

English | [中文](2026-10-07-claude-request-usage.zh.md)

## Summary

Adds optional latest-request usage to aggregate token accounting.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-claude-request-usage
baseline: false
changes:
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "31ab82f4cd19cc2f6d17128e35f04cb2bd575d2a199d5eb1af19fa48a9d0ed22"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "2f3d7e74c8260ce40a4a025157925ad0eacb25cecf4ab01f402ccc037e440e65"
    decision: same-version
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "51b5437563902ddef9fbe629833d38588c70b106a64fb52e16e1d6b604f1d88c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid without requestUsage. Context meters use its inclusive prompt and output counts when present; consumption retains disjoint aggregate counters. This optional addition requires no writer-version change.

<a id="verification"></a>
## Verification

Token-meter tests: 123 passed; Claude adapter tests: 211 passed. Live Claude compaction reduced the synthetic context from 28264 to 4061 estimated tokens.

<a id="dev-note"></a>
## Dev Note

None.
