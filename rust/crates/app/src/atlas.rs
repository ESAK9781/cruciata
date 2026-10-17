//! The baked sprite atlas: frame lookup by key plus on-demand page loading.
//! PNG pages decode on worker threads and upload as textures when ready; the
//! least recently used pages are dropped past a budget.

use eframe::egui::{self, ColorImage, TextureHandle, TextureId, TextureOptions};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

pub const PAGE: f32 = 1024.0;
const MAX_PAGES: usize = 56;

#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub page: u16,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub dx: f32,
    pub dy: f32,
    /// Pixels per world unit the frame was baked at.
    pub res: f32,
}

struct Resident {
    handle: TextureHandle,
    used: u64,
}

pub struct Atlas {
    dir: PathBuf,
    pub scale: f32,
    pages: Vec<String>,
    frames: HashMap<String, Frame>,
    /// Keys sharing everything before their last `:` (the frames of one animation).
    families: HashMap<String, Vec<String>>,
    resident: HashMap<u16, Resident>,
    requested: HashSet<u16>,
    tx: Sender<u16>,
    rx: Receiver<(u16, ColorImage)>,
    tick: u64,
    pub misses: u64,
}

impl Atlas {
    pub fn load(dir: PathBuf) -> Result<Atlas, String> {
        let text = std::fs::read_to_string(dir.join("atlas").join("manifest.json")).map_err(|e| format!("atlas manifest: {e}"))?;
        let doc: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let scale = doc["scale"].as_f64().unwrap_or(3.0) as f32;
        let pages: Vec<String> = doc["pages"].as_array().ok_or("pages")?.iter().filter_map(|p| p.as_str().map(String::from)).collect();
        let mut frames = HashMap::with_capacity(doc["frames"].as_object().map(|m| m.len()).unwrap_or(0));
        for (k, v) in doc["frames"].as_object().ok_or("frames")? {
            let a = v.as_array().ok_or("frame")?;
            let n = |i: usize| a.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            frames.insert(k.clone(), Frame { page: n(0) as u16, x: n(1), y: n(2), w: n(3), h: n(4), dx: n(5), dy: n(6), res: scale });
        }
        // The Colossus has its own small atlas (the web game draws it at runtime).
        let mut pages = pages;
        if let Ok(text) = std::fs::read_to_string(dir.join("atlas").join("colossus.json")) {
            if let Ok(extra) = serde_json::from_str::<serde_json::Value>(&text) {
                let offset = pages.len() as f32;
                let res = extra["scale"].as_f64().unwrap_or(1.5) as f32;
                pages.extend(extra["pages"].as_array().into_iter().flatten().filter_map(|p| p.as_str().map(String::from)));
                for (k, v) in extra["frames"].as_object().into_iter().flatten() {
                    let Some(a) = v.as_array() else { continue };
                    let n = |i: usize| a.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                    frames.insert(k.clone(), Frame { page: (n(0) + offset) as u16, x: n(1), y: n(2), w: n(3), h: n(4), dx: n(5), dy: n(6), res });
                }
            }
        }
        let mut families: HashMap<String, Vec<String>> = HashMap::new();
        for k in frames.keys() {
            if let Some(i) = k.rfind(':') {
                families.entry(k[..i].to_string()).or_default().push(k.clone());
            }
        }
        let (tx, req_rx) = channel::<u16>();
        let (done_tx, rx) = channel();
        let req_rx = Arc::new(Mutex::new(req_rx));
        for _ in 0..2 {
            let req_rx = req_rx.clone();
            let done_tx = done_tx.clone();
            let names = pages.clone();
            let base = dir.join("atlas");
            std::thread::spawn(move || loop {
                let next = { req_rx.lock().unwrap().recv() };
                let Ok(page) = next else { return };
                let path = base.join(&names[page as usize]);
                if let Ok(img) = image::open(&path) {
                    let rgba = img.to_rgba8();
                    let size = [rgba.width() as usize, rgba.height() as usize];
                    let _ = done_tx.send((page, crate::paint::image_from_straight(size, rgba.as_raw())));
                }
            });
        }
        Ok(Atlas { dir, scale, pages, frames, families, resident: HashMap::new(), requested: HashSet::new(), tx, rx, tick: 0, misses: 0 })
    }

    pub fn dir(&self) -> &PathBuf {
        &self.dir
    }

    /// Alpha plane (1024 x 1024) of a page, decoded from disk (used when a building shatters).
    pub fn page_alpha(&self, page: u16) -> Option<Vec<u8>> {
        let name = self.pages.get(page as usize)?;
        let img = image::open(self.dir.join("atlas").join(name)).ok()?.to_rgba8();
        Some(img.pixels().map(|p| p[3]).collect())
    }

    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    /// Call once per frame: uploads decoded pages and evicts old ones.
    pub fn begin_frame(&mut self, ctx: &egui::Context) {
        self.tick += 1;
        let mut uploads = 0;
        while let Ok((page, img)) = self.rx.try_recv() {
            let handle = ctx.load_texture(format!("atlas-{page}"), img, TextureOptions::LINEAR);
            self.resident.insert(page, Resident { handle, used: self.tick });
            self.requested.remove(&page);
            uploads += 1;
            if uploads >= 3 {
                break;
            }
        }
        if self.resident.len() > MAX_PAGES {
            let mut order: Vec<(u64, u16)> = self.resident.iter().map(|(p, r)| (r.used, *p)).collect();
            order.sort();
            for (used, p) in order.into_iter().take(self.resident.len() - MAX_PAGES) {
                if used + 2 < self.tick {
                    self.resident.remove(&p);
                }
            }
        }
    }

    pub fn has(&self, key: &str) -> bool {
        self.frames.contains_key(key)
    }

    pub fn frame(&self, key: &str) -> Option<Frame> {
        self.frames.get(key).copied()
    }

    /// Frame plus the texture of its page (when decoded). Requests the page otherwise.
    /// While a page is still loading (or was evicted) the nearest resident frame of
    /// the same animation is used instead, so moving machines never blink out.
    pub fn lookup(&mut self, key: &str) -> Option<(Frame, Option<TextureId>)> {
        let f = *self.frames.get(key)?;
        if let Some(r) = self.resident.get_mut(&f.page) {
            r.used = self.tick;
            return Some((f, Some(r.handle.id())));
        }
        if self.requested.insert(f.page) {
            let _ = self.tx.send(f.page);
        }
        self.misses += 1;
        let i = key.rfind(':')?;
        let want = key[i + 1..].rsplit('-').next().and_then(|n| n.parse::<i64>().ok());
        let mut best: Option<(i64, Frame, TextureId)> = None;
        let mut prefetch = 0;
        if let Some(sibs) = self.families.get(&key[..i]) {
            for s in sibs {
                let Some(sf) = self.frames.get(s).copied() else { continue };
                if let Some(r) = self.resident.get(&sf.page) {
                    let n = s[s.rfind(':').map(|j| j + 1).unwrap_or(0)..].rsplit('-').next().and_then(|n| n.parse::<i64>().ok());
                    let dist = match (want, n) {
                        (Some(w), Some(n)) => (w - n).abs(),
                        _ => 1000,
                    };
                    if best.as_ref().map(|b| dist < b.0).unwrap_or(true) {
                        best = Some((dist, sf, r.handle.id()));
                    }
                } else if prefetch < 6 && self.requested.insert(sf.page) {
                    let _ = self.tx.send(sf.page);
                    prefetch += 1;
                }
            }
        }
        match best {
            Some((_, sf, id)) => Some((sf, Some(id))),
            None => Some((f, None)),
        }
    }

    pub fn resident_pages(&self) -> usize {
        self.resident.len()
    }

    pub fn pending_pages(&self) -> usize {
        self.requested.len()
    }
}
