import Foundation

/// Static config for one process ServiceController can manage — name, where
/// to spawn it, what to run, how to health-check it, and what "Open" does.
struct ManagedService: Identifiable {
    let name: String
    let repoPath: String
    let arguments: [String]
    let healthURL: URL
    let openURL: URL
    /// Optional second "Open" action — currently just Homebase's dashboard.
    /// A dedicated field rather than a list of actions since there's only
    /// ever this one extra case; generalize later if a second one shows up.
    let dashboardURL: URL?

    var id: String { name }
}

extension ManagedService {
    /// Where the Homebase checkout lives. Override with the HOMEBASE_REPO
    /// environment variable; defaults to ~/Projects/homebase. A menu-bar app
    /// launched from Finder does not inherit shell variables, so for a
    /// double-clicked .app either use the default location or set the variable
    /// with `launchctl setenv HOMEBASE_REPO /path/to/homebase`.
    static var homebaseRepoPath: String {
        if let path = ProcessInfo.processInfo.environment["HOMEBASE_REPO"], !path.isEmpty {
            return (path as NSString).expandingTildeInPath
        }
        return NSHomeDirectory() + "/Projects/homebase"
    }

    static let homebase = ManagedService(
        name: "Homebase",
        repoPath: homebaseRepoPath,
        arguments: ["npm", "run", "dev"],
        healthURL: URL(string: "http://localhost:3000/agents")!,
        openURL: URL(string: "http://localhost:3000/docs")!,
        dashboardURL: URL(string: "http://localhost:3000/dashboard")!,
    )

    static let all: [ManagedService] = [homebase]
}
