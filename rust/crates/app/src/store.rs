//! Local persistence: campaign progress, saved games and settings, in the
//! per-user data directory. Nothing leaves the machine.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    let base = if cfg!(windows) {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME").map(|h| PathBuf::from(h).join("Library/Application Support")).unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("XDG_DATA_HOME").map(PathBuf::from).or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".local/share"))).unwrap_or_else(|_| PathBuf::from("."))
    };
    let d = base.join("Cruciata");
    let _ = std::fs::create_dir_all(&d);
    d
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Progress {
    pub unlocked: usize,
    pub completed: Vec<usize>,
    pub music: f32,
    pub effects: f32,
    pub battle_sounds: bool,
    pub gore: bool,
    pub player_name: String,
    pub difficulty: String,
    pub orders_collapsed: bool,
}

impl Default for Progress {
    fn default() -> Self {
        Progress { unlocked: 0, completed: vec![], music: 0.20, effects: 0.65, battle_sounds: true, gore: true, player_name: String::new(), difficulty: "normal".into(), orders_collapsed: false }
    }
}

impl Progress {
    pub fn load() -> Progress {
        std::fs::read_to_string(data_dir().join("progress.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn save(&self) {
        let _ = std::fs::write(data_dir().join("progress.json"), serde_json::to_string_pretty(self).unwrap_or_default());
    }

    pub fn complete(&mut self, level: usize) {
        if !self.completed.contains(&level) {
            self.completed.push(level);
        }
        self.unlocked = self.unlocked.max((level + 1).min(5));
        self.save();
    }
}

pub fn save_path(slot: Option<usize>) -> PathBuf {
    match slot {
        None => data_dir().join("campaign.json"),
        Some(i) => data_dir().join(format!("quickmatch-{i}.json")),
    }
}

pub fn write_save(slot: Option<usize>, doc: &serde_json::Value) {
    let path = save_path(slot);
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_vec(doc).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

pub fn read_save(slot: Option<usize>) -> Option<serde_json::Value> {
    std::fs::read_to_string(save_path(slot)).ok().and_then(|s| serde_json::from_str(&s).ok())
}

pub fn delete_save(slot: Option<usize>) {
    let _ = std::fs::remove_file(save_path(slot));
}

/// One-line summary of a quickmatch save for the slot list.
pub fn describe_save(doc: &serde_json::Value) -> String {
    let w = doc["world"][0].as_f64().unwrap_or(0.0);
    let h = doc["world"][1].as_f64().unwrap_or(0.0);
    let diff = doc["state"]["difficulty"].as_str().unwrap_or("normal");
    let min = (doc["state"]["time"].as_f64().unwrap_or(0.0) / 60.0).floor();
    format!("{} \u{d7} {} \u{b7} {} \u{b7} {} minutes", w, h, diff, min)
}
