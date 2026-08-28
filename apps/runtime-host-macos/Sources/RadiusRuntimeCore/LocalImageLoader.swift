import Containerization
import Foundation

public struct LoadedImageReport: Encodable, Sendable {
    public let type = "radius.runtime.images-loaded"
    public let protocolVersion = 1
    public let images: [LoadedImage]

    public struct LoadedImage: Encodable, Sendable {
        public let reference: String
        public let digest: String
    }
}

public enum LocalImageLoader {
    public static func load(_ options: LoadImageOptions) async throws -> LoadedImageReport {
        let layoutURL = URL(fileURLWithPath: options.layoutPath)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        guard FileManager.default.fileExists(atPath: layoutURL.path) else {
            throw RuntimeHostError.invalidArguments(
                "OCI layout does not exist at \(layoutURL.path)"
            )
        }

        let rootURL = URL(fileURLWithPath: options.rootPath).standardizedFileURL
        try FileManager.default.createDirectory(
            at: rootURL,
            withIntermediateDirectories: true
        )
        let imageStore = try ImageStore(path: rootURL)
        let images = try await imageStore.load(from: layoutURL)
        return LoadedImageReport(
            images: images.map {
                LoadedImageReport.LoadedImage(
                    reference: $0.reference,
                    digest: $0.descriptor.digest.description
                )
            }
        )
    }
}
