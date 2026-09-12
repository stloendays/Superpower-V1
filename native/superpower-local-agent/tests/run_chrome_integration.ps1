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
$extensionManifestPath = Resolve-ExistingFile (Join-Path $ExtensionDir 'manifest.json') 'Built extension manifest'
$originalExtensionManifest = Get-Content -LiteralPath $extensionManifestPath -Raw

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
$testScript = Join-Path $ExtensionDir 'native-integration.js'
$hostName = 'com.superpower.local_agent'
$manifestPath = Join-Path $env:LOCALAPPDATA "Superpower\NativeMessaging\$hostName.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir, $testRoot
New-Item -ItemType Directory -Force -Path $profileDir, $testRoot | Out-Null

$testHtml = @'
<!doctype html>
<meta charset="utf-8">
<title>Superpower Native Integration</title>
<p>Superpower Native Messaging integration probe.</p>
<script src="native-integration.js"></script>
'@

$testJavaScriptTemplate = @'
const root = document.documentElement;
root.dataset.superpowerBoot = 'script-started';

const testRoot = __TEST_ROOT_JSON__;
const proofFile = __PROOF_FILE_JSON__;
const expectedExtensionId = __EXTENSION_ID_JSON__;
const runtimeId = typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : undefined;

const finish = result => {
  root.dataset.superpowerResult = JSON.stringify(result);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const normalizePath = value => String(value || '').replaceAll('\\', '/').toLowerCase();
const send = payload => chrome.runtime.sendMessage({ type: 'local-agent:request', payload });

void (async () => {
  let alias = '';
  let remembered = false;

  try {
    assert(runtimeId, 'chrome.runtime.id is unavailable in the manifest-declared options page.');
    assert(runtimeId === expectedExtensionId, `Extension runtime ID mismatch: expected ${expectedExtensionId}, received ${runtimeId}`);
    assert(testRoot, 'Missing testRoot in generated integration script.');
    assert(proofFile, 'Missing proofFile in generated integration script.');

    const ping = await send({ id: 'ci-ping', action: 'ping', args: {} });
    assert(ping?.success === true, `Bridge ping failed: ${JSON.stringify(ping)}`);
    assert(ping?.payload?.ok === true, `Native host ping failed: ${JSON.stringify(ping)}`);
    assert(
      ping?.payload?.result?.service === 'superpower-local-agent',
      `Unexpected native host identity: ${JSON.stringify(ping)}`,
    );

    const blocked = await send({
      id: 'ci-unapproved-memory',
      action: 'memory.remember',
      args: { alias: 'ci-unapproved', path: testRoot },
    });
    assert(blocked?.success === false, 'Browser bridge accepted an unapproved local-memory scope change.');
    assert(/approval/i.test(blocked?.error || ''), `Approval rejection was not explicit: ${JSON.stringify(blocked)}`);

    alias = `ci-native-${Date.now()}`;
    const rememberedResponse = await send({
      id: 'ci-remember',
      action: 'memory.remember',
      args: { alias, path: testRoot, approved: true },
    });
    assert(
      rememberedResponse?.success === true && rememberedResponse?.payload?.ok === true,
      `Remember failed: ${JSON.stringify(rememberedResponse)}`,
    );
    remembered = true;

    const resolved = await send({
      id: 'ci-resolve',
      action: 'memory.resolve',
      args: { query: alias },
    });
    assert(resolved?.success === true && resolved?.payload?.ok === true, `Resolve failed: ${JSON.stringify(resolved)}`);
    assert(
      normalizePath(resolved?.payload?.result?.path) === normalizePath(testRoot),
      `Resolved path mismatch: ${JSON.stringify(resolved)}`,
    );

    const searched = await send({
      id: 'ci-search',
      action: 'file.search',
      args: { query: 'native-message-proof.txt', max_results: 10, max_scanned_entries: 1000 },
    });
    assert(searched?.success === true && searched?.payload?.ok === true, `File search failed: ${JSON.stringify(searched)}`);
    const matches = searched?.payload?.result?.matches || [];
    assert(
      matches.some(match => normalizePath(match.path) === normalizePath(proofFile)),
      `The remembered root did not yield the proof file: ${JSON.stringify(searched)}`,
    );

    const notified = await send({
      id: 'ci-gui-notify',
      action: 'gui.notify',
      args: {
        role: 'Assistant',
        source: 'Chrome CI',
        kind: 'success',
        text: 'Superpower real Chrome -> Native Messaging -> C++ -> Qt GUI integration passed.',
      },
    });
    assert(notified?.success === true && notified?.payload?.ok === true, `GUI notification failed: ${JSON.stringify(notified)}`);
    assert(
      notified?.payload?.result?.delivered === true,
      `Native host could not deliver the message to the running Qt GUI: ${JSON.stringify(notified)}`,
    );

    const forgotten = await send({ id: 'ci-forget', action: 'memory.forget', args: { alias } });
    assert(forgotten?.success === true && forgotten?.payload?.ok === true, `Cleanup forget failed: ${JSON.stringify(forgotten)}`);
    remembered = false;

    finish({
      ok: true,
      runtimeId,
      guiDelivered: true,
      summary: 'Chrome options page -> background bridge -> Native Messaging -> C++ host -> SQLite/file search -> Qt GUI IPC.',
    });
  } catch (error) {
    if (remembered && alias) {
      try {
        await send({ id: 'ci-cleanup-forget', action: 'memory.forget', args: { alias } });
      } catch {
        // Best-effort cleanup only.
      }
    }

    finish({
      ok: false,
      runtimeId,
      guiDelivered: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();
'@

Set-Content -LiteralPath $testPage -Encoding utf8 -Value $testHtml
Set-Content -LiteralPath $testScript -Encoding utf8 -Value "document.documentElement.dataset.superpowerBoot = 'awaiting-config';"

$extensionManifest = $originalExtensionManifest | ConvertFrom-Json
$extensionManifest | Add-Member -NotePropertyName 'options_page' -NotePropertyValue 'native-integration.html' -Force
$extensionManifestJson = $extensionManifest | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText(
    $extensionManifestPath,
    $extensionManifestJson,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Host 'Injected a CI-only manifest options_page for the Native Messaging integration probe.'

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
    $env:SUPERPOWER_PROFILE_DIR = $profileDir
    $discoverOutput = & node $NodeProbe discover
    if ($LASTEXITCODE -ne 0) { throw 'Extension ID discovery failed.' }
    $extensionId = ($discoverOutput | Select-Object -Last 1).Trim()
    if ($extensionId -notmatch '^[a-p]{32}$') { throw "Invalid discovered extension ID: $extensionId" }
    Write-Host "Chrome reported Superpower Extension ID: $extensionId"

    Stop-ProcessTree $discoveryChrome
    $discoveryChrome = $null
    Start-Sleep -Milliseconds 700

    $proofFile = Join-Path $testRoot 'native-message-proof.txt'
    [System.IO.File]::WriteAllText(
        $proofFile,
        "Superpower real Native Messaging integration proof.`n",
        [System.Text.UTF8Encoding]::new($false)
    )

    $testRootJson = ConvertTo-Json -Compress -InputObject $testRoot
    $proofFileJson = ConvertTo-Json -Compress -InputObject $proofFile
    $extensionIdJson = ConvertTo-Json -Compress -InputObject $extensionId
    $testJavaScript = $testJavaScriptTemplate.Replace('__TEST_ROOT_JSON__', $testRootJson).Replace('__PROOF_FILE_JSON__', $proofFileJson).Replace('__EXTENSION_ID_JSON__', $extensionIdJson)
    [System.IO.File]::WriteAllText(
        $testScript,
        $testJavaScript,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Host 'Generated the extension-owned integration script with the real Extension ID and test paths.'

    Write-Host 'Registering the real Native Messaging host manifest for that exact Extension ID...'
    & $Installer -ExtensionId $extensionId -HostExe $HostExe

    Write-Host 'Starting the real Qt desktop GUI...'
    $guiProcess = Start-Process -FilePath $GuiExe -PassThru
    Start-Sleep -Seconds 1
    if ($guiProcess.HasExited) { throw "Qt GUI exited before integration testing with code $($guiProcess.ExitCode)." }

    $extensionPage = "chrome-extension://$extensionId/native-integration.html"
    Write-Host "Starting the second real headless Chrome at about:blank; the verifier will navigate after Superpower background.js is ready: $extensionPage"
    $verificationArgs = $commonChromeArgs + @('--remote-debugging-port=9223', 'about:blank')
    $verificationChrome = Start-Process -FilePath $ChromeExe -ArgumentList $verificationArgs -PassThru

    $env:CHROME_DEBUG_PORT = '9223'
    $env:SUPERPOWER_EXTENSION_ID = $extensionId

    & node $NodeProbe verify
    if ($LASTEXITCODE -ne 0) { throw 'Real Chrome Native Messaging integration probe failed.' }
    if ($verificationChrome.HasExited) { throw "Chrome exited during the integration probe with code $($verificationChrome.ExitCode)." }
    if ($guiProcess.HasExited) { throw 'Qt GUI exited during the Native Messaging integration probe.' }

    Write-Host 'PASS: real Windows Chrome options page -> background bridge -> Native Messaging -> C++ host -> SQLite/file search -> Qt GUI IPC.' -ForegroundColor Green
} finally {
    Stop-ProcessTree $verificationChrome
    Stop-ProcessTree $discoveryChrome
    Stop-ProcessTree $guiProcess

    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $registryPath
    Remove-Item -Force -ErrorAction SilentlyContinue $manifestPath
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir, $testRoot
    Remove-Item -Force -ErrorAction SilentlyContinue $testPage, $testScript
    [System.IO.File]::WriteAllText(
        $extensionManifestPath,
        $originalExtensionManifest,
        [System.Text.UTF8Encoding]::new($false)
    )
}
