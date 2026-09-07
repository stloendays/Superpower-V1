#ifndef MyAppVersion
  #define MyAppVersion "1.1.0"
#endif

#define MyAppName "Superpower"
#define MyAppPublisher "stloendays"
#define MyAppURL "https://github.com/stloendays/Superpower-V1"

[Setup]
AppId={{6E67C1CF-0D98-46C2-9D13-53F9117BC8E1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\Superpower
DefaultGroupName=Superpower
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\release
OutputBaseFilename=Superpower-{#MyAppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Superpower {#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Superpower Windows installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\DIY-Install-Superpower.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\Install-Superpower.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\RELEASE_INSTALL.md"; DestDir: "{app}"; DestName: "README_INSTALL.md"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Open Superpower extension folder"; Filename: "{sys}\explorer.exe"; Parameters: "\"{app}\dist\""
Name: "{group}\Superpower installation guide"; Filename: "{app}\README_INSTALL.md"
Name: "{group}\Uninstall Superpower"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File \"{app}\DIY-Install-Superpower.ps1\""; Description: "Open Chrome extension setup and copy the extension path"; Flags: postinstall skipifsilent waituntilterminated

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
