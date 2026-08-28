import Foundation
import RadiusRuntimeCore

@main
struct RadiusRuntimeHost {
    static func main() async {
        do {
            let command = try RuntimeCommand.parse(Array(CommandLine.arguments.dropFirst()))
            switch command {
            case .doctor(let json):
                let report = RuntimeDoctorReport.current()
                if json {
                    try writeJSON(report, to: .standardOutput)
                } else {
                    print("Radius runtime: \(report.supported ? "ready" : "unavailable")")
                    print("Backend: \(report.backend) \(report.containerizationVersion)")
                    print("Host: macOS \(report.operatingSystemVersion) \(report.architecture)")
                    for reason in report.reasons {
                        print("- \(reason)")
                    }
                }
                Foundation.exit(report.supported ? 0 : 69)
            case .loadImage(let options):
                let report = try await LocalImageLoader.load(options)
                try writeJSON(report, to: .standardOutput)
            case .run(let options):
                let exitCode = try await RuntimeRunner.run(options)
                Foundation.exit(exitCode)
            }
        } catch let error as RuntimeHostError {
            if case .helpRequested(let usage) = error {
                print(usage)
            } else {
                try? writeJSON(RuntimeHostErrorEnvelope(error: error), to: .standardError)
            }
            Foundation.exit(error.exitCode)
        } catch {
            let wrapped = RuntimeHostError.runtime(String(describing: error))
            try? writeJSON(RuntimeHostErrorEnvelope(error: wrapped), to: .standardError)
            Foundation.exit(wrapped.exitCode)
        }
    }

    private static func writeJSON<T: Encodable>(_ value: T, to handle: FileHandle) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var data = try encoder.encode(value)
        data.append(0x0A)
        try handle.write(contentsOf: data)
    }
}
