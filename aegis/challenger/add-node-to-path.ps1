# Add Node.js to the current user's PATH (idempotent; no admin needed).
# Usage: double-click fix-path.cmd (or run this with powershell -ExecutionPolicy Bypass -File)
$ErrorActionPreference = "Continue"

Write-Host "=== Add Node.js to user PATH ==="
Write-Host ""

# 1) locate node.exe: PATH first, then common install dirs
$nodeDir = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd -and $cmd.Source) { $nodeDir = Split-Path $cmd.Source -Parent }

$candidates = @(
  "C:\Program Files\nodejs",
  "C:\Program Files (x86)\nodejs",
  (Join-Path $env:LOCALAPPDATA "Programs\nodejs"),
  (Join-Path $env:ProgramFiles "nodejs")
)
if (-not $nodeDir) {
  foreach ($c in $candidates) { if (Test-Path (Join-Path $c "node.exe")) { $nodeDir = $c; break } }
}

if (-not $nodeDir) {
  Write-Host "[x] node.exe not found - Node.js is not installed on this machine."
  Write-Host "    Download Node.js LTS: https://nodejs.org/en/download"
  Write-Host "    (keep 'Add to PATH' checked during install), then run this script again."
  exit 1
}
Write-Host "[1/3] found node dir: $nodeDir"

# Guard: refuse to add a bare drive root (e.g. "D:\") to PATH
if ($nodeDir -match '^[A-Za-z]:\\?$') {
  Write-Host "[!] node.exe sits at a drive root ($nodeDir) - unusual install."
  Write-Host "    Please reinstall Node.js LTS to the default location: https://nodejs.org/en/download"
  exit 1
}

# 2) build the list of dirs to add
$npmDir = Join-Path $env:APPDATA "npm"
$toAdd = @($nodeDir)
if (Test-Path $npmDir) { $toAdd += $npmDir }

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $userPath) { $userPath = "" }
$parts = $userPath -split ';' | Where-Object { $_ -ne '' }

$added = @()
foreach ($d in $toAdd) {
  if ($parts -notcontains $d) { $parts += $d; $added += $d }
}

# 3) write back to user PATH and current session
if ($added.Count -eq 0) {
  Write-Host "[2/3] already present in user PATH - nothing to change."
} else {
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ';'), "User")
  Write-Host "[2/3] added to user PATH: $($added -join ', ')"
}
$env:Path = ($parts -join ';')
Write-Host "[3/3] applied to current session."
Write-Host ""
if (Get-Command node -ErrorAction SilentlyContinue) {
  $v = (& node -v) 2>&1
  Write-Host "[OK] node works now, version: $v"
} else {
  Write-Host "[!] Not effective in this window. Close ALL terminals, reopen, then run: node -v"
}
Write-Host ""
Write-Host "Next: double-click the one-click setup .cmd again."
