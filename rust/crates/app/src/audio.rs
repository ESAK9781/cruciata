//! Sound effects and the shuffled music playlist (rodio). The device is
//! optional: with no audio output the game stays silent.

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

const TRACKS: [(&str, &str); 4] = [
    ("midday-at-the-oasis", "Midday at the Oasis"),
    ("lanterns-by-the-slope", "Lanterns by the Slope"),
    ("shadows-in-the-stone-courtyard", "Shadows in the Stone Courtyard"),
    ("iter-nostrum", "Iter Nostrum"),
];

fn bank(kind: &str) -> &'static [&'static str] {
    match kind {
        "select" => &["cloth1"],
        "order" => &["drawKnife1"],
        "recruit" => &["confirmation_001"],
        "hit" => &["impactMetal_medium_000", "impactMetal_medium_001", "impactMetal_medium_002", "impactMetal_medium_003", "impactPlate_light_000", "knifeSlice"],
        "bell" => &["impactBell_heavy_000"],
        "horn" => &["confirmation_001"],
        "impact" => &["impactWood_heavy_000", "impactSoft_heavy_000", "impactMetal_heavy_000", "impactPunch_medium_000"],
        "bless" => &["impactBell_heavy_000"],
        "wood" => &["chop"],
        "gold" => &["impactMining_000"],
        "stone" => &["impactMining_001"],
        "food" => &["cloth1"],
        "build" => &["impactWood_medium_000", "impactWood_heavy_001", "impactWood_heavy_002"],
        "deliver" => &["handleCoins"],
        "siege" => &["creak1"],
        "explosion" => &["trebuchet-landing.wav"],
        "great-impact" => &["great-landing.wav"],
        "great-launch" => &["impactMetal_heavy_001", "impactWood_heavy_002"],
        "collapse" => &["impactGlass_heavy_000", "impactWood_heavy_001"],
        "arrow" => &["knifeSlice2"],
        _ => &["click_001"],
    }
}

pub struct Audio {
    _stream: OutputStream,
    handle: OutputStreamHandle,
    dir: PathBuf,
    cache: HashMap<String, Arc<Vec<u8>>>,
    counts: HashMap<String, usize>,
    last: HashMap<String, Instant>,
    active: Vec<(Sink, f32)>,
    music: Option<Sink>,
    music_started: Instant,
    bag: Vec<usize>,
    previous: Option<usize>,
    pub current: Option<&'static str>,
    pub effects: f32,
    pub music_volume: f32,
    pub enabled: bool,
    rng: u64,
}

impl Audio {
    pub fn new(assets: PathBuf) -> Option<Audio> {
        let (stream, handle) = match OutputStream::try_default() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio: no output device ({e})");
                return None;
            }
        };
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1) | 1;
        Some(Audio {
            _stream: stream,
            handle,
            dir: assets,
            cache: HashMap::new(),
            counts: HashMap::new(),
            last: HashMap::new(),
            active: Vec::new(),
            music: None,
            music_started: Instant::now(),
            bag: Vec::new(),
            previous: None,
            current: None,
            effects: 0.65,
            music_volume: 0.2,
            enabled: true,
            rng: seed,
        })
    }

    fn rand(&mut self) -> u64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        self.rng
    }

    fn bytes(&mut self, name: &str) -> Option<Arc<Vec<u8>>> {
        if let Some(b) = self.cache.get(name) {
            return Some(b.clone());
        }
        let file = if name.contains('.') { name.to_string() } else { format!("{name}.ogg") };
        let data = std::fs::read(self.dir.join("audio").join(file)).ok()?;
        let a = Arc::new(data);
        self.cache.insert(name.to_string(), a.clone());
        Some(a)
    }

    pub fn play(&mut self, kind: &str, volume: f32) {
        let priority = kind == "explosion" || kind == "collapse" || kind.starts_with("great-");
        self.active.retain(|(s, _)| !s.empty());
        if !self.enabled || self.effects <= 0.0 || volume < 0.03 || (self.active.len() >= 10 && !priority) {
            return;
        }
        let interval = if matches!(kind, "hit" | "wood" | "stone" | "gold" | "build" | "food") { 180 } else { 70 };
        let now = Instant::now();
        if self.last.get(kind).map(|t| now.duration_since(*t).as_millis() < interval).unwrap_or(false) {
            return;
        }
        self.last.insert(kind.to_string(), now);
        if priority && self.active.len() >= 10 {
            let q = self.active.remove(0);
            q.0.stop();
        }
        if kind == "attack" {
            self.attack_cue(volume);
            return;
        }
        let names = bank(kind);
        let n = self.counts.entry(kind.to_string()).or_insert(0);
        let name = names[*n % names.len()];
        *n += 1;
        let Some(bytes) = self.bytes(name) else {
            eprintln!("audio: missing effect {name}");
            return;
        };
        let src = match Decoder::new(Cursor::new((*bytes).clone())) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio: cannot decode effect {name}: {e}");
                return;
            }
        };
        let base = (volume * if priority { 0.95 } else if matches!(kind, "hit" | "wood" | "gold" | "stone" | "food" | "build") { 0.24 } else { 0.48 }).min(1.0);
        if let Ok(sink) = Sink::try_new(&self.handle) {
            sink.set_volume((base * self.effects).min(1.0));
            sink.append(src);
            self.active.push((sink, base));
        }
    }

    /// The three-note acknowledgement for attack orders.
    fn attack_cue(&mut self, volume: f32) {
        for (i, f) in [196.0f32, 261.63, 392.0].iter().enumerate() {
            let tone = rodio::source::SineWave::new(*f).take_duration(Duration::from_millis(170)).amplify(0.25 * volume * self.effects).fade_in(Duration::from_millis(15)).delay(Duration::from_millis(85 * i as u64));
            if let Ok(sink) = Sink::try_new(&self.handle) {
                sink.append(tone);
                self.active.push((sink, 0.2));
            }
        }
    }

    pub fn set_volumes(&mut self, effects: f32, music: f32) {
        self.effects = effects.clamp(0.0, 1.0);
        self.music_volume = music.clamp(0.0, 1.0);
        for (s, base) in &self.active {
            s.set_volume((base * self.effects).min(1.0));
        }
        if self.music_volume <= 0.0 {
            if let Some(m) = &self.music {
                m.pause();
            }
        } else if let Some(m) = &self.music {
            m.play();
        }
    }

    pub fn next_track(&mut self) {
        if let Some(m) = self.music.take() {
            m.stop();
        }
        self.start_music();
    }

    fn start_music(&mut self) {
        if self.bag.is_empty() {
            let mut bag: Vec<usize> = (0..TRACKS.len()).collect();
            for i in (1..bag.len()).rev() {
                let j = (self.rand() % (i as u64 + 1)) as usize;
                bag.swap(i, j);
            }
            if bag.len() > 1 && Some(bag[0]) == self.previous {
                bag.swap(0, 1);
            }
            self.bag = bag;
        }
        let idx = self.bag.remove(0);
        self.previous = Some(idx);
        let (id, title) = TRACKS[idx];
        let path = self.dir.join("music").join(format!("{id}.mp3"));
        let file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("audio: cannot open {}: {e}", path.display());
                return;
            }
        };
        let src = match Decoder::new(std::io::BufReader::new(file)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio: cannot decode {}: {e}", path.display());
                return;
            }
        };
        if let Ok(sink) = Sink::try_new(&self.handle) {
            sink.set_volume(0.0);
            sink.append(src);
            self.music = Some(sink);
            self.music_started = Instant::now();
            self.current = Some(title);
        }
    }

    /// Per-frame upkeep: keep the playlist going and fade tracks in.
    pub fn update(&mut self) {
        self.active.retain(|(s, _)| !s.empty());
        if self.music_volume <= 0.0 {
            return;
        }
        let ended = self.music.as_ref().map(|m| m.empty()).unwrap_or(true);
        if ended {
            self.start_music();
        }
        if let Some(m) = &self.music {
            let fade = (self.music_started.elapsed().as_secs_f32() / 3.0).min(1.0);
            m.set_volume((self.music_volume * fade).min(1.0));
        }
    }
}
