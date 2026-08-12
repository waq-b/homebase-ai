import AppKit
import Foundation

/// Owns one managed service's child process and polls its health, driving
/// that service's menu section (status + enabled/disabled Start/Stop/
/// Restart/Open). Generalized from a Homebase-only controller once a second
/// and third service (mangaFinder API + Web) needed the exact same shape.
@MainActor
final class ServiceController: ObservableObject, Identifiable {
    enum Status: Equatable {
        case running
        case starting
        case stopped
    }

    let service: ManagedService
    nonisolated let id: String
    @Published private(set) var status: Status = .stopped

    private let pollInterval: Duration = .seconds(5)

    private var process: Process?
    private var pollTask: Task<Void, Never>?

    init(service: ManagedService) {
        self.service = service
        self.id = service.id
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
        task.currentDirectoryURL = URL(fileURLWithPath: service.repoPath)
        task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        task.arguments = service.arguments
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

    func open() {
        NSWorkspace.shared.open(service.openURL)
    }

    private func refreshStatus() async {
        var request = URLRequest(url: service.healthURL)
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
