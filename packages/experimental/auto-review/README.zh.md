---
description: "为 Web profile 添加实验性逐调用 Auto review，在工具以 Full access 执行前使用当前 agent 的模型审查。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-auto-review

[English](README.md) | 中文

## 概述

为 Web profile 当前会话权限选择器添加 Auto review。每次原生或 PTC inner 工具调用前，当前 agent 的 provider 与模型会评估待执行动作；获准调用以 Full access 执行。dsh 安装随附此层但默认关闭；在 Web 侧栏插件页开启或显式安装之前，默认 Web 保持三种权限模式。Auto review 是实验功能：它可能误放行不安全动作、误拒绝有用操作，并消耗额外 token。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

从源码 checkout 通过既有 CLI 将包安装到 Web profile：

```sh
pnpm dsh plugin --profile web add ./packages/experimental/auto-review
```

CLI 会在需要时初始化 profile，并将本包声明的 patch 追加到 base 与 Web 层之后。Reconciliation 将 patch 激活为 profile 层；没有 `dsh.bundle.patch` 的包只是已安装依赖。在 composer 或 `/permission` 选择器中选择带右上标 `EXP` 的 `Auto review`，并确认当前会话风险对话框。显式 `/permission auto` 命令直接切换。通用设置与未来会话默认值不提供 Auto。

通过同一 CLI 移除此层：

```sh
pnpm dsh plugin --profile web remove @deepseek-ai/dsh-experimental-auto-review
```

### 获得的能力

Auto 在每个受支持调用的 body 执行前审查一次，包括每个已开始的 PTC `tools.*` inner call。它按实际效果分类：普通项目内操作、不读取凭据的只读诊断、Session 已在其内工作过的 Git 树中的可逆编辑，以及精确清理本 Session 创建的对象属于 low，直接允许；不可逆删除既有对象、生产操作、外部写入和安全控制变更属于 medium，需要当前 human 或直接父级授权动作及其目标或能力，包括 human 已批准计划的步骤，以及 agent 为所请求目标推导出的最小可逆命令。缺少该授权的 medium 判定会通过普通审批通道就这一次调用询问当前 human，获准后只执行一次；应答者断线时调用继续等待，直到重新连接或取消；human 拒绝使用独立的错误身份。跨信任边界泄露敏感信息属于 high，始终作为绝不向任何人提出的最终判定被拒绝。效果不明确与授权冲突未解决时需要 human 决定。响应不合法与技术失败提供手动审批或显式重新审查；两者都不会自动执行动作。

Reviewer 在自己的请求发生瞬时失败时会重发该请求。可重试代码、尝试预算与退避取自它所审查所用的 provider route 的 retry policy，因此空响应、限流、服务器错误、超时或传输失败会在审查内部恢复，而不会到达 human；认证失败、上下文溢出、协议违例或取消从不重试。预算耗尽时只保留本插件自己的、与 provider 无关的诊断——尝试次数与稳定失败代码——provider 的消息从不持久化。

被拒绝的调用使用普通工具卡片。折叠行标识 Auto review；展开输出说明 body 未执行，并显示可选理由。[Web 权限包](../../client/ui-permission-presets/README.zh.md)拥有选择器交互，[工具 UI](../../client/ui-tool/README.zh.md)拥有理由展示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml)把本包自身插入为 `auto-review` 行。[`src/index.ts`](src/index.ts)要求 LLM、permission、Session 与 tools 服务，然后在同一个 effect 中安装 preset contribution 和置前的 pre-execute listener。[权限 owner](../../interaction/permission-presets/README.zh.md)提供当前身份和进程目录；Auto 复用 Full access 的沙箱值以及普通审批通道——medium 判定会就这一次调用询问当前 human——不改变工具定义。

Reviewer 从当前 Session surface 与待执行调用重建五个分区：固定策略、仅 cwd 的环境、带来源的项目约束、过滤后带来源的历史，以及完整待审动作。原生 schema 来自最新 request header。PTC binding 冻结其 schema，经由调度器传入临时执行元数据；开始与结算事件都不序列化描述或参数 schema。主 agent 的 `system/message` 节点、assistant 正文与 reasoning、tool results 全部排除。外层评审输入是冻结的 `RequestUserInput`，不含持久身份或来源；保留历史在评审文本中仍携带原始来源。[决策记录](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.zh.md)拥有权威、生命周期与 child 继承的理由。

Reviewer 读取来自 `ctx.llm.stream()` 的单个流，而 agent-step 的[重试执行器](../../llm/llm-retry/README.zh.md)从不覆盖它，因此本 integration 自己拥有边界：只要 route policy 把报告的失败归类为可重试，就重发完整请求，等待该 policy 自己的退避——包括 provider 请求的延迟——并在预算耗尽时把一个尝试预算报告给 human。每次尝试都是全新请求，因为失败请求不保留任何内容。

卸载会中止并等待 integration 的在途 review 结清，但保留每个 Session 的 Auto 选择。reviewer 不可用时，权限服务对后续调用请求一次性 human 审批，包括恢复的 Auto Session。其他权限模式保持原样继续运行。重装为这些 Session 恢复自动审查。

本包不发布 runtime invariant companion：同一个 effect 拥有选择准入、review 登记、取消与清理，不存在能与这些自有操作相互偏离的独立观察。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [实验包](../README.zh.md)——发布策略与依赖隔离。
- [Web bundle](../../bundle/web-app/README.zh.md)——此 patch 扩展的稳定 profile。
- [Auto review 决策](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.zh.md)——固定风险策略、权威与生命周期。
- [Tools](../../core/tools/README.zh.md)——执行、取消与 PTC 结果传播。

-----

<a id="model-experience"></a>
## 模型体验

### 逐调用 reviewer

#### 模型看到什么

Reviewer 使用最新 `request/header.config` 的 provider 与模型，并沿用 shipped adapter 默认 reasoning。固定 `REVIEW_POLICY` 决定一个调用：allow 后立即以 Full access 执行，而缺少授权的 medium 判定会变成对当前 human 的一次性询问，只让该会话等待。其余四个分区只包含上文列出的保留事实。响应为一个严格 JSON text 对象，包含 `risk` 与 `decision`；deny 可附字符串 `reason`。Reasoning blocks 可以位于这唯一 text block 之前。只有 `low + allow`、`medium + allow/deny` 和 `high + deny` 合法。

#### Token 影响

每个受支持调用额外产生一次模型请求，并增加任何透明的 provider 失败重试与用户主动要求的重新审查；不缓存、截断、压缩，也不设单独的小型输出预算。超窗请求等待 human 决定。

#### KV Cache 影响

固定 reviewer policy 可以共享前缀；保留历史与待审动作随调用变化。Auto 不向主 agent 增加专门 runtime context 或模式切换提示词。

### 工具拒绝

#### 模型看到什么

拒绝消息为 `Auto review rejected tool "<name>"; its body was not executed`。普通原生错误渲染在前面加 `Error: `。PTC 使用既有 inner-call 异常与 catch 行为；被捕获的拒绝不强制外层 `run_code` 失败。可选原始理由是面向用户的持久结构化错误详情，绝不进入主模型内容。风险、reviewer prompt、reasoning 与原始响应都不持久化。

#### Token 影响

被拒绝调用只向主对话贡献普通固定错误结果。

#### KV Cache 影响

拒绝追加普通工具结果，不改写更早的上下文，也不隐藏既有模型可见信息。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Auto 需要开启此 Web 层；默认 Web、Headless、通用设置与新会话默认值都不包含它。
- Auto 不提供文件沙箱。外层 `run_code` transport 及PTC 程序内直接 Node 效果不经过 inner-tool review。
- 模型分类可能出错。不提供确定性工具豁免、持久 grant 或可配置策略；唯一的自动重试是按 route 自身策略重发 reviewer 自己瞬时失败的请求，绝不重试 reviewer 判定，medium 判定以一次性审批而非长期 grant 的形式交给 human。
- 进程内 Auto child 独立审查自身调用。进程外 child 在父委派调用获准后保留原生权限系统。
- reviewer 在带行级豁免的情况下，通过已废弃的同步 `snapshotEvents()` 读取 Session 动作历史。此前的调用、PTC start 与直接父级的初始 prompt 目前都没有投影或分页读取方，因此迁移按[同步读取决策](../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.zh.md)继续延期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
