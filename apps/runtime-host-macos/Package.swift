// swift-tools-version: 6.2

import PackageDescription

let containerizationVersion = "0.41.0"

let package = Package(
    name: "radius-runtime-host-macos",
    platforms: [.macOS("26.0")],
    products: [
        .executable(
            name: "radius-runtime-host",
            targets: ["RadiusRuntimeHost"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/apple/containerization.git",
            exact: Version(stringLiteral: containerizationVersion)
        ),
        .package(
            url: "https://github.com/apple/swift-system.git",
            from: "1.6.4"
        )
    ],
    targets: [
        .target(
            name: "RadiusRuntimeCore",
            dependencies: [
                .product(name: "Containerization", package: "containerization"),
                .product(name: "ContainerizationEXT4", package: "containerization"),
                .product(name: "ContainerizationExtras", package: "containerization"),
                .product(name: "ContainerizationOCI", package: "containerization"),
                .product(name: "SystemPackage", package: "swift-system")
            ]
        ),
        .executableTarget(
            name: "RadiusRuntimeHost",
            dependencies: ["RadiusRuntimeCore"]
        ),
        .testTarget(
            name: "RadiusRuntimeCoreTests",
            dependencies: ["RadiusRuntimeCore"]
        )
    ]
)
