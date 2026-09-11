param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,

    [Parameter(Mandatory = $false)]
    [string]$HostExe = '',

    [Parameter(Mandatory = $false)]
    [switch]$AlsoEdge
)

$ErrorActionPreference = 'Stop'

$HostName = 'com.superpower.local_agent'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Superpower\NativeMessaging'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if ([string]::IsNullOrWhiteSpace($HostExe)) {
    $candidate = Join-Path $PSScriptRoot '..\..\..\build\Release\superpower-local-agent.exe'
    $HostExe = [System.IO.Path]::GetFullPath($candidate)
} else {
    $HostExe = [System.IO.Path]::GetFullPath($HostExe)
}

if (-not (Test-Path -LiteralPath $HostExe -PathType Leaf)) {
    throw "Native host executable not found: $HostExe"
}

$ManifestPath = Join-Path $InstallDir "$HostName.json"
$manifest = [ordered]@{
    name = $HostName
    description = 'Superpower C++ local agent for browser-native file memory and approved local actions.'
    path = $HostExe
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

$ChromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item -Force -Path $ChromeKey | Out-Null
Set-Item -Path $ChromeKey -Value $ManifestPath

if ($AlsoEdge) {
    $EdgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
    New-Item -Force -Path $EdgeKey | Out-Null
    Set-Item -Path $EdgeKey -Value $ManifestPath
}

Write-Host ''
Write-Host 'Superpower Local Agent native host installed.' -ForegroundColor Green
Write-Host "Host:      $HostExe"
Write-Host "Manifest:  $ManifestPath"
Write-Host "Extension: $ExtensionId"
Write-Host 'Restart the browser before testing Native Messaging.'
