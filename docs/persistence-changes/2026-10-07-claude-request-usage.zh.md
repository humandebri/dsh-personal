---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-07-claude-request-usage

[English](2026-10-07-claude-request-usage.md) | 中文

## 概述

为聚合 token 记账增加可选的最近请求计数。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录缺少 requestUsage 时仍然有效。存在该字段时，上下文计量使用含缓存的输入和输出计数；消耗量保留互不重叠的聚合计数。可选字段无需更新写入版本。

<a id="verification"></a>
## 验证

Token-meter 测试 123 个通过，Claude 适配器测试 211 个通过。实际 Claude 压缩将合成上下文从估算 28264 token 降至 4061 token。

<a id="dev-note"></a>
## 开发备注

无。
