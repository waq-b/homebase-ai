import AppKit
import Foundation

/// Owns the Homebase child process and polls its health, driving the menu
/// bar's status and enabling/disabling menu items accordingly.
@MainActor
final class HomebaseController: ObservableObject {
    enum Status: Equatable {
        case running
        case starting
        case stopped
    }

    @Published private(set) var status: Status = .stopped

    // Hardcoded for v1 — see v1.5.2 ticket, a settings screen can replace this later.
    private let repoPath = "~/Projects/homebase"
    private let baseURL = URL(string: "http://localhost:3000")!
    private let pollInterval: Duration = .seconds(5)

    private var process: Process?
    private var pollTask: Task<Void, Never>?

    init() {
        pollTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.refreshStatus()
                try? await Task.sleep(for: self.pollInterval)
            }
        }
    }

    deinit {
        pollTask?.cancel()
    }

    func start() {
        guard status == .stopped, process == nil else { return }
        status = .starting

        let task = Process()
        task.currentDirectoryURL = URL(fileURLWithPath: repoPath)
        task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        task.arguments = ["npm", "run", "dev"]
        task.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                self?.process = nil
                await self?.refreshStatus()
            }
        }

        do {
            try task.run()
            process = task
        } catch {
            status = .stopped
        }
    }

    func stop() {
        guard let task = process else { return }
        task.terminate()
        process = nil
        status = .stopped
    }

    func restart() {
        stop()
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            self?.start()
        }
    }

    func openDocs() {
        NSWorkspace.shared.open(baseURL.appendingPathComponent("docs"))
    }

    private func refreshStatus() async {
        let url = baseURL.appendingPathComponent("agents")
        var request = URLRequest(url: url)
        request.timeoutInterval = 3

        let reachable: Bool
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            reachable = (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            reachable = false
        }

        if reachable {
            status = .running
        } else if process != nil {
            status = .starting
        } else {
            status = .stopped
        }
    }
}
