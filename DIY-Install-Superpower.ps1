[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$Ref = "main",
    [switch]$NoOpen,
    [switch]$ForceBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Repository = "stloendays/Superpower-V1"
$RequiredNodeVersion = [version]"22.12.0"
$RequiredPnpmVersion = "9.15.1"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Checked {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $InstallDir = Join-Path $HOME ".superpower"
    }
    else {
        $InstallDir = Join-Path $localAppData "Superpower"
    }
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$HasSource = Test-Path (Join-Path $ScriptRoot "package.json")
$HasPrebuiltExtension = Test-Path (Join-Path $ScriptRoot "dist\manifest.json")

# Bootstrap mode: this script was downloaded by itself. Fetch the repository,
# place it under the user's local application data directory, then continue
# from the copy that lives inside the downloaded package.
if (-not $HasSource -and -not $HasPrebuiltExtension) {
    Write-Step "Downloading Superpower DIY package"

    $TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("superpower-diy-" + [guid]::NewGuid().ToString("N"))
    $ArchivePath = Join-Path $TempRoot "superpower.zip"
    $ExtractRoot = Join-Path $TempRoot "extract"
    $AppDir = Join-Path $InstallDir "app"
    $BackupDir = Join-Path $InstallDir "app.previous"

    New-Item -ItemType Directory -Force -Path $TempRoot, $ExtractRoot, $InstallDir | Out-Null

    try {
        $ArchiveUrl = "https://github.com/$Repository/archive/refs/heads/$Ref.zip"
        Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath -UseBasicParsing
        Expand-Archive -Path $ArchivePath -DestinationPath $ExtractRoot -Force

        $ExtractedDir = Get-ChildItem -Path $ExtractRoot -Directory | Select-Object -First 1
        if (-not $ExtractedDir) {
            throw "Downloaded archive did not contain a project directory."
        }

        if (Test-Path $BackupDir) {
            Remove-Item -Path $BackupDir -Recurse -Force
        }
        if (Test-Path $AppDir) {
            Move-Item -Path $AppDir -Destination $BackupDir
        }

        Move-Item -Path $ExtractedDir.FullName -Destination $AppDir
        $InnerInstaller = Join-Path $AppDir "DIY-Install-Superpower.ps1"
        if (-not (Test-Path $InnerInstaller)) {
            throw "DIY installer was not found in the downloaded package."
        }

        $PowerShellArgs = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $InnerInstaller,
            "-InstallDir", $InstallDir,
            "-Ref", $Ref
        )
        if ($NoOpen) {
            $PowerShellArgs += "-NoOpen"
        }
        if ($ForceBuild) {
            $PowerShellArgs += "-ForceBuild"
        }

        & powershell.exe @PowerShellArgs
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -ne 0) {
            throw "The downloaded DIY installer failed with exit code $ExitCode."
        }

        if (Test-Path $BackupDir) {
            Remove-Item -Path $BackupDir -Recurse -Force
        }
    }
    finally {
        if (Test-Path $TempRoot) {
            Remove-Item -Path $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    exit 0
}

Set-Location $ScriptRoot

# A release/Actions package can already contain dist/. In that case, no Node
# toolchain is required. Source downloads are built automatically.
if ($ForceBuild -or -not $HasPrebuiltExtension) {
    if (-not $HasSource) {
        throw "No prebuilt extension or source package was found."
    }

    Write-Step "Checking Node.js"
    if (-not (Test-Command "node")) {
        throw "Node.js 22.12+ is required for a source build. Install Node.js and run this installer again."
    }

    $NodeVersionText = (& node -p "process.versions.node").Trim()
    $NodeVersion = [version]$NodeVersionText
    if ($NodeVersion -lt $RequiredNodeVersion) {
        throw "Node.js $RequiredNodeVersion or newer is required. Detected $NodeVersionText."
    }
    Write-Host "Node.js $NodeVersionText"

    Write-Step "Checking pnpm"
    if (-not (Test-Command "pnpm")) {
        if (Test-Command "corepack") {
            Write-Host "Activating pnpm $RequiredPnpmVersion with Corepack..."
            Invoke-Checked "corepack" @("prepare", "pnpm@$RequiredPnpmVersion", "--activate")
        }
    }

    if (-not (Test-Command "pnpm")) {
        if (-not (Test-Command "npm")) {
            throw "pnpm is not available, and npm could not be found to install it."
        }
        Write-Host "Installing pnpm $RequiredPnpmVersion..."
        Invoke-Checked "npm" @("install", "--global", "pnpm@$RequiredPnpmVersion")
    }

    $PnpmVersion = (& pnpm --version).Trim()
    Write-Host "pnpm $PnpmVersion"

    Write-Step "Installing dependencies"
    Invoke-Checked "pnpm" @("install", "--frozen-lockfile")

    Write-Step "Building Superpower"
    Invoke-Checked "pnpm" @("build")
}

$DistDir = Join-Path $ScriptRoot "dist"
$ManifestPath = Join-Path $DistDir "manifest.json"
if (-not (Test-Path $ManifestPath)) {
    throw "Build completed, but dist\manifest.json was not found."
}

Write-Step "Superpower is ready"
Write-Host "Extension directory: $DistDir" -ForegroundColor Green
Write-Host ""
Write-Host "Chrome installation:" 
Write-Host "  1. Open chrome://extensions/"
Write-Host "  2. Enable Developer mode"
Write-Host "  3. Click Load unpacked and choose the dist folder above"
Write-Host ""
Write-Host "The default Superpower SSE endpoint is http://localhost:3006/sse"

if (Test-Command "Set-Clipboard") {
    Set-Clipboard -Value $DistDir
    Write-Host "The dist path has been copied to your clipboard."
}

if (-not $NoOpen) {
    Write-Step "Opening the extension folder and browser extension manager"

    if (Test-Path $DistDir) {
        Start-Process explorer.exe -ArgumentList ('"{0}"' -f $DistDir) | Out-Null
    }

    $ChromeCandidates = @(
        (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    ) | Where-Object { $_ -and (Test-Path $_) }

    $Chrome = $ChromeCandidates | Select-Object -First 1
    if ($Chrome) {
        Start-Process -FilePath $Chrome -ArgumentList "chrome://extensions/" | Out-Null
    }
    elseif (Test-Command "msedge.exe") {
        Start-Process -FilePath "msedge.exe" -ArgumentList "edge://extensions/" | Out-Null
    }
    else {
        Write-Host "Chrome was not detected automatically. Open chrome://extensions/ manually."
    }
}

Write-Host ""
Write-Host "Done. Superpower is built and ready to load." -ForegroundColor Green
