// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HomebaseBar",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "HomebaseBar",
            path: "Sources/HomebaseBar"
        )
    ]
)
