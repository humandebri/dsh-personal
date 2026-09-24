import Foundation
import Darwin

struct ServerIdentity: Equatable {
    let pid: pid_t
    let uid: uid_t
    let startSeconds: UInt64
    let startMicroseconds: UInt64
    let executable: String
    let arguments: [String]
}

enum ServerControlError: LocalizedError {
    case inspection, notDSH, changed, timeout, signal
    var errorDescription: String? {
        switch self {
        case .inspection: return "サーバーのプロセスを確認できません。終了を中止しました。"
        case .notDSH: return "接続先のプロセスを DSH と確認できないため、停止しませんでした。"
        case .changed: return "接続先のプロセスが変わったため、停止しませんでした。再接続してください。"
        case .timeout: return "10秒以内にサーバーの停止を確認できませんでした。強制停止はしていません。"
        case .signal: return "サーバーへ停止要求を送れませんでした。"
        }
    }
}

struct ServerProcess {
    let port: Int
    let entrypoint: String

    static func workingDirectory(_ pid: pid_t) throws -> String {
        var info = proc_vnodepathinfo()
        let size = MemoryLayout<proc_vnodepathinfo>.stride
        guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, Int32(size)) == size else {
            throw ServerControlError.inspection
        }
        return withUnsafePointer(to: &info.pvi_cdir.vip_path) { path in
            path.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) { String(cString: $0) }
        }
    }

    static func commandPath(_ argument: String, pid: pid_t) throws -> String {
        if argument.hasPrefix("/") {
            return URL(fileURLWithPath: argument).resolvingSymlinksInPath().path
        }
        let cwd = try workingDirectory(pid)
        guard !cwd.isEmpty else { throw ServerControlError.inspection }
        return URL(fileURLWithPath: cwd, isDirectory: true)
            .appendingPathComponent(argument).standardizedFileURL.resolvingSymlinksInPath().path
    }

    static func inspect(_ pid: pid_t) throws -> ServerIdentity {
        var info = proc_bsdinfo()
        let size = MemoryLayout<proc_bsdinfo>.stride
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(size)) == size else {
            throw ServerControlError.inspection
        }
        var path = [CChar](repeating: 0, count: Int(4 * MAXPATHLEN))
        guard proc_pidpath(pid, &path, UInt32(path.count)) > 0 else { throw ServerControlError.inspection }
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var length = 0
        guard sysctl(&mib, 3, nil, &length, nil, 0) == 0, length > 4 else { throw ServerControlError.inspection }
        var bytes = [UInt8](repeating: 0, count: length)
        guard sysctl(&mib, 3, &bytes, &length, nil, 0) == 0 else { throw ServerControlError.inspection }
        let argc = bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
        var index = MemoryLayout<Int32>.size
        while index < length && bytes[index] != 0 { index += 1 } // executable path
        while index < length && bytes[index] == 0 { index += 1 }
        var arguments: [String] = []
        for _ in 0..<max(0, argc) {
            let start = index
            while index < length && bytes[index] != 0 { index += 1 }
            guard index < length else { throw ServerControlError.inspection }
            arguments.append(String(decoding: bytes[start..<index], as: UTF8.self))
            index += 1
        }
        return ServerIdentity(pid: pid, uid: info.pbi_uid,
            startSeconds: info.pbi_start_tvsec, startMicroseconds: info.pbi_start_tvusec,
            executable: String(cString: path), arguments: arguments)
    }

    func listeners() throws -> [pid_t] {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-nP", "-a", "-iTCP:\(port)", "-sTCP:LISTEN", "-Fp"]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 || process.terminationStatus == 1 else { throw ServerControlError.inspection }
        let text = String(decoding: data, as: UTF8.self)
        return Array(Set(text.split(separator: "\n").compactMap { line in
            line.first == "p" ? Int32(line.dropFirst()) : nil
        })).sorted()
    }

    func snapshot() throws -> ServerIdentity? {
        let pids = try listeners()
        if pids.isEmpty { return nil }
        guard pids.count == 1 else { throw ServerControlError.notDSH }
        let identity = try Self.inspect(pids[0])
        guard identity.uid == getuid(),
              URL(fileURLWithPath: identity.executable).lastPathComponent == "node",
              identity.arguments.count >= 3 else { throw ServerControlError.notDSH }
        let command = try Self.commandPath(identity.arguments[1], pid: identity.pid)
        let expected = URL(fileURLWithPath: entrypoint).resolvingSymlinksInPath().path
        guard command == expected, identity.arguments[2] == "web" else { throw ServerControlError.notDSH }
        return identity
    }

    func stop(_ expected: ServerIdentity?, timeout: TimeInterval = 10) throws {
        let current = try snapshot()
        if current == nil, let expected {
            // Missing inspection data alone is not proof of exit (e.g. EPERM).
            // Only ESRCH plus an empty listening port permits an already-stopped exit.
            guard kill(expected.pid, 0) == -1, errno == ESRCH else {
                throw ServerControlError.changed
            }
            guard try listeners().isEmpty else { throw ServerControlError.changed }
            return
        }
        guard current == expected else { throw ServerControlError.changed }
        guard let expected else { return }
        // Recheck the full identity immediately before signalling, never just PID.
        guard try Self.inspect(expected.pid) == expected else { throw ServerControlError.changed }
        guard kill(expected.pid, SIGTERM) == 0 else { throw ServerControlError.signal }
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let stillSame = (try? Self.inspect(expected.pid)) == expected
            let pids = try listeners()
            if !stillSame && pids.isEmpty { return }
            if !pids.isEmpty && pids != [expected.pid] { throw ServerControlError.changed }
            Thread.sleep(forTimeInterval: 0.1)
        } while Date() < deadline
        throw ServerControlError.timeout
    }
}
