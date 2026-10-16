//! Locating the shipped `assets/` directory (next to the executable once
//! installed, in the repository while developing).

use std::path::PathBuf;

pub fn assets_dir() -> PathBuf {
    if let Ok(p) = std::env::var("CRUCIATA_ASSETS") {
        return PathBuf::from(p);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("assets"));
            // macOS app bundle: Contents/MacOS/cruciata -> Contents/Resources/assets
            if let Some(up) = dir.parent() {
                candidates.push(up.join("Resources").join("assets"));
                candidates.push(up.join("share").join("cruciata").join("assets"));
            }
        }
    }
    candidates.push(PathBuf::from("assets"));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../assets"));
    for c in &candidates {
        if c.join("atlas").join("manifest.json").exists() {
            return c.clone();
        }
    }
    candidates.pop().unwrap()
}
