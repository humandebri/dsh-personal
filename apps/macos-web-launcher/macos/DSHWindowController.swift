import AppKit
import WebKit

final class DSHWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let webView: WKWebView
    let origin: URL
    var onRetry: (() -> Void)?
    private let status = NSTextField(labelWithString: "DSH を起動しています…")
    private let tokenField = NSTextField(string: "")
    private let connect = NSButton(title: "URLで接続", target: nil, action: nil)
    private var downloads: [ObjectIdentifier: WKDownload] = [:]
    private var responseStatus: Int?
    private var activeNavigation: WKNavigation?
    private var didRunAudioDiagnostic = false

    init(origin: URL) {
        self.origin = origin
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "DSH"
        window.minSize = NSSize(width: 800, height: 600)
        window.isReleasedWhenClosed = false
        super.init(window: window)
        if !window.setFrameUsingName("DSHMainWindow") { window.center() }
        window.setFrameAutosaveName("DSHMainWindow")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        tokenField.placeholderString = "Mac の起動 URL（token=付き）"
        tokenField.setAccessibilityIdentifier("recovery.url")
        connect.target = self
        connect.action = #selector(adoptURL)
        let retry = NSButton(title: "再接続", target: self, action: #selector(retryConnection))
        retry.setAccessibilityIdentifier("connection.retry")
        let reload = NSButton(title: "再読み込み", target: self, action: #selector(reloadPage))
        status.lineBreakMode = .byTruncatingTail
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let bar = NSStackView(views: [reload, retry, status])
        bar.orientation = .horizontal
        let recovery = NSStackView(views: [tokenField, connect])
        recovery.orientation = .horizontal
        let root = NSStackView(views: [bar, recovery, webView])
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 8
        root.edgeInsets = NSEdgeInsets(top: 8, left: 8, bottom: 0, right: 8)
        window.contentView = root
        for view in [bar, recovery, webView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            view.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -16).isActive = true
        }
        webView.setContentHuggingPriority(.defaultLow, for: .vertical)
        setRecovery(false)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func present() {
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
    func showStatus(_ message: String) { status.stringValue = message }
    func showError(_ message: String) { showStatus(message); setRecovery(true) }
    private func setRecovery(_ visible: Bool) {
        tokenField.superview?.isHidden = !visible
    }
    static func sameOrigin(_ left: URL, _ right: URL) -> Bool {
        func port(_ url: URL) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }
        return left.scheme?.lowercased() == right.scheme?.lowercased()
            && left.host?.lowercased() == right.host?.lowercased() && port(left) == port(right)
    }
    func load(_ url: URL) {
        guard Self.sameOrigin(origin, url), url.user == nil, url.password == nil else {
            showError("接続先と一致する DSH の起動 URL を入力してください。")
            return
        }
        responseStatus = nil
        showStatus("接続中…")
        activeNavigation = webView.load(URLRequest(url: url))
    }
    @objc func reloadPage() {
        responseStatus = nil
        activeNavigation = webView.reload()
        if activeNavigation == nil { load(origin) }
    }
    @objc func retryConnection() { onRetry?() }
    @objc private func adoptURL() {
        let text = tokenField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), Self.sameOrigin(origin, url),
              url.user == nil, url.password == nil,
              (url.path.isEmpty || url.path == "/"), url.fragment == nil,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              items.count == 1, items[0].name == "token", !(items[0].value ?? "").isEmpty else {
            showError("接続先と一致する token= 付き起動 URL を入力してください。")
            return
        }
        tokenField.stringValue = ""
        load(url)
    }
    @objc func findText() {
        let alert = NSAlert()
        alert.messageText = "ページ内を検索"
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        alert.accessoryView = input
        alert.addButton(withTitle: "検索")
        alert.addButton(withTitle: "キャンセル")
        alert.window.initialFirstResponder = input
        if alert.runModal() == .alertFirstButtonReturn, !input.stringValue.isEmpty {
            let config = WKFindConfiguration()
            config.caseSensitive = false
            config.wraps = true
            webView.find(input.stringValue, configuration: config) { [weak self] result in
                self?.showStatus(result.matchFound ? "一致する文字列を選択しました。" : "見つかりませんでした。")
            }
        }
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        activeNavigation = navigation
        responseStatus = nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if Self.sameOrigin(origin, url) {
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
        } else if url.scheme == "blob", let embedded = URL(string: String(url.absoluteString.dropFirst(5))),
                  Self.sameOrigin(origin, embedded) {
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
        } else {
            if action.navigationType == .linkActivated, ["http", "https"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            } else if action.targetFrame?.isMainFrame == true {
                showError("DSH 以外のページへの移動を中止しました。")
            }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = response.response as? HTTPURLResponse {
            if response.isForMainFrame {
                responseStatus = http.statusCode
                if http.statusCode == 401 { showError("認証が必要です。再接続するか、起動 URL を入力してください。") }
                else if http.statusCode >= 400 { showError("サーバーが HTTP \(http.statusCode) を返しました。") }
            }
            if http.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") == true {
                decisionHandler(.download); return
            }
        }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard navigation === activeNavigation, let url = webView.url,
              Self.sameOrigin(origin, url), responseStatus == 200 else { return }
        showStatus("接続済み")
        setRecovery(false)
        let audioDiagnostic = ProcessInfo.processInfo.environment["DSH_AUDIO_DIAGNOSTIC"]
        let shouldRunAudioDiagnostic = !didRunAudioDiagnostic
            && (audioDiagnostic == "1" || audioDiagnostic == "record")
        if shouldRunAudioDiagnostic {
            didRunAudioDiagnostic = true
            webView.evaluateJavaScript("JSON.stringify({secure: isSecureContext, mediaDevices: !!navigator.mediaDevices, mediaRecorder: !!window.MediaRecorder})") { result, error in
                let value = (result as? String) ?? "error: \(error?.localizedDescription ?? "unknown")"
                fputs("DSH audio capabilities: \(value)\n", stderr)
            }
        }
        if shouldRunAudioDiagnostic && audioDiagnostic == "record" {
            Task { @MainActor in
                let script = """
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    try {
                        const recorder = new MediaRecorder(stream);
                        let bytes = 0;
                        const stopped = new Promise((resolve, reject) => {
                            recorder.ondataavailable = event => { bytes += event.data.size; };
                            recorder.onstop = resolve;
                            recorder.onerror = reject;
                        });
                        recorder.start();
                        await new Promise(resolve => setTimeout(resolve, 500));
                        recorder.stop();
                        await stopped;
                        return { status: 'recorded', bytes };
                    } finally { stream.getTracks().forEach(track => track.stop()); }
                } catch (error) { return { status: 'failed', name: error.name }; }
                """
                let value: [String: Any]
                do {
                    let result = try await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
                    value = (result as? [String: Any]) ?? ["status": "failed", "name": "unexpected result"]
                } catch {
                    value = ["status": "failed", "name": error.localizedDescription]
                }
                fputs("DSH audio recording: \(value)\n", stderr)
            }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(navigation, error: error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(navigation, error: error) }
    private func failed(_ navigation: WKNavigation?, error: Error) {
        guard navigation === activeNavigation, (error as NSError).code != NSURLErrorCancelled else { return }
        showError("接続できません。サーバーを確認して再接続してください。")
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if Self.sameOrigin(origin, url) { load(url) }
        else if ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let window else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor captureOrigin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let localAudio = frame.isMainFrame && type == .microphone
            && captureOrigin.protocol == origin.scheme
            && captureOrigin.host == origin.host
            && captureOrigin.port == origin.port
        decisionHandler(localAudio ? .prompt : .deny)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { track(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { track(download) }
    private func track(_ download: WKDownload) { downloads[ObjectIdentifier(download)] = download; download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard let window else { completionHandler(nil); return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = (suggestedFilename as NSString).lastPathComponent
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
            if result != .OK { self.downloads.removeValue(forKey: ObjectIdentifier(download)) }
        }
    }
    func downloadDidFinish(_ download: WKDownload) { downloads.removeValue(forKey: ObjectIdentifier(download)); showStatus("ダウンロードが完了しました。") }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download)); showStatus("ダウンロードに失敗しました。")
    }
}
