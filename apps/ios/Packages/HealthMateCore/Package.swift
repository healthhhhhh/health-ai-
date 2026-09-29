// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "HealthMateCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HealthMateCore", targets: ["HealthMateCore"]),
    ],
    targets: [
        // Pure Foundation: domain models, services and formatting. No UI code,
        // so it builds and tests with `swift test` on macOS or Linux.
        .target(name: "HealthMateCore", resources: [.copy("Resources/sample-account.json"), .copy("Resources/example-report.pdf")]),
        .testTarget(name: "HealthMateCoreTests", dependencies: ["HealthMateCore"]),
    ]
)
