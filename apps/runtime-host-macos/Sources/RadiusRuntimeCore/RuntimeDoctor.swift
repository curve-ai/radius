import Foundation
import Security

public struct RuntimeDoctorReport: Encodable, Equatable, Sendable {
    public let type = "radius.runtime.doctor"
    public let protocolVersion = 1
    public let backend = "apple-containerization"
    public let containerizationVersion = "0.41.0"
    public let minimumMacOSVersion = "26.0"
    public let architecture: String
    public let operatingSystemVersion: String
    public let virtualizationEntitlementPresent: Bool
    public let supported: Bool
    public let reasons: [String]

    public static func current(
        operatingSystem: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion,
        architecture: String = RuntimePlatform.architecture,
        virtualizationEntitlementPresent: Bool = RuntimePlatform.hasVirtualizationEntitlement()
    ) -> Self {
        var reasons: [String] = []
        if architecture != "arm64" {
            reasons.append("The bundled runtime currently requires Apple Silicon.")
        }
        if operatingSystem.majorVersion < 26 {
            reasons.append("The bundled runtime currently requires macOS 26 or newer.")
        }
        if !virtualizationEntitlementPresent {
            reasons.append("The runtime helper is missing the macOS virtualization entitlement.")
        }

        return Self(
            architecture: architecture,
            operatingSystemVersion: RuntimePlatform.versionString(operatingSystem),
            virtualizationEntitlementPresent: virtualizationEntitlementPresent,
            supported: reasons.isEmpty,
            reasons: reasons
        )
    }
}

public enum RuntimePlatform {
    public static var architecture: String {
        #if arch(arm64)
        "arm64"
        #elseif arch(x86_64)
        "x86_64"
        #else
        "unknown"
        #endif
    }

    public static func versionString(_ version: OperatingSystemVersion) -> String {
        "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    }

    public static func hasVirtualizationEntitlement() -> Bool {
        guard let task = SecTaskCreateFromSelf(nil) else { return false }
        let key = "com.apple.security.virtualization" as CFString
        guard let rawValue = SecTaskCopyValueForEntitlement(task, key, nil) else {
            return false
        }
        return (rawValue as? Bool) == true
    }
}
