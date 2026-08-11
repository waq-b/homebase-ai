import SwiftUI

struct MenuBarContentView: View {
    @EnvironmentObject private var controller: HomebaseController

    var body: some View {
        Text(statusLabel)

        Divider()

        Button("Start") { controller.start() }
            .disabled(controller.status != .stopped)
        Button("Stop") { controller.stop() }
            .disabled(controller.status == .stopped)
        Button("Restart") { controller.restart() }
            .disabled(controller.status == .stopped)

        Divider()

        Button("Open Docs") { controller.openDocs() }
            .disabled(controller.status != .running)

        Divider()

        Button("Quit") { NSApplication.shared.terminate(nil) }
    }

    private var statusLabel: String {
        switch controller.status {
        case .running: return "Homebase running"
        case .starting: return "Starting…"
        case .stopped: return "Homebase stopped"
        }
    }
}

struct StatusIcon: View {
    let status: HomebaseController.Status

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
    }

    private var color: Color {
        switch status {
        case .running: return .green
        case .starting: return .yellow
        case .stopped: return .red
        }
    }
}
