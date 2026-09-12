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
    $backgroundPath = Join-Path $ExtensionDir 'background.js'
    $backgroundSize = (Get-Item -LiteralPath $backgroundPath).Length
    if ($backgroundSize -lt 1024) {
        throw "background.js is unexpectedly small ($backgroundSize bytes). Refusing to run a false-positive integration test."
    }
    Write-Host "Background service worker size: $backgroundSize bytes"

    $commonChromeArgs = @(
        '--headless=new',
        "--user-data-dir=$profileDir",
        "--disable-extensions-except=$ExtensionDir",
        "--load-extension=$ExtensionDir",
        '--remote-debugging-address=127.0.0.1',
        '--remote-allow-origins=*',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--disable-gpu'
    )

    Write-Host 'Starting the first real headless Chrome to read the actual unpacked Extension ID...'
    $discoveryArgs = $commonChromeArgs + @('--remote-debugging-port=9222', 'about:blank')
    $discoveryChrome = Start-Process -FilePath $ChromeExe -ArgumentList $discoveryArgs -PassThru

    $env:CHROME_DEBUG_PORT = '9222'
    $env:SUPERPOWER_EXTENSION_PATH = $ExtensionDir
    $discoverOutput = & node $NodeProbe discover
    if ($LASTEXITCODE -ne 0) { throw 'Extension ID discovery failed.' }
    $extensionId = ($discoverOutput | Select-Object -Last 1).Trim()
    if ($extensionId -notmatch '^[a-p]{32}$') { throw "Invalid discovered extension ID: $extensionId" }
    Write-Host "Chrome reported Superpower Extension ID: $extensionId"

    Stop-ProcessTree $discoveryChrome
    $discoveryChrome = $null
    Start-Sleep -Milliseconds 700

    Write-Host 'Registering the real Native Messaging host manifest for that exact Extension ID...'
    & $Installer -ExtensionId $extensionId -HostExe $HostExe

    Write-Host 'Starting the real Qt desktop GUI...'
    $guiProcess = Start-Process -FilePath $GuiExe -PassThru
    Start-Sleep -Seconds 1
    if ($guiProcess.HasExited) { throw "Qt GUI exited before integration testing with code $($guiProcess.ExitCode)." }

    $extensionPage = "chrome-extension://$extensionId/native-integration.html"
    Write-Host "Starting the second real headless Chrome on the extension sender page: $extensionPage"
    $verificationArgs = $commonChromeArgs + @('--remote-debugging-port=9223', $extensionPage)
    $verificationChrome = Start-Process -FilePath $ChromeExe -ArgumentList $verificationArgs -PassThru

    $env:CHROME_DEBUG_PORT = '9223'
    $env:SUPERPOWER_EXTENSION_ID = $extensionId
    $env:SUPERPOWER_TEST_ROOT = $testRoot

    & node $NodeProbe verify
    if ($LASTEXITCODE -ne 0) { throw 'Real Chrome Native Messaging integration probe failed.' }
    if ($verificationChrome.HasExited) { throw "Chrome exited during the integration probe with code $($verificationChrome.ExitCode)." }
    if ($guiProcess.HasExited) { throw 'Qt GUI exited during the Native Messaging integration probe.' }

    Write-Host 'PASS: real Windows Chrome extension page → background bridge → Native Messaging → C++ host → SQLite/file search → Qt GUI IPC.' -ForegroundColor Green
} finally {
    Stop-ProcessTree $verificationChrome
    Stop-ProcessTree $discoveryChrome
    Stop-ProcessTree $guiProcess

    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $registryPath
    Remove-Item -Force -ErrorAction SilentlyContinue $manifestPath
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir, $testRoot
    Remove-Item -Force -ErrorAction SilentlyContinue $testPage
}
