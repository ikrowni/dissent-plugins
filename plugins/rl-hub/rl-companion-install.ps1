# rl-companion-install.ps1 — One-time Windows installer for the Dissent RL Companion
# Installs to %APPDATA%\RLCompanion\, registers a Task Scheduler task that launches
# it silently on every login. No admin rights required.
#
# Called by the "Install on Windows" button in the RL Hub plugin, which pre-fills
# all environment variables and copies this command to your clipboard:
#
#   $env:RLC_SERVER='…'; $env:RLC_STATIC='…'; $env:RLC_TOKEN='…'; $env:RLC_SID='…'; $env:RLC_CID='…'; irm '…/rl-companion-install.ps1' | iex

param(
  [string]$Server    = $env:RLC_SERVER,   # API base URL (e.g. https://node.dissent.chat)
  [string]$Static    = $env:RLC_STATIC,   # Static files URL (e.g. https://app.dissent.chat)
  [string]$Token     = $env:RLC_TOKEN,
  [string]$ServerId  = $env:RLC_SID,
  [string]$ChannelId = $env:RLC_CID
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Validate ──────────────────────────────────────────────────────────────────

if (-not $Server -or -not $Token -or -not $ServerId -or -not $ChannelId) {
  Write-Error "Missing required parameters. Use the 'Install on Windows' button in the RL Hub plugin to generate this command."
  exit 1
}

# Fall back to $Server for $Static if not provided (single-domain setups)
if (-not $Static) { $Static = $Server }

# ── Check Node.js ─────────────────────────────────────────────────────────────

try {
  $nodeVersion = & node --version 2>&1
  Write-Host "Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "Node.js is not installed." -ForegroundColor Red
  Write-Host "Download it from https://nodejs.org (LTS version), then re-run this command." -ForegroundColor Yellow
  exit 1
}

# ── Install directory ─────────────────────────────────────────────────────────

$InstallDir = Join-Path $env:APPDATA 'RLCompanion'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Host "Install directory: $InstallDir"

# ── Download companion script ─────────────────────────────────────────────────

$ScriptPath = Join-Path $InstallDir 'rl-companion.js'
Write-Host "Downloading rl-companion.js…"
# Cache-bust with a timestamp so CDN/Cloudflare never serves a stale copy
$cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Invoke-WebRequest -Uri "$Static/plugins/rl-hub/rl-companion.js?v=$cacheBust" -OutFile $ScriptPath -UseBasicParsing

# Verify the downloaded file looks right (check version line)
$versionLine = Get-Content $ScriptPath | Select-String 'COMPANION_VERSION'
if ($versionLine) {
  Write-Host "Downloaded: $($versionLine.Line.Trim())" -ForegroundColor Green
} else {
  Write-Host "WARNING: Downloaded file may be stale — no version marker found." -ForegroundColor Yellow
  Write-Host "  Got: $(Get-Content $ScriptPath -TotalCount 3 | Out-String)" -ForegroundColor Yellow
}

# ── Write config.json ─────────────────────────────────────────────────────────

$ConfigPath = Join-Path $InstallDir 'config.json'
# Write without BOM — PowerShell 5's -Encoding UTF8 adds a BOM that breaks JSON.parse
$configJson = [ordered]@{
  server    = $Server
  token     = $Token
  serverId  = $ServerId
  channelId = $ChannelId
} | ConvertTo-Json
[System.IO.File]::WriteAllText($ConfigPath, $configJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "Config saved (UTF-8, no BOM)."

# ── Create silent VBScript launcher ──────────────────────────────────────────
# wscript runs the script with window style 0 (hidden) — no terminal window.

$LauncherPath = Join-Path $InstallDir 'launcher.vbs'
# Use %APPDATA% at runtime so no hardcoded paths are embedded.
# Written as ASCII — UTF-8 BOM causes VBScript error 800A0408 at line 1.
$vbs = @"
Set WshShell = CreateObject("WScript.Shell")
Dim appData : appData = WshShell.ExpandEnvironmentStrings("%APPDATA%")
WshShell.Run "node """ & appData & "\RLCompanion\rl-companion.js"" --config """ & appData & "\RLCompanion\config.json"" --daemon --quiet", 0, False
"@
[System.IO.File]::WriteAllText($LauncherPath, $vbs, [System.Text.Encoding]::ASCII)
Write-Host "Silent launcher created."

# ── Register Task Scheduler task (current user, no admin needed) ──────────────

$TaskName = 'DissentRLCompanion'
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

$Action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$LauncherPath`""
$Trigger  = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -MultipleInstances IgnoreNew -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
  -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Scheduled task registered: '$TaskName' — runs on login." -ForegroundColor Green

# ── Enable RL Stats API if we can find it ────────────────────────────────────

$RLPaths = @(
  "$env:ProgramFiles\Epic Games\rocketleague\TAGame\Config\DefaultStatsAPI.ini",
  "${env:ProgramFiles(x86)}\Steam\steamapps\common\rocketleague\TAGame\Config\DefaultStatsAPI.ini",
  "$env:LOCALAPPDATA\rocketleague\TAGame\Config\DefaultStatsAPI.ini"
)
$RLFound = $false
foreach ($path in $RLPaths) {
  if (Test-Path $path) {
    $content = Get-Content $path -Raw
    if ($content -match 'bEnabled\s*=\s*False') {
      $content = $content -replace 'bEnabled\s*=\s*False', 'bEnabled=True'
      Set-Content -Path $path -Value $content -Encoding UTF8 -NoNewline
      Write-Host "RL Stats API enabled at: $path" -ForegroundColor Green
    } else {
      Write-Host "RL Stats API already enabled at: $path" -ForegroundColor Green
    }
    $RLFound = $true
    # No break — configure all installs found (Steam + Epic can both be present)
  }
}
if (-not $RLFound) {
  Write-Host ""
  Write-Host "Could not find DefaultStatsAPI.ini automatically." -ForegroundColor Yellow
  Write-Host "Enable it manually: open TAGame\Config\DefaultStatsAPI.ini and set bEnabled=True" -ForegroundColor Yellow
}

# ── Start companion now ───────────────────────────────────────────────────────

Write-Host ""
Write-Host "Starting companion in the background…"
Start-Process 'wscript.exe' -ArgumentList "`"$LauncherPath`""

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Dissent RL Companion installed successfully!" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " - Running now in the background"
Write-Host " - Will auto-start on every Windows login"
Write-Host " - No terminal window will appear"
Write-Host ""
Write-Host "To uninstall: run rl-companion-uninstall.ps1 or delete the"
Write-Host "  'DissentRLCompanion' task from Task Scheduler."
