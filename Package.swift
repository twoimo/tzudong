// swift-tools-version: 5.5
import PackageDescription

let package = Package(
    name: "TzudongVisualOCR",
    platforms: [.macOS(.v10_15)],
    targets: [
        .executableTarget(
            name: "TzudongVisualOCR",
            path: "backend/restaurant-crawling/scripts",
            sources: ["main.swift"]
        )
    ]
)
