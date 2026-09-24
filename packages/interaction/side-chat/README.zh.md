---
description: "临时性侧边对话：在一个会话旁边提问而不打扰其持久日志，面向使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-side-chat

[English](README.md) | 中文

## 概述

`dsh-side-chat` 把一个 Session 的历史分叉成一个**临时**子会话，在主线程旁边回答问题。子会话以参照材料的形式继承父级历史，收到一条禁止继续父级任务的边界消息，并且从不写入磁盘——关闭后不留任何持久痕迹。每个父 Session 同时最多只有一个侧边对话。

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

在运行 Session 的地方挂载 `dsh-side-chat`：它提供 `ctx.sideChat`，即拥有这份存活父子关系的 Host 服务。Web 组合把它挂在 session controller 旁边。

### 打开与关闭侧边对话

```ts
const result = await ctx.sideChat.openFor(parentSessionId)
if (!result.ok) return show(result.message)
const { sideChat } = result

// ...the reader talks to sideChat.agent...

await ctx.sideChat.closeFor(sideChat.sessionId)
```

| 方法 | 含义 |
|---|---|
| `openFor(parentSessionId)` | 把父级历史分叉为新的临时子会话 |
| `closeFor(sessionId)` | 取消并释放子会话；曾经打开时返回 `true` |
| `findByParent(parentSessionId)` | 某个父级当前打开的侧边对话 |
| `get(sessionId)` / `listOpen()` | 对内存关系的身份与名录读取 |
| `closeAll()` | 关闭全部；挂在本插件自身的释放上 |

拒绝是数据而非异常。`SideChatFailure` 取值之一：`parent-turn-unavailable`（父级尚无任何记录，无内容可继承）、`parent-not-found`、`already-open`（每个父级仅一个）、`composition-failed`。

### 经由 Remote 面

生成的 `sideChat` 命名空间以纯 JSON 边界类型暴露 `open`、`close`、`list`、`send`，因此浏览器端永远看不到带品牌的 id 或存活的 Agent。`send` 在子会话仍在回复时也接受提问——`mode: 'steer'` 于运行中回合的下一步送达，`queue` 于下一个回合送达——`list` 通过 `snapshot.pending` 报告仍在等待的问题。`@deepseek-ai/dsh-side-chat/client` 把它们包装成 UI 插件可用的 `ctx.sideChatClient`。

### 边界文案

[`src/boundary.ts`](src/boundary.ts) 中的 `SIDE_BOUNDARY_PROMPT` 与 `SIDE_DEVELOPER_INSTRUCTIONS` 是模型可见的契约；`withSideDeveloperInstructions` 把后者追加到部署自身的开发者指令之后，而不替换它们。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

整体形态与 session controller 的普通 `fork` 一致——观察来源、组合已记录的 preset、带 seed 与 `isSeeded` 血缘创建子会话——但有三处差异定义了本功能：

1. 子会话以 `ephemeral: true` 创建，因此 `agent-loop` 不获取持久化句柄，任何内容都不会到达存储后端。
2. 继承前缀是父级当前的历史，因此主线程仍在等待的问题在这里也能读到。父级最后一个回合尚未结束时，整段前缀连同平台自身的 interrupted-turn closers 一起闭合——带悬空工具调用的记录是任何 provider 都不会接受的。
3. 创建后立即注入一条边界提示词。

由于子会话从未被存储，释放是唯一存在的清理：没有记录需要修剪，Host 重启后也没有东西可恢复。因此父子关系只存在于内存中，并刻意不从存储重建。

平静的父级继承到其最后一个已完成回合为止，也就是 controller 自身 `fork` 使用的切点。最后一个回合尚未结束的父级会被整段继承并由 interrupted-turn closers 闭合，因此子会话能读到主线程仍在等待的问题。只有完全没有记录的父级才会被拒绝，因为没有任何内容可继承。

### 源码导览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `SideChatService`：打开、关闭、查找，以及 `@Remote` 面 |
| [`src/boundary.ts`](src/boundary.ts) | 边界提示词与侧边对话开发者指令 |
| [`src/types.ts`](src/types.ts) | Remote 面的线协议契约（仅无损 JSON） |
| [`src/client/index.ts`](src/client/index.ts) | 基于生成命名空间的浏览器 `SideChatClient` |

### 为什么边界是提示词而非守卫

守卫可以移除写入类工具，但那样也会移除读者明确要求改动时的能力。因此边界是指令文本——与参考实现相同的取舍——并不是安全边界。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [右侧边栏子系统](../../../docs/subsystems/sidebar-right.zh.md)——`side-chat` tab 类型出现的位置。
- [工具包](../../core/tools/README.zh.md)——子会话工具所用的注册表。
- [Session 持久化](../../session/session-persistence/README.zh.md)——为什么“没有句柄”就等于“未被存储”。

-----

<a id="model-experience"></a>
## 模型体验

### 模型看到什么

子会话的请求携带父级已完成回合前缀、作为 user 角色消息的边界提示词，以及侧边对话开发者指令。边界指明了切分点，并把其前的全部内容降格为仅供参照。

#### Token 影响

继承前缀会一直重发到压缩为止，因此侧边对话一开始就携带父级历史。这是“带着理解回答”而非让读者重复一遍的刻意代价。

#### KV Cache 影响

子会话是独立 Session，因此父级已预热的 prefix 不会被复用，侧边对话需自付首次请求成本。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- **边界是指令而非强制**——忽视它的模型仍可能依据继承历史行动。强制需要限制工具，代价是失去“明确要求”的路径。
- **Host 重启会丢弃对话**——Host 运行期间子会话可跨页面重载继续存在，但 Host 退出后没有存储记录可供恢复。
- **每个父级仅一个侧边对话**——服务拒绝第二次打开，而不维护名录。
- **不与子代理协作**——边界禁止子代理交互，因此侧边对话无法编排工作。

<a id="dev-note"></a>
### 开发备注

本包不发布独立的运行时不变式伴生入口，因为临时子会话列表没有跨进程持久化契约；服务测试验证每个父会话至多一个子会话的生命周期。

<details>
<summary>维护者工作背景——点击展开</summary>

无。

</details>

### 浏览器提问

`send` 向已打开且空闲的子会话提交非空问题；运行中或已关闭的子会话返回拒绝。`list` 包含子会话自身的文本消息、运行状态和模型错误，显示内容不包含继承历史及注入指令。并发打开在等待组合前预留父会话；释放过程会使未完成的打开失效。子会话在 Host 运行期间可跨页面重载重新连接，但 Host 退出后无法恢复。
