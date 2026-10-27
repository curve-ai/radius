$ErrorActionPreference = "Stop"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outputRoot = Join-Path $repositoryRoot "apps/runtime-host-windows/.build/provider-assets"

if (Test-Path $outputRoot) { Remove-Item $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-fx-agent-windows.ps1")
if ($LASTEXITCODE -ne 0) { throw "failed to prepare the fx agent" }

Copy-Item (Join-Path $repositoryRoot "apps/runtime-host-windows/Config/bundled-agents.json") (Join-Path $outputRoot "index.json")

Write-Output $outputRoot
