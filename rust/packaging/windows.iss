; Inno Setup script. Build with: iscc /DVersion=1.2.3 /DStage=stage\cruciata windows.iss
#ifndef Version
#define Version "0.1.0"
#endif
#ifndef Stage
#define Stage "stage\cruciata"
#endif
[Setup]
AppId={{6D3A9C54-8F1B-4E57-9B60-0A1C2D3E4F50}
AppName=Cruciata
AppVersion={#Version}
AppPublisher=Cruciata
DefaultDirName={autopf}\Cruciata
DefaultGroupName=Cruciata
OutputDir=.
OutputBaseFilename=Cruciata-Setup-windows-x64
Compression=lzma2/fast
SolidCompression=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
DisableProgramGroupPage=yes
SetupIconFile=icons\cruciata.ico
UninstallDisplayIcon={app}\cruciata.exe
UninstallDisplayName=Cruciata
[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
[Icons]
Name: "{group}\Cruciata"; Filename: "{app}\cruciata.exe"
Name: "{autodesktop}\Cruciata"; Filename: "{app}\cruciata.exe"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"
[Run]
; Lets LAN games be found and joined without any manual firewall step.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Cruciata"" dir=in action=allow program=""{app}\cruciata.exe"" enable=yes profile=private,domain"; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Cruciata (public)"" dir=in action=allow program=""{app}\cruciata.exe"" enable=yes profile=public"; Flags: runhidden
Filename: "{app}\cruciata.exe"; Description: "Start Cruciata"; Flags: nowait postinstall skipifsilent
[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Cruciata"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Cruciata (public)"""; Flags: runhidden
