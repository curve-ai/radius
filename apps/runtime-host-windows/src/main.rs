use std::io::Write;
use std::process::ExitCode;

use radius_runtime_host::{RuntimeCommand, RuntimeDoctorReport, RuntimeHostError};
use serde::Serialize;

fn main() -> ExitCode {
    let exit_code = match run() {
        Ok(exit_code) => exit_code,
        Err(RuntimeHostError::HelpRequested(usage)) => {
            println!("{usage}");
            0
        }
        Err(error) => {
            write_json_line(&mut std::io::stderr(), &error.envelope());
            error.exit_code()
        }
    };
    ExitCode::from(u8::try_from(exit_code).unwrap_or(70))
}

fn run() -> Result<i32, RuntimeHostError> {
    let arguments = std::env::args_os()
        .skip(1)
        .map(|argument| {
            argument.into_string().map_err(|_| {
                RuntimeHostError::InvalidArguments("Arguments must be valid Unicode.".to_owned())
            })
        })
        .collect::<Result<Vec<String>, RuntimeHostError>>()?;

    match RuntimeCommand::parse(&arguments)? {
        RuntimeCommand::Doctor { json } => {
            let report = RuntimeDoctorReport::current();
            if json {
                write_json_line(&mut std::io::stdout(), &report);
            } else {
                println!(
                    "Radius runtime: {}",
                    if report.supported {
                        "ready"
                    } else {
                        "unavailable"
                    }
                );
                println!("Backend: {} {}", report.backend, report.openvmm_revision);
                println!(
                    "Host: Windows {} {}",
                    report.operating_system_version, report.architecture
                );
                for reason in &report.reasons {
                    println!("- {reason}");
                }
            }
            Ok(if report.supported { 0 } else { 69 })
        }
        RuntimeCommand::LoadImage(options) => {
            let report = radius_runtime_host::image_store::load(&options)?;
            write_json_line(&mut std::io::stdout(), &report);
            Ok(0)
        }
        RuntimeCommand::Run(options) => radius_runtime_host::runner::run(&options),
    }
}

fn write_json_line<W: Write, T: Serialize>(writer: &mut W, value: &T) {
    if let Ok(mut line) = serde_json::to_vec(value) {
        line.push(b'\n');
        let _ = writer.write_all(&line);
        let _ = writer.flush();
    }
}
