param([string]$PythonBase = '', [string]$EngineSite = '', [string]$NodeVersion = '24.21.0', [switch]$Resume)
$ErrorActionPreference='Stop'
$portableRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $portableRoot
if (-not $PythonBase) {
 $portablePython=Get-ChildItem -LiteralPath '.runtime/python' -Directory | Where-Object { -not $_.LinkTarget -and (Test-Path -LiteralPath (Join-Path $_.FullName 'python.exe')) } | Select-Object -First 1
 if (-not $portablePython) {throw 'Run npm run setup:engine on the build machine first.'}
 $PythonBase=$portablePython.FullName
}
if (-not $EngineSite) { $EngineSite=Join-Path $portableRoot '.runtime/pdf2zh-next/.venv/Lib/site-packages' }
$portableBuildArgs=@('scripts/portable/build.py','--python-base',$PythonBase,'--engine-site',$EngineSite,'--node-version',$NodeVersion)
if ($Resume) {$portableBuildArgs+='--resume'}
& (Join-Path $PythonBase 'python.exe') @portableBuildArgs
if ($LASTEXITCODE -ne 0) {throw 'Portable build failed.'}
