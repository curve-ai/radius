import Containerization
import Foundation

public enum RuntimeRunner {
    public static func run(_ options: RunOptions) async throws -> Int32 {
        let report = RuntimeDoctorReport.current()
        guard report.supported else {
            throw RuntimeHostError.unsupported(report.reasons.joined(separator: " "))
        }

        let kernelURL = URL(fileURLWithPath: options.kernelPath).standardizedFileURL
        guard FileManager.default.fileExists(atPath: kernelURL.path) else {
            throw RuntimeHostError.invalidArguments("Kernel does not exist at \(kernelURL.path)")
        }

        let rootURL = URL(fileURLWithPath: options.rootPath).standardizedFileURL
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)

        let stdin = StandardInputReader()
        let stdout = StandardOutputWriter(handle: .standardOutput)
        let stderr = StandardOutputWriter(handle: .standardError)
        let container = try await PlatformContainerFactory.create(
            options: options,
            kernelURL: kernelURL,
            rootURL: rootURL,
            stdin: stdin,
            stdout: stdout,
            stderr: stderr
        )

        do {
            try await container.create()
            try await container.start()
            let status = try await container.wait()
            try await container.stop()
            return Int32(status.exitCode)
        } catch {
            try? await container.stop()
            throw RuntimeHostError.runtime(String(describing: error))
        }
    }
}
