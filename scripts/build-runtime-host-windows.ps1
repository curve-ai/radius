param(
    [string] $OpenVmmExe,
    [string] $CertificateThumbprint,
    [string] $TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..\apps\runtime-host-windows')).Path
$release = Join-Path $app '.build\release'
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

function Invoke-Checked([string] $What, [scriptblock] $Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

foreach ($guest in 'radius-vminit', 'radius-rootfs-builder') {
    Push-Location (Join-Path $app "guest\$guest")
    try { Invoke-Checked "cargo build ($guest)" { cargo build --release } } finally { Pop-Location }
}

Push-Location $app
try { Invoke-Checked 'cargo build (radius-runtime-host)' { cargo build --release } } finally { Pop-Location }

$manifest = Get-Content (Join-Path $app 'Config\runtime-assets.json') -Raw | ConvertFrom-Json
$openvmm = Join-Path $release 'openvmm.exe'
if ($OpenVmmExe) { Copy-Item -Force $OpenVmmExe $openvmm }
if (-not (Test-Path $openvmm)) {
    throw "openvmm.exe is missing. Pass -OpenVmmExe with an openvmm.exe built from revision $($manifest.openvmmRevision)."
}
$version = (cmd /c "`"$openvmm`" --version 2>&1") -join "`n"
if (-not $version.Contains($manifest.openvmmRevision)) {
    throw "openvmm.exe is not built from the pinned revision $($manifest.openvmmRevision):`n$version"
}

$helper = Join-Path $release 'radius-runtime-host.exe'
if ($CertificateThumbprint) {
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
        Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
    if (-not $signtool) { throw 'signtool.exe was not found. Install the Windows SDK.' }
    Invoke-Checked 'signtool sign' {
        & $signtool.FullName sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $helper $openvmm
    }
    Invoke-Checked 'signtool verify' { & $signtool.FullName verify /pa $helper $openvmm }
} else {
    Write-Host 'Not signed. Pass -CertificateThumbprint to sign; development builds may stay unsigned.'
}

$doctor = (cmd /c "`"$helper`" doctor --json") -join ''
Write-Host $doctor
if (-not ($doctor | ConvertFrom-Json).supported) { throw 'doctor reports that this computer cannot run agents.' }
Write-Host "Built $helper and $openvmm"
