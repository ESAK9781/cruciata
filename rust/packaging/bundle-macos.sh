#!/usr/bin/env bash
# Usage: bundle-macos.sh <arch-label> <version>  -> Cruciata-macOS-<arch>.dmg
set -euo pipefail
arch="$1"; version="$2"
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
app="dist/Cruciata.app"
rm -rf dist; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$root/rust/target/release/cruciata" "$app/Contents/MacOS/cruciata"
mkdir -p "$app/Contents/Resources/assets"
cp -r "$root/assets/atlas" "$app/Contents/Resources/assets/atlas"
cp -r "$root/assets/audio" "$app/Contents/Resources/assets/audio"
cp -r "$root/assets/music" "$app/Contents/Resources/assets/music"
rm -f "$app/Contents/Resources/assets/atlas/manifest.js"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Cruciata</string>
<key>CFBundleDisplayName</key><string>Cruciata</string>
<key>CFBundleIdentifier</key><string>io.github.esak9781.cruciata</string>
<key>CFBundleVersion</key><string>$version</string>
<key>CFBundleShortVersionString</key><string>$version</string>
<key>CFBundleExecutable</key><string>cruciata</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>12.0</string>
</dict></plist>
PLIST
chmod +x "$app/Contents/MacOS/cruciata"
# Ad-hoc signature so Apple Silicon will run the unsigned bundle.
codesign --force --deep --sign - "$app" || true
hdiutil create -volname "Cruciata" -srcfolder dist -ov -format UDZO "Cruciata-macOS-$arch.dmg"
