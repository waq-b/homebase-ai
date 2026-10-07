import SwiftUI

@main
struct HomebaseBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var homebase = ServiceController(service: .homebase)

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView(controllers: [homebase])
        } label: {
            StatusIcon(status: aggregateStatus)
        }
        .menuBarExtraStyle(.menu)
    }

    /// Toolbar icon reflects all managed services at a glance: green only if
    /// every one is up, red only if every one is down, yellow for anything
    /// in between (mixed, or one still starting).
    private var aggregateStatus: ServiceController.Status {
        let statuses = [homebase.status]
        if statuses.allSatisfy({ $0 == .running }) { return .running }
        if statuses.allSatisfy({ $0 == .stopped }) { return .stopped }
        return .starting
    }
}

/// Hides the app from the Dock and Cmd+Tab — this is a menu-bar-only utility.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        // LSUIElement (menu-bar-only, no Dock icon, no windows) makes macOS's
        // Automatic Termination treat this as an idle background app and
        // silently kill it after a while — no crash, no log beyond a clean
        // "appDeath". This app manages long-running child processes the user
        // expects to stay up, so it must never be auto-terminated.
        ProcessInfo.processInfo.disableAutomaticTermination("Manages long-running Homebase child process")
    }
}
