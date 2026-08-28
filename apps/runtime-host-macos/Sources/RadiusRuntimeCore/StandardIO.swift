import Containerization
import Foundation

public final class StandardInputReader: @unchecked Sendable, ReaderStream {
    private let handle: FileHandle

    public init(handle: FileHandle = .standardInput) {
        self.handle = handle
    }

    public func stream() -> AsyncStream<Data> {
        let handle = self.handle
        return AsyncStream { continuation in
            handle.readabilityHandler = { readableHandle in
                let data = readableHandle.availableData
                if data.isEmpty {
                    readableHandle.readabilityHandler = nil
                    continuation.finish()
                } else {
                    continuation.yield(data)
                }
            }
            continuation.onTermination = { @Sendable _ in
                handle.readabilityHandler = nil
            }
        }
    }
}

public final class StandardOutputWriter: @unchecked Sendable, Writer {
    private let handle: FileHandle
    private let lock = NSLock()

    public init(handle: FileHandle) {
        self.handle = handle
    }

    public func write(_ data: Data) throws {
        lock.lock()
        defer { lock.unlock() }
        try handle.write(contentsOf: data)
    }

    public func close() throws {
        // Standard output and error belong to the helper process. The VM stream may
        // finish without closing the process-wide file descriptors.
    }
}
