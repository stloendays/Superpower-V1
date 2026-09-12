param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionDir,

    [Parameter(Mandatory = $true)]
    [string]$HostExe,

    [Parameter(Mandatory = $true)]
    [string]$GuiExe,

    [Parameter(Mandatory = $false)]
    [string]$ChromeExe = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "$Label not found: $resolved"
    }
    return $resolved
}

function Resolve-ExistingDirectory([string]$Path, [string]$Label) {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "$Label not found: $resolved"
    }
    return $resolved
}

function Stop-ProcessTree($Process) {
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) {
            & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
        }
    } catch {
        Write-Host "Process tree $($Process.Id) was already stopped."
    }
}

$ExtensionDir = Resolve-ExistingDirectory $ExtensionDir 'Built extension directory'
$HostExe = Resolve-ExistingFile $HostExe 'Native host executable'
$GuiExe = Resolve-ExistingFile $GuiExe 'Desktop GUI executable'
$NodeProbe = Resolve-ExistingFile (Join-Path $PSScriptRoot 'chrome_native_integration.mjs') 'Node integration probe'
$Installer = Resolve-ExistingFile (Join-Path $PSScriptRoot '..\install\windows\install-native-host.ps1') 'Native host installer'

if ([string]::IsNullOrWhiteSpace($ChromeExe)) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    )
    $ChromeExe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}
$ChromeExe = Resolve-ExistingFile $ChromeExe 'Google Chrome executable'

$runnerTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$profileDir = Join-Path $runnerTemp "superpower-chrome-native-$PID"
$testRoot = Join-Path $runnerTemp "superpower-local-agent-e2e-$PID"
$testPage = Join-Path $ExtensionDir 'native-integration.html'
$hostName = 'com.superpower.local_agent'
$manifestPath = Join-Path $env:LOCALAPPDATA "Superpower\NativeMessaging\$hostName.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir, $testRoot
New-Item -ItemType Directory -Force -Path $profileDir, $testRoot | Out-Null
Set-Content -LiteralPath $testPage -Encoding utf8 -Value '<!doctype html><meta charset="utf-8"><title>Superpower Native Integration</title><p>Superpower Native Messaging integration probe.</p>'

$discoveryChrome = $null
$verificationChrome = $null
$guiProcess = $null

try {
    $commonArgs = @(
        "--user-data-dir=$profileDir",
        "--disable-extensions-except=$ExtensionDir",
        "--load-extension=$ExtensionDir",
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--disable-gpu'
    )

    Write-Host 'Starting Chrome to discover the real unpacked extension ID...'
    $discoveryArgs = $commonArgs + @('--remote-debugging-port=9222', 'about:blank')
    $discoveryChrome = Start-Process -FilePath $ChromeExe -ArgumentList $discoveryArgs -PassThru

    $env:CHROME_DEBUG_PORT = '9222'
    $env:SUPERPOWER_PROFILE_DIR = $profileDir
    $env:SUPERPOWER_EXTENSION_PATH = $ExtensionDir
    Start-Sleep -Milliseconds 800

    $discoveryOutput = & node $NodeProbe discover
    if ($LASTEXITCODE -ne 0) { throw 'Extension ID discovery probe failed.' }
    $extensionId = ($discoveryOutput | Select-Object -Last 1).Trim()
    if ($extensionId -notmatch '^[a-p]{32}$') { throw "Invalid discovered extension ID: $extensionId" }
    Write-Host "Discovered Superpower extension ID: $extensionId"

    Stop-ProcessTree $discoveryChrome
    $discoveryChrome = $null
    Start-Sleep -Milliseconds 500

    Write-Host 'Registering the real Native Messaging host manifest...'
    & $Installer -ExtensionId $extensionId -HostExe $HostExe

    Write-Host 'Starting the real Qt desktop GUI...'
    $guiProcess = Start-Process -FilePath $GuiExe -PassThru
    Start-Sleep -Seconds 1
    if ($guiProcess.HasExited) { throw "Qt GUI exited before integration testing with code $($guiProcess.ExitCode)." }

    Write-Host 'Restarting Chrome with the registered Native Messaging host...'
    $extensionPage = "chrome-extension://$extensionId/native-integration.html"
    $verificationArgs = $commonArgs + @('--remote-debugging-port=9223', $extensionPage)
    $verificationChrome = Start-Process -FilePath $ChromeExe -ArgumentList $verificationArgs -PassThru

    $env:CHROME_DEBUG_PORT = '9223'
    $env:SUPERPOWER_EXTENSION_ID = $extensionId
    $env:SUPERPOWER_TEST_ROOT = $testRoot
    Start-Sleep -Milliseconds 800

    & node $NodeProbe verify
    if ($LASTEXITCODE -ne 0) { throw 'Real Chrome Native Messaging integration probe failed.' }
    if ($guiProcess.HasExited) { throw 'Qt GUI exited during the Native Messaging integration probe.' }

    Write-Host 'PASS: real Windows Chrome → Superpower extension → Native Messaging → C++ host → Qt GUI integration.' -ForegroundColor Green
} finally {
    Stop-ProcessTree $verificationChrome
    Stop-ProcessTree $discoveryChrome
    Stop-ProcessTree $guiProcess

    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $registryPath
    Remove-Item -Force -ErrorAction SilentlyContinue $manifestPath
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir, $testRoot
    Remove-Item -Force -ErrorAction SilentlyContinue $testPage
}
