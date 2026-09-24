---
description: "右侧边栏的侧边对话 tab：打开、阅读并关闭当前会话旁边的临时对话，面向使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-side-chat

[English](README.md) | 中文

## 概述

`dsh-client-ui-side-chat` 让 Web 右侧边栏能够使用[临时性侧边对话](../../interaction/side-chat/README.zh.md)。会话头部的一个**侧边对话**动作会为每个父 Session 打开一个 tab：紧凑的对话、一行说明继承历史仅供参考的文字，以及输入框。tab 类型为 `side-chat`，单实例，关闭该 tab 即结束这条侧边对话。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经组合了 `dsh-side-chat` 与右侧边栏的 Web 组合中挂载本插件。它自行注册。可选配置 `pollIntervalMs` 默认为 1000 毫秒。

### 它注册什么

| 席位 | 新增内容 |
|---|---|
| `ctx.sidebarRightTabs` | `side-chat` 类型，单实例，标题为**侧边对话**，并带一个引导胶囊，因此也出现在边栏自身的选择中 |
| `sidebar.right.pane.tab` | 主体：对话、边界横幅与输入框，支持附件，并复用主输入框的**停止**、**排队**／**插话**发送与待发队列（共享的 `QueueStrip`） |
| `conversation.session.header.utilities` | 打开该 tab 的**侧边对话**动作 |
| `ctx.sidebarRight.registerCloseHandler('side-chat', …)` | 关闭 tab 即关闭 Host 侧边对话 |

### 读懂动作的拒绝

**侧边对话**以内联方式报告拒绝而非抛错，因为常见的拒绝都是读者可以自行化解的状态：

- **请先发送一条消息**——该 Session 尚无任何记录，无内容可继承。发送一条普通消息后该动作即可用。仍在等待提问的线程已经可以打开，其问题可在这里展开探讨。
- **此会话已有打开的侧边对话**——该 Session 已有一条存活的侧边对话。此时动作会显示那个 tab，而不是再开一个。

tab 在导航参数中携带 `{ sideChatId }`，因此 tab 无需再次询问 Host 就知道自己展示哪个子会话。该参数是可选的：引导页打开页面类型时不带任何参数，因此没有该参数的 tab 会在挂载时自行打开对话。两个入口因此落到同一个主体上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

tab 是一个临时子会话之上的薄壳。插件拥有整个打开过程——调用 `ctx.sideChatClient`，然后放置 tab——因此主体从不处理打开状态，动作只负责渲染结果。把放置逻辑放在插件里，也让 tab 类型的位置知识与其自身留在一起。

关闭 tab 是唯一的清理路径，这对临时子会话恰好正确：没有存储记录需要修剪，而且关闭处理器绝不能抛错，因为关闭失败会在子会话仍在运行时移除读者的 tab。

### 源码导览

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 各项注册：tab 类型、关闭处理器、主体、头部动作 |
| [`src/client/SideChatBody.tsx`](src/client/SideChatBody.tsx) | 对话外壳、边界横幅与输入框 |
| [`src/client/SideChatOpenAction.tsx`](src/client/SideChatOpenAction.tsx) | 头部动作及其拒绝消息 |
| [`src/client/locales.ts`](src/client/locales.ts) | tab、主体与动作的文案（zh、en） |
| [`src/client/contract.ts`](src/client/contract.ts) | tab 导航参数与注入面 |

### 呈现说明

面板采用边栏自身的地色与内容字号，而非抬升的卡片层，与右列保持一致。边界横幅是隐藏边界消息的人类可读对应物，让读者明白为何 tab 之上的对话不是一项任务。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [侧边对话 Host 包](../../interaction/side-chat/README.zh.md)——服务、边界提示词与 Remote 面。
- [右侧边栏子系统](../../../docs/subsystems/sidebar-right.zh.md)——tab 类型、席位与导航控制器。
- [终端 tab](../../client/ui-sidebar-terminal/README.zh.md)——插件自有 tab 类型最接近的既有范例。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：本插件不注册自己的提示词、schema 或结果。它为子 Session 打开 tab，其模型体验归 [Host 包](../../interaction/side-chat/README.zh.md#model-experience)所有。

#### KV Cache 影响

自身没有。它只改变哪些 tab 处于打开状态，从不改变请求 prefix。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- **文本回复**——面板在模型每一步完成后显示子会话自身的文本消息，不渲染工具卡片、附件或逐 token 输出。
- **没有父级状态显示**——参考实现在侧边对话打开时会显示父级是否需要输入或审批；本 tab 尚未做到。
- **每个父级一个 tab**——类型为单实例，与 Host 服务每父级一个的规则一致。
- **Host 生命周期**——Host 运行期间重新打开面板会连接已有子会话；关闭标签或重启 Host 会丢弃子会话。

<a id="dev-note"></a>
### 开发备注

本包不发布独立的运行时不变式伴生入口，因为它只增加浏览器视图和临时控制器；发送与关闭行为由客户端及浏览器测试验证。

<details>
<summary>维护者工作背景——点击展开</summary>

面板拥有文本记录，不会重复挂载主对话 slot。控制器通过渲染器绑定的 hook 发布 Host 快照，且仅在面板挂载期间轮询。`pollIntervalMs` 默认为 1000，由 Client 插件 schema 校验。发送使用生成的 `sideChat.send` 操作，失败时保留草稿。日语输入法的确认按键不会发送消息。

</details>
