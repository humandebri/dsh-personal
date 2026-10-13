# Agent Note: Retain recently viewed Conversations

Status: implemented

[English](2026-10-13-recent-conversation-retention.md) | 中文

## 问题

释放最后一个 Client Session 引用会结束其历史流、Conversation 组装和图像 URL。因此，打开另一个主 Conversation 后再返回，即使用户已经查看过该会话，也会重新打开历史。

## 决定

工作区导航最多保留 `recentSessionLimit` 个非可见 Conversation，默认保留三个。每个条目在现有的 [Client Session 引用系统](2026-09-15-client-session-references.zh.md) 下持有一个 `recentConversation` 引用。这一策略扩展导航的所有权，不改变 Controller 在最后一个引用释放时销毁资源的规则。

先获取下一引用，再释放上一所属者的引用。返回时，只有在获取 `mainView` 后才移除缓存引用。Map 顺序记录最近离开主视图的先后；返回会移除该条目，再次离开使其成为最新条目。超出上限时释放最旧条目。重复选中不获取新引用，除非当前历史打开失败而需要重试。有地址的子会话保留其直接父地址。

缓存引用在归档、Session 移除、所属 scope 销毁或插件销毁时释放。配置引起的重建会释放全部旧引用。现有 Gateway 负责保留历史流的重连。隐藏视图不挂载；数据和图像 URL 的所有权跟随被保留的 Session 世代。

## 影响

最近会话的切换避免历史 I/O，并复用已组装的数据；隐藏的 Session 继续处理实时更新。Session 所属的预览设置也会在返回时保留。Client 内存和更新工作随所保留的历史增加；数量上限不包括当前显示的 Session。零表示禁用保留。引用不创建 Host Agent、不改变 provider 请求，也不改变持久化 Session 格式。这一策略不加速首次打开，也不在应用重启后恢复内存。

## 考虑过的替代方案

**保留所有查看过的 Session。** 内存和实时更新工作会随导航增长，而不是受配置上限约束。

**将会话记录复制到独立缓存。** 这会引入另一个历史所属者，并要求同步事件、组装和图像生命周期，而现有引用系统已经协调这些资源。

**保持三个隐藏的 UI 树挂载。** 除必需的数据外，这还会保留渲染副作用和控件。Session 引用无需挂载隐藏视图即可保留数据。

## 验证

真实 Loader/Web 回归测试在修改前复现 A→B→A 的额外历史打开，修改后则不再额外打开。短夹具的返回耗时仅作诊断，不是长历史基准。Client 组装测试覆盖世代和 Conversation 身份、隐藏期间的更新、淘汰、禁用保留、配置重建、打开过程中的快速导航、归档、移除、scope 销毁、重试和重连。浏览器检查还覆盖长文本、保留的图像 URL、输入草稿、滚动位置恢复以及不进入初始 settling 状态。GUI 全量检查中的无关失败另行报告。
