$ErrorActionPreference = "Stop"

$fxVersion = "0.0.10"
$linuxArchive = "fx-linux-x86_64.tar.gz"
$linuxSha256 = "45bf4d88e786f549039a10ce1402831b9937e716956a6ef905a0d3cbe6bd97af"
# A dated curl bundle never changes; to update, change the date and this hash together.
$caBundleSource = "https://curl.se/ca/cacert-2026-09-25.pem"
$caBundleSha256 = "a41b5d356aea97a529fe27e0f7316d2f9d946d75927476cf9cf1b90637d00505"
$releaseBase = "https://github.com/vercel-labs/fx/releases/download/v$fxVersion"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outputRoot = Join-Path $repositoryRoot "apps/runtime-host-windows/.build/provider-assets/fx"
$releaseTemplate = Join-Path $repositoryRoot "apps/runtime-host-windows/Config/fx-release-template.json"
$template = Get-Content -Raw -Path $releaseTemplate | ConvertFrom-Json
$radiusReleaseVersion = $template.releaseVersion
$imageReference = $template.image.reference

function Test-Sha256 {
    param([string]$Path, [string]$Expected, [string]$Label)
    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected) {
        throw "$Label checksum mismatch: expected $Expected, got $actual"
    }
}

$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) ("radius-fx-win-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
try {
    $archivePath = Join-Path $stageDir $linuxArchive
    Invoke-WebRequest -Uri "$releaseBase/$linuxArchive" -OutFile $archivePath
    Test-Sha256 -Path $archivePath -Expected $linuxSha256 -Label "fx linux archive"

    $caBundlePath = Join-Path $stageDir "cacert.pem"
    Invoke-WebRequest -Uri $caBundleSource -OutFile $caBundlePath
    Test-Sha256 -Path $caBundlePath -Expected $caBundleSha256 -Label "CA bundle"

    $linuxDir = Join-Path $stageDir "linux"
    New-Item -ItemType Directory -Path $linuxDir -Force | Out-Null
    & "$env:WINDIR\System32\tar.exe" -xzf $archivePath -C $linuxDir
    if ($LASTEXITCODE -ne 0) { throw "failed to extract $linuxArchive" }
    $fxBinary = Join-Path $linuxDir "fx"
    if (-not (Test-Path $fxBinary)) { throw "fx release archive did not contain a Linux fx binary" }

    $preparedRoot = Join-Path $stageDir "prepared"
    $noticesDir = Join-Path $preparedRoot "notices"
    New-Item -ItemType Directory -Path $noticesDir -Force | Out-Null
    foreach ($notice in "LICENSE", "THIRD_PARTY_NOTICES.md") {
        $source = Join-Path $linuxDir $notice
        if (Test-Path $source) { Copy-Item $source (Join-Path $noticesDir $notice) }
    }
    "Source: $caBundleSource`nSHA-256: $caBundleSha256`n" |
        Set-Content -Path (Join-Path $noticesDir "CA_BUNDLE_SOURCE.txt") -Encoding ascii

    $ociLayoutDir = Join-Path $preparedRoot "oci-layout"
    $builder = Join-Path $repositoryRoot "scripts/build-binary-agent-oci-layout-windows.py"
    $python = "python"
    try {
        $probe = & python3 --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $probe -match "^Python \d") { $python = "python3" }
    } catch {}
    & $python $builder $fxBinary $ociLayoutDir $imageReference $radiusReleaseVersion $caBundlePath $releaseTemplate
    if ($LASTEXITCODE -ne 0) { throw "failed to build the fx OCI layout" }

    if (Test-Path $outputRoot) { Remove-Item $outputRoot -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path $outputRoot -Parent) -Force | Out-Null
    Move-Item $preparedRoot $outputRoot

    Write-Output $outputRoot
}
finally {
    Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue
}
