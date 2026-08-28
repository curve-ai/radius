import Foundation

public enum RuntimeCommand: Equatable, Sendable {
    case doctor(json: Bool)
    case loadImage(LoadImageOptions)
    case run(RunOptions)

    public static func parse(_ arguments: [String]) throws -> Self {
        guard let command = arguments.first else {
            throw RuntimeHostError.invalidArguments(Self.usage)
        }

        switch command {
        case "doctor":
            let remainder = Array(arguments.dropFirst())
            guard remainder.allSatisfy({ $0 == "--json" }) else {
                throw RuntimeHostError.invalidArguments(Self.usage)
            }
            return .doctor(json: remainder.contains("--json"))
        case "load-image":
            return .loadImage(try LoadImageOptions.parse(Array(arguments.dropFirst())))
        case "run":
            return .run(try RunOptions.parse(Array(arguments.dropFirst())))
        case "help", "--help", "-h":
            throw RuntimeHostError.helpRequested(Self.usage)
        default:
            throw RuntimeHostError.invalidArguments("Unknown command '\(command)'.\n\n\(Self.usage)")
        }
    }

    public static let usage = """
    Usage:
      radius-runtime-host doctor [--json]
      radius-runtime-host load-image --layout PATH --root PATH
      radius-runtime-host run --image IMAGE@sha256:DIGEST --kernel PATH --root PATH [options] [-- ARGUMENTS...]

    Run options:
      --initfs REFERENCE          Guest init image (default: ghcr.io/apple/containerization/vminit:0.41.0)
      --container-id ID           Stable local container identifier
      --cpus COUNT                Virtual CPU count (default: 2)
      --memory-mb COUNT           Guest memory in MiB (default: 4096)
      --rootfs-mb COUNT           Read-only root filesystem size in MiB (default: 5120)
      --writable-mb COUNT         Writable overlay size in MiB (default: 5120)
      --process-limit COUNT       Maximum guest processes (default: 256)
      --open-file-limit COUNT     Maximum open files per process (default: 1024)
      --user UID:GID              Non-root OCI user (default: 1000:1000)
      --rosetta                   Enable Rosetta for a digest-pinned linux/amd64 image
      --developer-state-share PATH
                                  Share a Radius Application Support directory at /opt/data
      --no-network                Start without an outbound NAT interface
      --allow-unpinned-image      Developer-only escape hatch for a tagged fixture image
      --allow-root                Developer-only escape hatch for a root image user
    """
}

public struct LoadImageOptions: Equatable, Sendable {
    public var layoutPath: String
    public var rootPath: String

    public static func parse(_ arguments: [String]) throws -> Self {
        var values: [String: String] = [:]
        var index = 0
        while index < arguments.count {
            let option = arguments[index]
            guard option == "--layout" || option == "--root" else {
                throw RuntimeHostError.invalidArguments("Unknown load-image option '\(option)'")
            }
            let valueIndex = index + 1
            guard valueIndex < arguments.count else {
                throw RuntimeHostError.invalidArguments("Missing value for \(option)")
            }
            guard values[option] == nil else {
                throw RuntimeHostError.invalidArguments("Duplicate option \(option)")
            }
            values[option] = arguments[valueIndex]
            index += 2
        }
        guard let layoutPath = values["--layout"], !layoutPath.isEmpty else {
            throw RuntimeHostError.invalidArguments("Missing required option --layout")
        }
        guard let rootPath = values["--root"], !rootPath.isEmpty else {
            throw RuntimeHostError.invalidArguments("Missing required option --root")
        }
        return Self(layoutPath: layoutPath, rootPath: rootPath)
    }
}

public struct RunOptions: Equatable, Sendable {
    public static let defaultInitfsReference = "ghcr.io/apple/containerization/vminit:0.41.0"

    public var imageReference: String
    public var kernelPath: String
    public var rootPath: String
    public var initfsReference: String
    public var containerID: String
    public var cpus: Int
    public var memoryMiB: Int
    public var rootfsMiB: Int
    public var writableMiB: Int
    public var processLimit: Int
    public var openFileLimit: Int
    public var user: String
    public var rosettaEnabled: Bool
    public var developerStateSharePath: String?
    public var networkEnabled: Bool
    public var allowUnpinnedImage: Bool
    public var allowRoot: Bool
    public var arguments: [String]

    public static func parse(_ arguments: [String]) throws -> Self {
        var values: [String: String] = [:]
        var flags = Set<String>()
        var processArguments: [String] = []
        var index = 0

        let valueOptions = Set([
            "--image", "--kernel", "--root", "--initfs", "--container-id",
            "--cpus", "--memory-mb", "--rootfs-mb", "--writable-mb", "--user",
            "--process-limit", "--open-file-limit", "--developer-state-share",
        ])
        let flagOptions = Set(["--rosetta", "--no-network", "--allow-unpinned-image", "--allow-root"])

        while index < arguments.count {
            let argument = arguments[index]
            if argument == "--" {
                processArguments = Array(arguments.dropFirst(index + 1))
                break
            }
            if valueOptions.contains(argument) {
                let valueIndex = index + 1
                guard valueIndex < arguments.count else {
                    throw RuntimeHostError.invalidArguments("Missing value for \(argument)")
                }
                guard values[argument] == nil else {
                    throw RuntimeHostError.invalidArguments("Duplicate option \(argument)")
                }
                values[argument] = arguments[valueIndex]
                index += 2
                continue
            }
            if flagOptions.contains(argument) {
                guard !flags.contains(argument) else {
                    throw RuntimeHostError.invalidArguments("Duplicate flag \(argument)")
                }
                flags.insert(argument)
                index += 1
                continue
            }
            throw RuntimeHostError.invalidArguments("Unknown run option '\(argument)'")
        }

        let image = try required("--image", in: values)
        let kernel = try required("--kernel", in: values)
        let root = try required("--root", in: values)
        let allowUnpinned = flags.contains("--allow-unpinned-image")
        if !allowUnpinned && !Self.isDigestPinned(image) {
            throw RuntimeHostError.invalidArguments(
                "Agent images must be addressed by sha256 digest. Use --allow-unpinned-image only for a local developer fixture."
            )
        }

        let user = values["--user"] ?? "1000:1000"
        let allowRoot = flags.contains("--allow-root")
        if !allowRoot && Self.isRootUser(user) {
            throw RuntimeHostError.invalidArguments(
                "Agent images must run as a non-root user. Use --allow-root only for a local developer fixture."
            )
        }

        return Self(
            imageReference: image,
            kernelPath: kernel,
            rootPath: root,
            initfsReference: values["--initfs"] ?? Self.defaultInitfsReference,
            containerID: values["--container-id"] ?? "radius-agent-\(UUID().uuidString.lowercased())",
            cpus: try positiveInteger("--cpus", values["--cpus"] ?? "2"),
            memoryMiB: try positiveInteger("--memory-mb", values["--memory-mb"] ?? "4096"),
            rootfsMiB: try positiveInteger("--rootfs-mb", values["--rootfs-mb"] ?? "5120"),
            writableMiB: try positiveInteger("--writable-mb", values["--writable-mb"] ?? "5120"),
            processLimit: try positiveInteger("--process-limit", values["--process-limit"] ?? "256"),
            openFileLimit: try positiveInteger("--open-file-limit", values["--open-file-limit"] ?? "1024"),
            user: user,
            rosettaEnabled: flags.contains("--rosetta"),
            developerStateSharePath: try developerStateSharePath(
                values["--developer-state-share"]
            ),
            networkEnabled: !flags.contains("--no-network"),
            allowUnpinnedImage: allowUnpinned,
            allowRoot: allowRoot,
            arguments: processArguments
        )
    }

    public static func isDigestPinned(_ reference: String) -> Bool {
        guard let marker = reference.range(of: "@sha256:") else { return false }
        let digest = reference[marker.upperBound...]
        return digest.count == 64 && digest.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    private static func isRootUser(_ user: String) -> Bool {
        user == "root" || user == "0" || user.hasPrefix("0:")
    }

    private static func required(_ option: String, in values: [String: String]) throws -> String {
        guard let value = values[option], !value.isEmpty else {
            throw RuntimeHostError.invalidArguments("Missing required option \(option)")
        }
        return value
    }

    private static func positiveInteger(_ option: String, _ value: String) throws -> Int {
        guard let parsed = Int(value), parsed > 0 else {
            throw RuntimeHostError.invalidArguments("\(option) must be a positive integer")
        }
        return parsed
    }

    private static func developerStateSharePath(_ rawPath: String?) throws -> String? {
        guard let rawPath else { return nil }
        let candidate = URL(fileURLWithPath: rawPath)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let allowedRoot = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Radius", isDirectory: true)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let relative = candidate.path.replacingOccurrences(
            of: allowedRoot.path + "/",
            with: ""
        )
        guard candidate.path.hasPrefix(allowedRoot.path + "/"),
              !relative.isEmpty,
              !relative.contains("../") else {
            throw RuntimeHostError.invalidArguments(
                "--developer-state-share must resolve beneath Radius Application Support"
            )
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(
            atPath: candidate.path,
            isDirectory: &isDirectory
        ), isDirectory.boolValue else {
            throw RuntimeHostError.invalidArguments(
                "--developer-state-share must reference an existing directory"
            )
        }
        return candidate.path
    }
}
