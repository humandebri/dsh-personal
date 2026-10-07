---
kind: reference
---

# 个人本地 DSH 配置

[English](README.md) | 中文

## Summary

本目录保存适用于 Apple Silicon macOS 的无凭据本地配置。源码版本和运行时版本记录在 [versions.json](versions.json)；生成的二进制文件、Claude 登录信息和完整 web 配置不纳入 Git。

## Table of Contents

- [恢复文件](#restore-files)
- [重建组件](#rebuild-components)
- [配置文件](#profile-configuration)
- [验证](#verification)
- [开发说明](#dev-note)

## Restore files

采用 `core`、`runtime` 和 `local-codex-preset` 同级的目录结构。从 core 仓库运行脚本，默认预览八个文件。`--apply` 创建缺失文件；在写入前，只要发现现有文件不同就停止。内容相同的现有文件保留其权限。

```sh
python3 scripts/local-dsh/restore.py
python3 scripts/local-dsh/restore.py --apply
```

`--root /path/to/DSH` 可选择其他根目录。快照包含 Claude 包装脚本和登录命令、锁定的原生 Claude 包依赖、自定义预设及生成的配置覆盖层。复制文件不会安装依赖或登录账号。

## Rebuild components

清单固定个人 core 分支、个人 Claude 插件提交及上游 rustdsh 提交。将插件克隆到 `runtime/dsh-claude-plugin`，rustdsh 克隆到 `runtime/rustdsh`，并检出清单中的版本。将指定版本的 Node 安装到 `runtime/bin/node`，或链接到已安装的对应版本。先重建 core，再构建使用本地依赖链接的插件。

| 组件 | 在对应目录运行的构建命令 | 输出或下一步 |
| --- | --- | --- |
| core | `pnpm install --frozen-lockfile`，然后 `pnpm run build` | CLI、包库和 web 资源 |
| runtime/rustdsh | `cargo build --release --locked` | 将 `target/release/rdsh` 复制到 `runtime/bin/rdsh`，并将 `runtime/bin/dsh` 链接到 `rdsh` |
| runtime/claude-runtime | `pnpm install --frozen-lockfile` | 包装脚本使用的官方原生 Claude 可执行文件 |
| runtime/dsh-claude-plugin | `pnpm install --frozen-lockfile`，然后 `pnpm run build` | 本地 Claude 提供方库 |

core 启动器委托给 rustdsh，并在 `scripts/launch-local-dsh.node.sh` 保留 Node 入口。默认设置为 `RDSH_AUTH_AUTOSYNC=0` 和 `RDSH_PASSTHROUGH=1`。SDK 与原生 CLI 版本不同，实时协议探针已通过，但升级时需重测。尚未验证新机器上的完整重建。

原生应用请参考 [macOS Web 启动器](../../apps/macos-web-launcher/README.zh.md)。将 `/Applications/.dsh` 指向此 core 仓库的 `scripts/launch-local-dsh.sh`。在新路径构建应用，替换前保留旧应用。恢复源码不会替换已安装应用或重启运行中的服务器。

## Profile configuration

自定义预设在 [package.json](files/local-codex-preset/package.json) 中声明 DSH bundle。Claude 模型提供方和 core 的 Claude 子代理也声明 bundle。通过 CLI 的 `plugin --profile web add` 操作将相应本地链接安装到 web 配置。清单以根目录的相对路径记录全部五个本地 bundle，包括 Codex 和自动审查。当前配置中后两者使用旧的绝对链接；恢复时改用对应 core 包。保留其他已有配置层。

按 ID 将生成的 `runtime/claude-profile.overlay.yml` 中的条目合并到已有配置补丁，不要替换整个配置。Claude 提供方使用包装脚本的绝对路径，默认模型为 `claude-opus-5-5`；Claude 子代理使用此前批准的 `acceptEdits` 模式。预设启用 Claude 子代理工具。在模型菜单选择 Claude Code 使用提供方，请求委托任务则使用子代理。

运行 `runtime/login-claude.command`，在本机登录订阅账号。登录数据、web 启动令牌及其他提供方凭据需通过各自的登录流程单独恢复。预设快照指向清单记录的技能目录；其内容需单独恢复，迁移到其他账号时需修改绝对目录。

## Verification

插件通过类型检查、构建、lint 和 192 个测试。已登录的实时探针能够处理工具结果后的新用户指令，包括 285,009 字节的工具结果。完成的工具调用可在重启后重放；未完成的调用明确失败，避免重复执行未知操作。插件没有独立的重放字节上限，模型上下文限制仍适用。

原生启动器测试覆盖 `/` 和 `./` 登录重定向。恢复脚本验证了新目录恢复、重复应用及拒绝覆盖不同文件。这些检查不代表已验证新机器安装或认证迁移。

## Dev Note

修改本地版本时同步更新清单和快照。只提交选定文件：完整的用户配置可能包含凭据，绝不能复制到这里。磁盘上的代码更新需在没有活动任务时安全重启 web 服务器后生效。
