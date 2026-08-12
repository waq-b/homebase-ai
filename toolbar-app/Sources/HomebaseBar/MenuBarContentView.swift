import SwiftUI

struct MenuBarContentView: View {
    let controllers: [ServiceController]

    var body: some View {
        ForEach(controllers) { controller in
            ServiceSection(controller: controller)
            Divider()
        }

        Button("Quit") { NSApplication.shared.terminate(nil) }
    }
}

/// One service's block of menu items: status line + Start/Stop/Restart/Open.
/// `.menuBarExtraStyle(.menu)` content is NSMenu-backed, so only simple
/// Text/Button render reliably as real menu items — colored shapes (like the
/// toolbar icon's Circle) don't. Status is conveyed via a colored-circle
/// emoji in plain Text instead, which renders fine since it's just a glyph.
private struct ServiceSection: View {
    @ObservedObject var controller: ServiceController

    var body: some View {
        Text("\(statusEmoji) \(controller.service.name) — \(statusLabel)")

        Button("Start") { controller.start() }
            .disabled(controller.status != .stopped)
        Button("Stop") { controller.stop() }
            .disabled(controller.status == .stopped)
        Button("Restart") { controller.restart() }
            .disabled(controller.status == .stopped)
        Button("Open") { controller.open() }
            .disabled(controller.status != .running)
        if controller.service.dashboardURL != nil {
            Button("Open Dashboard") { controller.openDashboard() }
                .disabled(controller.status != .running)
        }
    }

    private var statusEmoji: String {
        switch controller.status {
        case .running: return "🟢"
        case .starting: return "🟡"
        case .stopped: return "🔴"
        }
    }

    private var statusLabel: String {
        switch controller.status {
        case .running: return "running"
        case .starting: return "starting…"
        case .stopped: return "stopped"
        }
    }
}

struct StatusIcon: View {
    let status: ServiceController.Status

    var body: some View {
        Image(systemName: "star.fill")
            .renderingMode(.original)
            .foregroundStyle(color)
    }

    private var color: Color {
        switch status {
        case .running: return .green
        case .starting: return .yellow
        case .stopped: return .red
        }
    }
}
