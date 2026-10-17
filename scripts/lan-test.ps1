# Opens two native Cruciata windows on this computer so you can try LAN play alone.
# Usage: powershell -File scripts\lan-test.ps1   (build first: cd rust; cargo build --release -p cruciata)
$exe = Join-Path $PSScriptRoot "..\rust\target\release\cruciata.exe"
if (-not (Test-Path $exe)) { Write-Error "Build first: cd rust; cargo build --release -p cruciata"; exit 1 }
$env:CRUCIATA_NAME = "Host"
Start-Process $exe
Start-Sleep -Seconds 2
$env:CRUCIATA_NAME = "Guest"
Start-Process $exe
Write-Host "Window 1 (Host): Multiplayer > Host a game, pick a map, wait."
Write-Host "Window 2 (Guest): Multiplayer > the Host game appears in the list > Join."
