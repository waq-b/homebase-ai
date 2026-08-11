import SwiftUI

@main
struct HomebaseBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var controller = HomebaseController()

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView()
                .environmentObject(controller)
        } label: {
            StatusIcon(status: controller.status)
        }
        .menuBarExtraStyle(.menu)
    }
}

/// Hides the app from the Dock and Cmd+Tab — this is a menu-bar-only utility.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}
