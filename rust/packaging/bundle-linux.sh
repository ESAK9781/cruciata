#!/usr/bin/env bash
# Usage: bundle-linux.sh <version>  -> Cruciata-linux-x64.tar.gz and cruciata_amd64.deb
set -euo pipefail
version="$1"
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
"$here/stage.sh" stage/cruciata "$root/rust/target/release/cruciata"
cat > stage/cruciata/install.sh <<'INS'
#!/usr/bin/env bash
# Installs Cruciata for the current user (no root needed).
set -e
dest="${HOME}/.local/share/cruciata"
mkdir -p "$dest" "${HOME}/.local/bin" "${HOME}/.local/share/applications"
cp -r "$(dirname "$0")/cruciata" "$(dirname "$0")/assets" "$dest/"
ln -sf "$dest/cruciata" "${HOME}/.local/bin/cruciata"
cat > "${HOME}/.local/share/applications/cruciata.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Cruciata
Comment=A pilgrim's empire - real-time strategy
Exec=$dest/cruciata
Categories=Game;StrategyGame;
Terminal=false
DESK
echo "Installed. Start it from your application menu or run: cruciata"
INS
chmod +x stage/cruciata/install.sh stage/cruciata/cruciata
tar -C stage -czf Cruciata-linux-x64.tar.gz cruciata
# .deb
d="debroot"
rm -rf "$d"; mkdir -p "$d/DEBIAN" "$d/opt/cruciata" "$d/usr/bin" "$d/usr/share/applications"
cp -r stage/cruciata/cruciata stage/cruciata/assets "$d/opt/cruciata/"
ln -s /opt/cruciata/cruciata "$d/usr/bin/cruciata"
cat > "$d/usr/share/applications/cruciata.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Cruciata
Comment=A pilgrim's empire - real-time strategy
Exec=/opt/cruciata/cruciata
Categories=Game;StrategyGame;
Terminal=false
DESK
cat > "$d/DEBIAN/control" <<CTL
Package: cruciata
Version: $version
Section: games
Priority: optional
Architecture: amd64
Maintainer: Cruciata <noreply@users.noreply.github.com>
Depends: libgl1, libxkbcommon0
Description: Cruciata - a pilgrim's empire
 Native desktop real-time strategy game with LAN multiplayer.
CTL
dpkg-deb --build --root-owner-group "$d" cruciata_amd64.deb
