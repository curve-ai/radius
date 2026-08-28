import Foundation
import Testing

@testable import RadiusRuntimeCore

struct RuntimeCommandTests {
    @Test func doctorParsesJSONMode() throws {
        #expect(try RuntimeCommand.parse(["doctor", "--json"]) == .doctor(json: true))
    }

    @Test func loadImageRequiresExplicitLayoutAndStore() throws {
        #expect(
            try RuntimeCommand.parse([
                "load-image", "--layout", "/tmp/layout", "--root", "/tmp/store",
            ]) == .loadImage(
                LoadImageOptions(layoutPath: "/tmp/layout", rootPath: "/tmp/store")
            )
        )
    }

    @Test func runRequiresDigestByDefault() throws {
        #expect(throws: RuntimeHostError.self) {
            try RuntimeCommand.parse([
                "run", "--image", "example.invalid/agent:latest",
                "--kernel", "/tmp/vmlinux", "--root", "/tmp/radius-runtime",
            ])
        }
    }

    @Test func runParsesHardenedDefaults() throws {
        let digest = String(repeating: "a", count: 64)
        let command = try RuntimeCommand.parse([
            "run", "--image", "example.invalid/agent@sha256:\(digest)",
            "--kernel", "/tmp/vmlinux", "--root", "/tmp/radius-runtime",
            "--", "/agent/start", "--stdio",
        ])
        guard case .run(let options) = command else {
            Issue.record("Expected run command")
            return
        }
        #expect(options.cpus == 2)
        #expect(options.memoryMiB == 4_096)
        #expect(options.rootfsMiB == 5_120)
        #expect(options.writableMiB == 5_120)
        #expect(options.processLimit == 256)
        #expect(options.openFileLimit == 1_024)
        #expect(options.user == "1000:1000")
        #expect(!options.rosettaEnabled)
        #expect(options.developerStateSharePath == nil)
        #expect(options.networkEnabled)
        #expect(options.arguments == ["/agent/start", "--stdio"])
    }

    @Test func runParsesReleaseResourceLimits() throws {
        let digest = String(repeating: "e", count: 64)
        let command = try RuntimeCommand.parse([
            "run", "--image", "example.invalid/agent@sha256:\(digest)",
            "--kernel", "/tmp/vmlinux", "--root", "/tmp/radius-runtime",
            "--process-limit", "384", "--open-file-limit", "2048",
        ])
        guard case .run(let options) = command else {
            Issue.record("Expected run command")
            return
        }
        #expect(options.processLimit == 384)
        #expect(options.openFileLimit == 2_048)
    }

    @Test func stateShareRejectsPathsOutsideRadiusApplicationSupport() throws {
        let digest = String(repeating: "d", count: 64)
        #expect(throws: RuntimeHostError.self) {
            try RuntimeCommand.parse([
                "run", "--image", "example.invalid/agent@sha256:\(digest)",
                "--kernel", "/tmp/vmlinux", "--root", "/tmp/radius-runtime",
                "--developer-state-share", "/tmp",
            ])
        }
    }

    @Test func rosettaIsExplicitForAmd64Images() throws {
        let digest = String(repeating: "c", count: 64)
        let command = try RuntimeCommand.parse([
            "run", "--image", "example.invalid/agent@sha256:\(digest)",
            "--kernel", "/tmp/vmlinux", "--root", "/tmp/radius-runtime",
            "--rosetta",
        ])
        guard case .run(let options) = command else {
            Issue.record("Expected run command")
            return
        }
        #expect(options.rosettaEnabled)
    }

    @Test func rootRequiresExplicitDeveloperEscapeHatch() throws {
        let digest = String(repeating: "b", count: 64)
        #expect(throws: RuntimeHostError.self) {
            try RuntimeCommand.parse([
                "run", "--image", "example.invalid/agent@sha256:\(digest)",
                "--kernel", "/tmp/vmlinux", "--root", "/tmp/radius-runtime",
                "--user", "0:0",
            ])
        }
    }

    @Test func doctorExplainsUnsupportedHost() {
        let report = RuntimeDoctorReport.current(
            operatingSystem: OperatingSystemVersion(majorVersion: 25, minorVersion: 4, patchVersion: 0),
            architecture: "x86_64",
            virtualizationEntitlementPresent: false
        )
        #expect(!report.supported)
        #expect(report.reasons.count == 3)
    }
}
