use serde::Serialize;

pub const OPENVMM_REVISION: &str = "a66e4f8345d304f78cd2059a80d72c77f3265086";

pub const MINIMUM_WINDOWS_BUILD: u32 = 22000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowsVersion {
    pub major: u32,
    pub minor: u32,
    pub build: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HypervisorPlatformStatus {
    Available,
    NotInstalled,
    HypervisorNotPresent,
    Failed {
        operation: &'static str,
        hresult: i32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostFacts {
    pub architecture: String,
    pub windows_version: WindowsVersion,
    pub hypervisor_platform: HypervisorPlatformStatus,
}

impl HostFacts {
    pub fn current() -> Self {
        Self {
            architecture: std::env::consts::ARCH.to_owned(),
            windows_version: platform::windows_version(),
            hypervisor_platform: platform::hypervisor_platform_status(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDoctorReport {
    pub architecture: String,
    pub backend: &'static str,
    pub hypervisor_platform_available: bool,
    pub minimum_windows_build: u32,
    pub openvmm_revision: &'static str,
    pub operating_system_version: String,
    pub protocol_version: u32,
    pub reasons: Vec<String>,
    pub supported: bool,
    #[serde(rename = "type")]
    pub kind: &'static str,
}

impl RuntimeDoctorReport {
    pub fn current() -> Self {
        Self::evaluate(&HostFacts::current())
    }

    pub fn evaluate(facts: &HostFacts) -> Self {
        let mut reasons = Vec::new();

        if facts.architecture != "x86_64" {
            reasons.push(
                "The Windows runtime currently requires an x64 (Intel or AMD) processor."
                    .to_owned(),
            );
        }

        let version = facts.windows_version;
        if (version.major, version.build) < (10, MINIMUM_WINDOWS_BUILD) {
            reasons.push(format!(
                "The Windows runtime currently requires Windows 11 (build {MINIMUM_WINDOWS_BUILD}) or newer."
            ));
        }

        match &facts.hypervisor_platform {
            HypervisorPlatformStatus::Available => {}
            HypervisorPlatformStatus::NotInstalled => reasons.push(
                "Windows Hypervisor Platform is not turned on. Enable the \"Windows Hypervisor Platform\" Windows feature, then restart."
                    .to_owned(),
            ),
            HypervisorPlatformStatus::HypervisorNotPresent => reasons.push(
                "No hypervisor is running. Turn on virtualization in the firmware (BIOS/UEFI) settings and enable \"Windows Hypervisor Platform\"."
                    .to_owned(),
            ),
            HypervisorPlatformStatus::Failed { operation, hresult } => reasons.push(format!(
                "Windows Hypervisor Platform could not create a virtual machine ({operation} failed with HRESULT {hresult:#010x})."
            )),
        }

        Self {
            architecture: facts.architecture.clone(),
            backend: "openvmm-whp",
            hypervisor_platform_available: facts.hypervisor_platform
                == HypervisorPlatformStatus::Available,
            minimum_windows_build: MINIMUM_WINDOWS_BUILD,
            openvmm_revision: OPENVMM_REVISION,
            operating_system_version: format!(
                "{}.{}.{}",
                version.major, version.minor, version.build
            ),
            protocol_version: 1,
            supported: reasons.is_empty(),
            reasons,
            kind: "radius.runtime.doctor",
        }
    }
}

#[cfg(windows)]
mod platform {
    use core::ffi::{CStr, c_void};
    use core::mem::transmute;
    use core::ptr::null_mut;

    use super::{HypervisorPlatformStatus, WindowsVersion};

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleW(module_name: *const u16) -> *mut c_void;
        fn LoadLibraryExW(file_name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, proc_name: *const u8) -> *mut c_void;
        fn FreeLibrary(module: *mut c_void) -> i32;
    }

    const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x0000_0800;
    const WHV_CAPABILITY_CODE_HYPERVISOR_PRESENT: u32 = 0x0000_0000;
    const WHV_PARTITION_PROPERTY_CODE_PROCESSOR_COUNT: u32 = 0x0000_1FFF;

    type RtlGetVersion = unsafe extern "system" fn(info: *mut OsVersionInfoW) -> i32;
    type WhvGetCapability = unsafe extern "system" fn(
        code: u32,
        buffer: *mut c_void,
        size: u32,
        written: *mut u32,
    ) -> i32;
    type WhvCreatePartition = unsafe extern "system" fn(partition: *mut *mut c_void) -> i32;
    type WhvSetPartitionProperty = unsafe extern "system" fn(
        partition: *mut c_void,
        code: u32,
        buffer: *const c_void,
        size: u32,
    ) -> i32;
    type WhvPartitionCall = unsafe extern "system" fn(partition: *mut c_void) -> i32;

    #[repr(C)]
    struct OsVersionInfoW {
        os_version_info_size: u32,
        major_version: u32,
        minor_version: u32,
        build_number: u32,
        platform_id: u32,
        csd_version: [u16; 128],
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    /// GetVersionEx under-reports without a manifest, so use RtlGetVersion.
    pub fn windows_version() -> WindowsVersion {
        let unknown = WindowsVersion {
            major: 0,
            minor: 0,
            build: 0,
        };
        let name = wide("ntdll.dll");
        // SAFETY: `name` is a NUL-terminated UTF-16 string; ntdll.dll is loaded in every Windows process.
        let ntdll = unsafe { GetModuleHandleW(name.as_ptr()) };
        if ntdll.is_null() {
            return unknown;
        }
        // SAFETY: `ntdll` is a valid module handle and the name is NUL-terminated.
        let address = unsafe { GetProcAddress(ntdll, c"RtlGetVersion".as_ptr().cast()) };
        if address.is_null() {
            return unknown;
        }
        // SAFETY: RtlGetVersion has this signature on every supported Windows version.
        let rtl_get_version: RtlGetVersion = unsafe { transmute(address) };
        let mut info = OsVersionInfoW {
            os_version_info_size: u32::try_from(size_of::<OsVersionInfoW>())
                .expect("struct size fits in u32"),
            major_version: 0,
            minor_version: 0,
            build_number: 0,
            platform_id: 0,
            csd_version: [0; 128],
        };
        // SAFETY: `info` is a correctly sized, writable RTL_OSVERSIONINFOW.
        if unsafe { rtl_get_version(&raw mut info) } < 0 {
            return unknown;
        }
        WindowsVersion {
            major: info.major_version,
            minor: info.minor_version,
            build: info.build_number,
        }
    }

    pub fn hypervisor_platform_status() -> HypervisorPlatformStatus {
        let name = wide("WinHvPlatform.dll");
        // SAFETY: `name` is NUL-terminated; searching only System32 avoids loading a planted DLL.
        let library =
            unsafe { LoadLibraryExW(name.as_ptr(), null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32) };
        if library.is_null() {
            return HypervisorPlatformStatus::NotInstalled;
        }
        // SAFETY: `library` is the WinHvPlatform.dll handle loaded above.
        let status = unsafe { probe(library) };
        // SAFETY: balances the LoadLibraryExW call above.
        unsafe { FreeLibrary(library) };
        status
    }

    /// # Safety
    /// `library` must be a loaded WinHvPlatform.dll module handle.
    unsafe fn probe(library: *mut c_void) -> HypervisorPlatformStatus {
        // SAFETY: `library` is valid per this function's contract and names are NUL-terminated.
        let lookup = |name: &CStr| unsafe { GetProcAddress(library, name.as_ptr().cast()) };
        let addresses = [
            lookup(c"WHvGetCapability"),
            lookup(c"WHvCreatePartition"),
            lookup(c"WHvSetPartitionProperty"),
            lookup(c"WHvSetupPartition"),
            lookup(c"WHvDeletePartition"),
        ];
        if addresses.iter().any(|address| address.is_null()) {
            return HypervisorPlatformStatus::NotInstalled;
        }
        // SAFETY: these are the documented WinHvPlatform.h signatures.
        let (get_capability, create_partition, set_property, setup_partition, delete_partition) = unsafe {
            (
                transmute::<*mut c_void, WhvGetCapability>(addresses[0]),
                transmute::<*mut c_void, WhvCreatePartition>(addresses[1]),
                transmute::<*mut c_void, WhvSetPartitionProperty>(addresses[2]),
                transmute::<*mut c_void, WhvPartitionCall>(addresses[3]),
                transmute::<*mut c_void, WhvPartitionCall>(addresses[4]),
            )
        };

        let mut present: i32 = 0;
        let mut written: u32 = 0;
        // SAFETY: WHvCapabilityCodeHypervisorPresent fills a 4-byte BOOL.
        let hresult = unsafe {
            get_capability(
                WHV_CAPABILITY_CODE_HYPERVISOR_PRESENT,
                (&raw mut present).cast(),
                4,
                &raw mut written,
            )
        };
        if hresult < 0 {
            return HypervisorPlatformStatus::Failed {
                operation: "WHvGetCapability",
                hresult,
            };
        }
        if present == 0 {
            return HypervisorPlatformStatus::HypervisorNotPresent;
        }

        let mut partition: *mut c_void = null_mut();
        // SAFETY: `partition` is a valid out-pointer.
        let hresult = unsafe { create_partition(&raw mut partition) };
        if hresult < 0 {
            return HypervisorPlatformStatus::Failed {
                operation: "WHvCreatePartition",
                hresult,
            };
        }

        let processors: u32 = 1;
        let mut operation = "WHvSetPartitionProperty";
        // SAFETY: `partition` was created above; the processor-count property is a 4-byte UINT32.
        let mut hresult = unsafe {
            set_property(
                partition,
                WHV_PARTITION_PROPERTY_CODE_PROCESSOR_COUNT,
                (&raw const processors).cast(),
                4,
            )
        };
        if hresult >= 0 {
            operation = "WHvSetupPartition";
            // SAFETY: `partition` is a configured, not yet set up partition.
            hresult = unsafe { setup_partition(partition) };
        }
        // SAFETY: deletes the partition created above exactly once.
        unsafe { delete_partition(partition) };

        if hresult < 0 {
            HypervisorPlatformStatus::Failed { operation, hresult }
        } else {
            HypervisorPlatformStatus::Available
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{HypervisorPlatformStatus, WindowsVersion};

    pub fn windows_version() -> WindowsVersion {
        WindowsVersion {
            major: 0,
            minor: 0,
            build: 0,
        }
    }

    pub fn hypervisor_platform_status() -> HypervisorPlatformStatus {
        HypervisorPlatformStatus::NotInstalled
    }
}
