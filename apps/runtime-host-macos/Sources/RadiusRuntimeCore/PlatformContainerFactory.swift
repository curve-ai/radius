import Containerization
import ContainerizationError
import ContainerizationEXT4
import ContainerizationExtras
import ContainerizationOCI
import Foundation
import SystemPackage

enum PlatformContainerFactory {
    private static let bytesPerMiB: UInt64 = 1_048_576

    static func create(
        options: RunOptions,
        kernelURL: URL,
        rootURL: URL,
        stdin: ReaderStream,
        stdout: Writer,
        stderr: Writer
    ) async throws -> LinuxContainer {
        let imageStore = try ImageStore(path: rootURL)
        let initfs = try await prepareInitfs(
            reference: options.initfsReference,
            imageStore: imageStore
        )
        let vmm = VZVirtualMachineManager(
            kernel: Kernel(path: kernelURL, platform: .linuxArm),
            initialFilesystem: initfs,
            rosetta: options.rosettaEnabled
        )
        let platform = options.rosettaEnabled
            ? Platform(arch: "amd64", os: "linux")
            : Platform.current
        let image = try await image(
            reference: options.imageReference,
            platform: platform,
            imageStore: imageStore
        )

        let containerRoot = rootURL
            .appendingPathComponent("containers", isDirectory: true)
            .appendingPathComponent(options.containerID, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: containerRoot.path) else {
            throw RuntimeHostError.runtime(
                "Container state already exists for \(options.containerID)"
            )
        }
        try FileManager.default.createDirectory(
            at: containerRoot,
            withIntermediateDirectories: true
        )

        let unpacker = EXT4Unpacker(
            capacityInBytes: UInt64(options.rootfsMiB) * bytesPerMiB
        )
        var rootfs = try await unpacker.unpack(
            image,
            for: platform,
            at: containerRoot.appendingPathComponent("rootfs.ext4")
        )
        rootfs.options.append("ro")

        let writablePath = containerRoot.appendingPathComponent("writable.ext4")
        let writableFormatter = try EXT4.Formatter(
            FilePath(writablePath.path),
            minDiskSize: UInt64(options.writableMiB) * bytesPerMiB
        )
        try writableFormatter.close()
        let writableLayer = Containerization.Mount.block(
            format: "ext4",
            source: writablePath.path,
            destination: "/"
        )
        let imageConfig = try await image.config(for: platform).config

        return try LinuxContainer(
            options.containerID,
            rootfs: rootfs,
            writableLayer: writableLayer,
            vmm: vmm
        ) { configuration in
            if let imageConfig {
                configuration.process = .init(from: imageConfig)
            }
            configuration.cpus = options.cpus
            configuration.memoryInBytes = UInt64(options.memoryMiB) * bytesPerMiB
            if !options.arguments.isEmpty {
                configuration.process.arguments = options.arguments
            }
            configuration.process.user = User(username: options.user)
            configuration.process.noNewPrivileges = true
            configuration.process.capabilities = LinuxCapabilities()
            configuration.process.rlimits = [
                LinuxRLimit(kind: .openFiles, limit: UInt64(options.openFileLimit)),
                LinuxRLimit(kind: .numberOfProcesses, limit: UInt64(options.processLimit)),
            ]
            configuration.process.stdin = stdin
            configuration.process.stdout = stdout
            configuration.process.stderr = stderr
            configuration.bootLog = BootLog.file(
                path: containerRoot.appendingPathComponent("boot.log")
            )
            if let stateSharePath = options.developerStateSharePath {
                configuration.mounts.append(
                    .share(source: stateSharePath, destination: "/opt/data")
                )
            }

            if options.networkEnabled {
                configuration.interfaces = [
                    NATInterface(
                        ipv4Address: try CIDRv4("192.168.64.2/24"),
                        ipv4Gateway: try IPv4Address("192.168.64.1")
                    )
                ]
                configuration.dns = DNS(nameservers: ["192.168.64.1"])
            }
        }
    }

    private static func prepareInitfs(
        reference: String,
        imageStore: ImageStore
    ) async throws -> Containerization.Mount {
        let initPath = imageStore.path.appendingPathComponent("initfs.ext4")
        let initImage = try await imageStore.getInitImage(reference: reference)
        do {
            return try await initImage.initBlock(at: initPath, for: .linuxArm)
        } catch let error as ContainerizationError where error.code == .exists {
            return .block(
                format: "ext4",
                source: initPath.path,
                destination: "/",
                options: ["ro"]
            )
        }
    }

    private static func image(
        reference: String,
        platform: Platform,
        imageStore: ImageStore
    ) async throws -> Containerization.Image {
        if let existing = try? await imageStore.get(reference: reference),
           (try? await existing.descriptor(for: platform)) != nil {
            return existing
        }
        if let digestMarker = reference.range(of: "@sha256:"),
           let existing = try? await imageStore.get(
               reference: String(reference[..<digestMarker.lowerBound])
           ),
           existing.descriptor.digest.description ==
               "sha256:\(reference[digestMarker.upperBound...])",
           (try? await existing.descriptor(for: platform)) != nil {
            return existing
        }
        if reference.hasPrefix("radius.local/") {
            throw RuntimeHostError.runtime(
                "Local agent image is not loaded in the selected runtime store: \(reference)"
            )
        }
        return try await imageStore.pull(reference: reference, platform: platform)
    }
}
