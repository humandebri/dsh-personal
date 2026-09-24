# macOS Web 启动器

这个本地 macOS 启动器在 WKWebView 中打开现有的 `dsh web` 配置。应用打开期间，它管理回环地址上 3080 端口的 Web 服务，因此 Mac 窗口和已认证的 iPhone 连接共用运行中的会话和配置。启动器不会安装或复制插件。这里保留源代码，以便重新构建已安装的 `DSH.app`。

`scripts/build-macos-launcher.sh OUTPUT.app` 使用附带的图标构建临时签名的 arm64 应用。默认服务命令为 `/Applications/.dsh`，它链接到此检出目录中的 `scripts/launch-local-dsh.sh`。`DSH_BIN`、`DSH_WEB_PORT` 和 `DSH_SERVER_ENTRYPOINT` 可在本机覆盖。应用保留 `ai.deepseek.dsh.launcher` 标识，仅对本地主页面请求的音频提示麦克风权限；macOS 还需要应用包中的麦克风用途说明。

请构建到新路径，验证后再安装。`DSH_AUDIO_DIAGNOSTIC=1` 在认证页面加载后输出安全上下文、媒体设备和录音 API 的可用状态。`DSH_AUDIO_DIAGNOSTIC=record` 还会申请麦克风权限、录制半秒、丢弃音频并报告字节数；两种模式都不记录启动令牌或音频。运行 `python3 scripts/test-launch-dsh.py` 检查服务启动和令牌处理。替换已安装应用前须完整备份原应用。退出启动器时会先确认是否停止 Web 服务；停止服务也会断开 iPhone 连接和正在执行的任务。
