param(
    [string] $ArchivePath
)

$ErrorActionPreference = 'Stop'

function Stop-WithError([int] $ExitCode, [string] $Message) {
    [Console]::Error.WriteLine($Message)
    exit $ExitCode
}

function Get-Sha256([string] $Path) {
    (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    Stop-WithError 69 'The Windows Radius runtime assets currently target x64 Windows.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $repoRoot 'apps\runtime-host-windows'
$manifestPath = Join-Path $packagePath 'Config\runtime-assets.json'
$assetRoot = Join-Path $packagePath '.build\runtime-assets'
$cacheRoot = Join-Path $assetRoot 'cache'
$cachedArchive = Join-Path $cacheRoot 'kernel.tar.zst'
$kernelOutput = Join-Path $assetRoot 'vmlinux-x64'

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$kernel = $manifest.kernel
foreach ($name in 'archiveUrl', 'archiveSha256', 'binaryPath', 'binarySha256') {
    if (-not $kernel -or [string]::IsNullOrWhiteSpace([string] $kernel.$name)) {
        Stop-WithError 65 "runtime-assets.json is missing kernel.$name"
    }
}

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

if ($ArchivePath) {
    if (-not (Test-Path -LiteralPath $ArchivePath)) {
        Stop-WithError 65 "Kernel archive not found: $ArchivePath"
    }
    $actual = Get-Sha256 $ArchivePath
    if ($actual -ne $kernel.archiveSha256) {
        Stop-WithError 65 "Kernel archive digest mismatch: expected $($kernel.archiveSha256), got $actual"
    }
    $archive = $ArchivePath
} else {
    $cacheIsValid = (Test-Path -LiteralPath $cachedArchive) -and ((Get-Sha256 $cachedArchive) -eq $kernel.archiveSha256)
    if (-not $cacheIsValid) {
        $partial = "$cachedArchive.partial"
        & curl.exe --fail --location --retry 3 --output $partial $kernel.archiveUrl
        if ($LASTEXITCODE -ne 0) {
            Stop-WithError $LASTEXITCODE "Kernel archive download failed: $($kernel.archiveUrl)"
        }
        $actual = Get-Sha256 $partial
        if ($actual -ne $kernel.archiveSha256) {
            Remove-Item -Force -LiteralPath $partial
            Stop-WithError 65 "Kernel archive digest mismatch: expected $($kernel.archiveSha256), got $actual"
        }
        Move-Item -Force -LiteralPath $partial -Destination $cachedArchive
    }
    $archive = $cachedArchive
}

$workDirectory = Join-Path ([IO.Path]::GetTempPath()) ("radius-runtime-assets-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDirectory | Out-Null
try {
    & tar.exe -xf $archive -C $workDirectory $kernel.binaryPath
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError 65 "Could not extract $($kernel.binaryPath) from $archive"
    }
    $extracted = Join-Path $workDirectory (($kernel.binaryPath -replace '^\./', '') -replace '/', '\')
    if (-not (Test-Path -LiteralPath $extracted) -or (Get-Item -LiteralPath $extracted).Length -eq 0) {
        Stop-WithError 65 "Prepared kernel is empty: $extracted"
    }
    $actual = Get-Sha256 $extracted
    if ($actual -ne $kernel.binarySha256) {
        Stop-WithError 65 "Kernel binary digest mismatch: expected $($kernel.binarySha256), got $actual"
    }
    Copy-Item -Force -LiteralPath $extracted -Destination $kernelOutput
} finally {
    Remove-Item -Recurse -Force -LiteralPath $workDirectory -ErrorAction SilentlyContinue
}

Write-Output $kernelOutput
