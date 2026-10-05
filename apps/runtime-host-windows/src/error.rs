use std::fmt;
use std::io;
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeHostError {
    HelpRequested(String),
    InvalidArguments(String),
    Unsupported(String),
    Runtime(String),
}

impl RuntimeHostError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::HelpRequested(_) => "HELP",
            Self::InvalidArguments(_) => "INVALID_ARGUMENTS",
            Self::Unsupported(_) => "UNSUPPORTED_HOST",
            Self::Runtime(_) => "RUNTIME_FAILED",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::HelpRequested(message)
            | Self::InvalidArguments(message)
            | Self::Unsupported(message)
            | Self::Runtime(message) => message,
        }
    }

    pub fn exit_code(&self) -> i32 {
        match self {
            Self::HelpRequested(_) => 0,
            Self::InvalidArguments(_) => 64,
            Self::Unsupported(_) => 69,
            Self::Runtime(_) => 70,
        }
    }

    pub fn envelope(&self) -> RuntimeHostErrorEnvelope<'_> {
        RuntimeHostErrorEnvelope {
            code: self.code(),
            message: self.message(),
            protocol_version: 1,
            kind: "radius.runtime.error",
        }
    }
}

impl fmt::Display for RuntimeHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for RuntimeHostError {}

pub(crate) fn invalid(message: impl Into<String>) -> RuntimeHostError {
    RuntimeHostError::InvalidArguments(message.into())
}

pub(crate) fn runtime(message: impl Into<String>) -> RuntimeHostError {
    RuntimeHostError::Runtime(message.into())
}

pub(crate) fn io_failure(path: &Path, error: io::Error) -> RuntimeHostError {
    runtime(format!("{}: {error}", path.display()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHostErrorEnvelope<'a> {
    pub code: &'a str,
    pub message: &'a str,
    pub protocol_version: u32,
    #[serde(rename = "type")]
    pub kind: &'static str,
}
