import Foundation

public enum RuntimeHostError: Error, Equatable, Sendable {
    case helpRequested(String)
    case invalidArguments(String)
    case unsupported(String)
    case runtime(String)

    public var code: String {
        switch self {
        case .helpRequested:
            "HELP"
        case .invalidArguments:
            "INVALID_ARGUMENTS"
        case .unsupported:
            "UNSUPPORTED_HOST"
        case .runtime:
            "RUNTIME_FAILED"
        }
    }

    public var message: String {
        switch self {
        case .helpRequested(let message), .invalidArguments(let message),
             .unsupported(let message), .runtime(let message):
            message
        }
    }

    public var exitCode: Int32 {
        switch self {
        case .helpRequested:
            0
        case .invalidArguments:
            64
        case .unsupported:
            69
        case .runtime:
            70
        }
    }
}

public struct RuntimeHostErrorEnvelope: Encodable, Equatable, Sendable {
    public let type = "radius.runtime.error"
    public let protocolVersion = 1
    public let code: String
    public let message: String

    public init(error: RuntimeHostError) {
        code = error.code
        message = error.message
    }
}
