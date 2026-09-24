import AppKit

final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private var controller: DSHWindowController!
    private var busy = false
    private var stopping = false
    private var identity: ServerIdentity?
    private var identityKnown = false
    // The launcher is a shell wrapper. The listening Node process executes bin.js,
    // so shutdown must compare against that actual process argument.
    private let entrypoint = ProcessInfo.processInfo.environment["DSH_SERVER_ENTRYPOINT"]
        ?? URL(fileURLWithPath: ProcessInfo.processInfo.environment["DSH_BIN"] ?? "/Applications/.dsh")
            .resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("apps/cli/lib/bin.js").path
    private let port = Int(ProcessInfo.processInfo.environment["DSH_WEB_PORT"] ?? "3080") ?? 3080
    private var server: ServerProcess { ServerProcess(port: port, entrypoint: entrypoint) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard (1...65535).contains(port) else { NSApplication.shared.terminate(nil); return }
        controller = DSHWindowController(origin: URL(string: "http://127.0.0.1:\(port)/")!)
        controller.onRetry = { [weak self] in self?.connect() }
        makeMenus()
        controller.present()
        connect()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        controller?.present()
        return true
    }
    private func connect() {
        guard !busy && !stopping else { return }
        busy = true
        controller.showStatus("DSH に接続しています…")
        let server = self.server
        DispatchQueue.global(qos: .userInitiated).async {
            var connectionURL: URL?
            do {
                // Only a new server needs access to the executable. The native
                // app, rather than bash, requests this permission from macOS.
                if try server.listeners().isEmpty {
                    let file = try FileHandle(forReadingFrom: URL(fileURLWithPath: self.entrypoint))
                    defer { try? file.close() }
                    _ = try file.read(upToCount: 1)
                }
                guard let script = Bundle.main.url(forResource: "launch-dsh", withExtension: "sh") else {
                    throw ServerControlError.inspection
                }
                let process = Process()
                let pipe = Pipe()
                process.executableURL = URL(fileURLWithPath: "/bin/bash")
                // FD 3 is the result channel. Other stdout is never mixed with
                // credentials, and neither stream is written to a UI log.
                process.arguments = ["-c", "exec 3>&1; exec 1>/dev/null; exec /bin/bash \"$1\" --app", "DSH", script.path]
                process.standardOutput = pipe
                process.standardInput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                try process.run()
                let result = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let line = String(decoding: result, as: UTF8.self).trimmingCharacters(in: .newlines)
                let parts = line.split(separator: "\t", maxSplits: 1)
                guard parts.count == 2, parts[0] == "ready", let url = URL(string: String(parts[1])),
                      url.user == nil, url.password == nil,
                      DSHWindowController.sameOrigin(URL(string: "http://127.0.0.1:\(server.port)/")!, url) else {
                    throw ServerControlError.inspection
                }
                connectionURL = url
            } catch {
                // Capture process identity below even when HTTP/startup failed.
            }
            var snapshot: ServerIdentity?
            var known = true
            do { snapshot = try server.snapshot() } catch { known = false }
            DispatchQueue.main.async {
                self.busy = false
                self.identity = snapshot
                self.identityKnown = known
                if let url = connectionURL {
                    self.controller.load(url)
                } else {
                    self.controller.showError("起動できません。DSH の書類フォルダへのアクセス許可とサーバーのログを確認してください。")
                }
            }
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if controller == nil { return .terminateNow }
        if busy || stopping { controller.present(); controller.showStatus("処理中です。完了後に終了してください。"); return .terminateCancel }
        controller.present()
        let alert = NSAlert()
        alert.messageText = "DSH サーバーを停止して終了しますか？"
        alert.informativeText = "起動前から動いていたサーバーも停止します。iPhone の接続と実行中の処理も中断されます。"
        alert.addButton(withTitle: "キャンセル")
        alert.addButton(withTitle: "停止して終了")
        alert.buttons[0].keyEquivalent = "\r"
        alert.buttons[1].keyEquivalent = ""
        alert.window.initialFirstResponder = alert.buttons[0]
        guard alert.runModal() == .alertSecondButtonReturn else { return .terminateCancel }
        stopping = true
        controller.showStatus("サーバーの停止を確認しています…")
        let server = self.server, expected = identity, known = identityKnown
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                if !known {
                    guard try server.listeners().isEmpty else { throw ServerControlError.notDSH }
                } else { try server.stop(expected) }
                DispatchQueue.main.async { sender.reply(toApplicationShouldTerminate: true) }
            } catch {
                DispatchQueue.main.async {
                    self.stopping = false
                    self.controller.showError(error.localizedDescription)
                    sender.reply(toApplicationShouldTerminate: false)
                }
            }
        }
        return .terminateLater
    }
    private func makeMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu(title: "DSH")
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "DSH を隠す", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "DSH を終了…", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let edit = NSMenu(title: "編集"); editItem.submenu = edit
        for (title, action, key) in [("取り消す", "undo:", "z"), ("切り取り", "cut:", "x"), ("コピー", "copy:", "c"), ("貼り付け", "paste:", "v"), ("すべてを選択", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let find = edit.addItem(withTitle: "ページ内を検索…", action: #selector(DSHWindowController.findText), keyEquivalent: "f")
        find.target = controller
        let windowItem = NSMenuItem(); menu.addItem(windowItem)
        let windowMenu = NSMenu(title: "ウィンドウ"); windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "閉じる", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "しまう", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        let reload = windowMenu.addItem(withTitle: "再読み込み", action: #selector(DSHWindowController.reloadPage), keyEquivalent: "r")
        reload.target = controller
        NSApplication.shared.mainMenu = menu
        NSApplication.shared.windowsMenu = windowMenu
    }
}
let application = NSApplication.shared
let delegate = ApplicationDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
