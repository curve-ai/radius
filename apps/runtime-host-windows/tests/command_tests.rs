use std::path::PathBuf;

use radius_runtime_host::{
    HostFacts, HypervisorPlatformStatus, LoadImageOptions, RunOptions, RuntimeCommand,
    RuntimeDoctorReport, RuntimeHostError, WindowsVersion,
};

const KERNEL: &str = "C:\\radius\\vmlinux";
const ROOT: &str = "C:\\radius\\runtime";

fn pinned_image(fill: char) -> String {
    format!(
        "example.invalid/agent@sha256:{}",
        fill.to_string().repeat(64)
    )
}

fn run_options(arguments: &[&str]) -> RunOptions {
    match RuntimeCommand::parse(arguments) {
        Ok(RuntimeCommand::Run(options)) => *options,
        other => panic!("Expected run command, got {other:?}"),
    }
}

fn invalid_message(result: Result<RuntimeCommand, RuntimeHostError>) -> String {
    match result {
        Err(RuntimeHostError::InvalidArguments(message)) => message,
        other => panic!("Expected INVALID_ARGUMENTS, got {other:?}"),
    }
}

fn scratch_directory(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "radius-runtime-host-test-{}-{name}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).expect("create scratch directory");
    directory
}

#[test]
fn doctor_parses_json_mode() {
    assert_eq!(
        RuntimeCommand::parse(&["doctor", "--json"]),
        Ok(RuntimeCommand::Doctor { json: true })
    );
}

#[test]
fn load_image_requires_explicit_layout_and_store() {
    assert_eq!(
        RuntimeCommand::parse(&[
            "load-image",
            "--layout",
            "C:\\layout",
            "--root",
            "C:\\store"
        ]),
        Ok(RuntimeCommand::LoadImage(LoadImageOptions {
            layout_path: "C:\\layout".to_owned(),
            root_path: "C:\\store".to_owned(),
        }))
    );
}

#[test]
fn run_requires_digest_by_default() {
    let message = invalid_message(RuntimeCommand::parse(&[
        "run",
        "--image",
        "example.invalid/agent:latest",
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
    ]));
    assert!(message.contains("sha256 digest"), "{message}");
}

#[test]
fn run_parses_hardened_defaults() {
    let image = pinned_image('a');
    let options = run_options(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--",
        "/agent/start",
        "--stdio",
    ]);
    assert_eq!(options.cpus, 2);
    assert_eq!(options.memory_mib, 4_096);
    assert_eq!(options.rootfs_mib, 5_120);
    assert_eq!(options.writable_mib, 5_120);
    assert_eq!(options.process_limit, 256);
    assert_eq!(options.open_file_limit, 1_024);
    assert_eq!(options.user, "1000:1000");
    assert_eq!(options.developer_state_share_path, None);
    assert!(options.network_enabled);
    assert_eq!(options.arguments, ["/agent/start", "--stdio"]);
    assert_eq!(options.initfs_reference, None);
    assert!(
        options.container_id.starts_with("radius-agent-"),
        "{}",
        options.container_id
    );
    assert!(!options.allow_unpinned_image);
    assert!(!options.allow_root);
}

#[test]
fn run_parses_release_resource_limits() {
    let image = pinned_image('e');
    let options = run_options(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--process-limit",
        "384",
        "--open-file-limit",
        "2048",
    ]);
    assert_eq!(options.process_limit, 384);
    assert_eq!(options.open_file_limit, 2_048);
}

#[test]
fn state_share_rejects_paths_outside_radius_application_data() {
    let image = pinned_image('d');
    let outside = std::env::temp_dir();
    let message = invalid_message(RuntimeCommand::parse(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--developer-state-share",
        outside.to_str().expect("temp dir is valid Unicode"),
    ]));
    assert!(message.contains("beneath"), "{message}");
}

#[test]
fn rosetta_is_rejected_on_windows() {
    let image = pinned_image('c');
    let message = invalid_message(RuntimeCommand::parse(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--rosetta",
    ]));
    assert!(message.contains("linux/amd64"), "{message}");
}

#[test]
fn root_requires_explicit_developer_escape_hatch() {
    let image = pinned_image('b');
    let message = invalid_message(RuntimeCommand::parse(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--user",
        "0:0",
    ]));
    assert!(message.contains("non-root"), "{message}");

    let options = run_options(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--user",
        "0:0",
        "--allow-root",
    ]);
    assert_eq!(options.user, "0:0");
    assert!(options.allow_root);
}

#[test]
fn doctor_explains_unsupported_host() {
    let report = RuntimeDoctorReport::evaluate(&HostFacts {
        architecture: "aarch64".to_owned(),
        windows_version: WindowsVersion {
            major: 10,
            minor: 0,
            build: 19045,
        },
        hypervisor_platform: HypervisorPlatformStatus::NotInstalled,
    });
    assert!(!report.supported);
    assert_eq!(report.reasons.len(), 3, "{:?}", report.reasons);
}

#[test]
fn doctor_reports_a_ready_host() {
    let report = RuntimeDoctorReport::evaluate(&HostFacts {
        architecture: "x86_64".to_owned(),
        windows_version: WindowsVersion {
            major: 10,
            minor: 0,
            build: 26200,
        },
        hypervisor_platform: HypervisorPlatformStatus::Available,
    });
    assert!(report.supported);
    assert!(report.reasons.is_empty());
    assert!(report.hypervisor_platform_available);
    assert_eq!(report.operating_system_version, "10.0.26200");
}

#[test]
fn doctor_explains_each_hypervisor_problem() {
    let facts = |hypervisor_platform| HostFacts {
        architecture: "x86_64".to_owned(),
        windows_version: WindowsVersion {
            major: 10,
            minor: 0,
            build: 26200,
        },
        hypervisor_platform,
    };
    for status in [
        HypervisorPlatformStatus::NotInstalled,
        HypervisorPlatformStatus::HypervisorNotPresent,
        HypervisorPlatformStatus::Failed {
            operation: "WHvCreatePartition",
            hresult: -2_147_024_891,
        },
    ] {
        let report = RuntimeDoctorReport::evaluate(&facts(status.clone()));
        assert!(!report.supported, "{status:?}");
        assert_eq!(report.reasons.len(), 1, "{status:?}");
    }
    let failed = RuntimeDoctorReport::evaluate(&facts(HypervisorPlatformStatus::Failed {
        operation: "WHvCreatePartition",
        hresult: -2_147_024_891,
    }));
    assert!(
        failed.reasons[0].contains("0x80070005"),
        "{}",
        failed.reasons[0]
    );
}

#[test]
fn doctor_json_uses_the_shared_report_shape() {
    let report = RuntimeDoctorReport::evaluate(&HostFacts {
        architecture: "x86_64".to_owned(),
        windows_version: WindowsVersion {
            major: 10,
            minor: 0,
            build: 26200,
        },
        hypervisor_platform: HypervisorPlatformStatus::Available,
    });
    let json = serde_json::to_value(&report).expect("report serializes");
    assert_eq!(json["type"], "radius.runtime.doctor");
    assert_eq!(json["protocolVersion"], 1);
    assert_eq!(json["supported"], true);
    assert_eq!(json["reasons"], serde_json::json!([]));
    assert_eq!(json["backend"], "openvmm-whp");

    let text = serde_json::to_string(&report).expect("report serializes");
    let keys: Vec<&str> = json
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    let mut sorted = keys.clone();
    sorted.sort_unstable();
    assert_eq!(keys, sorted);
    assert!(text.starts_with("{\"architecture\":"), "{text}");
}

#[test]
fn error_envelope_matches_the_macos_helper() {
    let error = RuntimeHostError::InvalidArguments("Missing required option --image".to_owned());
    assert_eq!(
        serde_json::to_string(&error.envelope()).expect("envelope serializes"),
        r#"{"code":"INVALID_ARGUMENTS","message":"Missing required option --image","protocolVersion":1,"type":"radius.runtime.error"}"#
    );
    assert_eq!(
        RuntimeHostError::HelpRequested(String::new()).exit_code(),
        0
    );
    assert_eq!(
        RuntimeHostError::InvalidArguments(String::new()).exit_code(),
        64
    );
    assert_eq!(RuntimeHostError::Unsupported(String::new()).exit_code(), 69);
    assert_eq!(RuntimeHostError::Runtime(String::new()).exit_code(), 70);
}

#[test]
fn run_rejects_unknown_and_duplicate_options() {
    let image = pinned_image('f');
    let unknown = invalid_message(RuntimeCommand::parse(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--gpu",
    ]));
    assert_eq!(unknown, "Unknown run option '--gpu'");

    let duplicate = invalid_message(RuntimeCommand::parse(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--cpus",
        "2",
        "--cpus",
        "4",
    ]));
    assert_eq!(duplicate, "Duplicate option --cpus");

    let zero = invalid_message(RuntimeCommand::parse(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--memory-mb",
        "0",
    ]));
    assert_eq!(zero, "--memory-mb must be a positive integer");
}

#[test]
fn arguments_after_the_separator_belong_to_the_agent() {
    let image = pinned_image('1');
    let options = run_options(&[
        "run",
        "--image",
        image.as_str(),
        "--kernel",
        KERNEL,
        "--root",
        ROOT,
        "--",
        "--cpus",
        "9",
    ]);
    assert_eq!(options.cpus, 2);
    assert_eq!(options.arguments, ["--cpus", "9"]);
}

#[test]
fn state_share_accepts_only_existing_directories_beneath_radius_application_data() {
    let app_data = scratch_directory("share-rules");
    let state = app_data.join("Radius").join("dev").join("state");
    std::fs::create_dir_all(&state).expect("create state directory");
    let image = pinned_image('2');
    let parse = |share: &str| {
        RunOptions::parse_with_app_data(
            &[
                "--image",
                image.as_str(),
                "--kernel",
                KERNEL,
                "--root",
                ROOT,
                "--developer-state-share",
                share,
            ],
            Some(&app_data),
        )
    };

    let accepted =
        parse(state.to_str().expect("valid Unicode")).expect("share beneath Radius is accepted");
    assert!(
        accepted
            .developer_state_share_path
            .as_ref()
            .is_some_and(|path| path.ends_with("state")),
        "{accepted:?}"
    );

    let escape = app_data
        .join("Radius")
        .join("dev")
        .join("..")
        .join("..")
        .join("elsewhere");
    std::fs::create_dir_all(app_data.join("elsewhere")).expect("create sibling directory");
    assert!(matches!(
        parse(escape.to_str().expect("valid Unicode")),
        Err(RuntimeHostError::InvalidArguments(message)) if message.contains("beneath")
    ));

    let radius_itself = app_data.join("Radius");
    assert!(matches!(
        parse(radius_itself.to_str().expect("valid Unicode")),
        Err(RuntimeHostError::InvalidArguments(message)) if message.contains("beneath")
    ));

    let missing = app_data.join("Radius").join("missing");
    assert!(matches!(
        parse(missing.to_str().expect("valid Unicode")),
        Err(RuntimeHostError::InvalidArguments(message)) if message.contains("existing directory")
    ));

    let distribution_state = app_data
        .join("Radius-acme")
        .join("runtime-auth")
        .join("fx-1");
    std::fs::create_dir_all(&distribution_state).expect("create distribution state directory");
    assert!(
        parse(distribution_state.to_str().expect("valid Unicode")).is_ok(),
        "share beneath Radius-<id> is accepted"
    );
    for rejected in ["Radius-", "Radiusx"] {
        let other = app_data.join(rejected).join("state");
        std::fs::create_dir_all(&other).expect("create lookalike directory");
        assert!(matches!(
            parse(other.to_str().expect("valid Unicode")),
            Err(RuntimeHostError::InvalidArguments(message)) if message.contains("beneath")
        ));
    }

    if cfg!(windows) {
        let shouted = state.to_str().expect("valid Unicode").to_uppercase();
        assert!(
            parse(&shouted).is_ok(),
            "Windows paths compare case-insensitively"
        );
    }

    let _ = std::fs::remove_dir_all(&app_data);
}
