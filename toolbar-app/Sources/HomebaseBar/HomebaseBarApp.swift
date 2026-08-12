import SwiftUI

@main
struct HomebaseBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var homebase = ServiceController(service: .homebase)
    @StateObject private var mangaFinderAPI = ServiceController(service: .mangaFinderAPI)
    @StateObject private var mangaFinderWeb = ServiceController(service: .mangaFinderWeb)

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView(controllers: [homebase, mangaFinderAPI, mangaFinderWeb])
        } label: {
            StatusIcon(status: aggregateStatus)
        }
        .menuBarExtraStyle(.menu)
    }

    /// Toolbar icon reflects all managed services at a glance: green only if
    /// every one is up, red only if every one is down, yellow for anything
    /// in between (mixed, or one still starting).
    private var aggregateStatus: ServiceController.Status {
        let statuses = [homebase.status, mangaFinderAPI.status, mangaFinderWeb.status]
        if statuses.allSatisfy({ $0 == .running }) { return .running }
        if statuses.allSatisfy({ $0 == .stopped }) { return .stopped }
        return .starting
    }
}

/// Hides the app from the Dock and Cmd+Tab — this is a menu-bar-only utility.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}
