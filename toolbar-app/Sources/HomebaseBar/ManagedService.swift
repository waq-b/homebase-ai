import Foundation

/// Static config for one process ServiceController can manage — name, where
/// to spawn it, what to run, how to health-check it, and what "Open" does.
struct ManagedService: Identifiable {
    let name: String
    let repoPath: String
    let arguments: [String]
    let healthURL: URL
    let openURL: URL

    var id: String { name }
}

extension ManagedService {
    // Hardcoded for v1, matching Homebase's own toolbar-app README note — a
    // settings screen can replace this later, not needed for now.

    static let homebase = ManagedService(
        name: "Homebase",
        repoPath: "~/Projects/homebase",
        arguments: ["npm", "run", "dev"],
        healthURL: URL(string: "http://localhost:3000/agents")!,
        openURL: URL(string: "http://localhost:3000/docs")!,
    )

    static let mangaFinderAPI = ManagedService(
        name: "mangaFinder API",
        repoPath: "~/Projects/mangaFinder",
        arguments: ["npm", "run", "dev"],
        healthURL: URL(string: "http://localhost:3100/health")!,
        openURL: URL(string: "http://localhost:3100/docs")!,
    )

    static let mangaFinderWeb = ManagedService(
        name: "mangaFinder Web",
        repoPath: "~/Projects/mangaFinder/web",
        arguments: ["npm", "run", "dev"],
        // Vite has no JSON health endpoint — any 200 on the root is enough.
        healthURL: URL(string: "http://localhost:5173")!,
        openURL: URL(string: "http://localhost:5173")!,
    )

    static let all: [ManagedService] = [homebase, mangaFinderAPI, mangaFinderWeb]
}
