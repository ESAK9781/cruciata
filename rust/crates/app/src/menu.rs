//! Front menus: campaign, quickmatch sessions, LAN play, settings.

use crate::hud::{eyebrow, GOLD, INK, MUTED};
use crate::paint::col;
use crate::store::{self, Progress};
use cruciata_core::data::data;
use cruciata_net::discovery::{Browser, HostInfo};
use cruciata_net::session::{self, Host};
use crate::style::*;
use eframe::egui::{self, Align2, Color32, Id, Pos2, Rect, RichText, Sense, Stroke, Vec2};
use std::sync::mpsc::Receiver;

#[derive(Clone)]
pub struct QuickForm {
    pub size: usize,
    pub frequency: usize,
    pub resources: f64,
    pub units: f64,
    pub composition: usize,
    pub workers: f64,
    pub structures: usize,
    pub difficulty: usize,
    pub biome: usize,
    pub seed: u64,
}

const SIZES: [(&str, f64, f64); 3] = [("Large \u{b7} 12800 \u{d7} 8800", 12800.0, 8800.0), ("Grand \u{b7} 16000 \u{d7} 10800", 16000.0, 10800.0), ("Epic \u{b7} 19200 \u{d7} 12800", 19200.0, 12800.0)];
const FREQ: [(&str, f64); 4] = [("Scarce", 0.3), ("Sparse", 0.45), ("Balanced", 0.65), ("Abundant", 0.8)];
const COMP: [(&str, &str); 4] = [("Infantry and archers", "balanced"), ("Infantry vanguard", "vanguard"), ("Mounted company", "cavalry"), ("Siege company", "siege")];
const STRUCT: [(&str, &str); 2] = [("Town, barracks, housing", "settlement"), ("Developed settlement and fields", "developed")];
const DIFF: [(&str, &str); 3] = [("Easy", "easy"), ("Normal", "normal"), ("Hard", "hard")];
const BIOME: [&str; 4] = ["Coastal grassland", "River valley", "Arid highlands", "Winter foothills"];

fn random_seed() -> u64 {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(1);
    (t % 999_999) as u64 + 1
}

impl QuickForm {
    pub fn new() -> QuickForm {
        QuickForm { size: 0, frequency: 2, resources: 500.0, units: 8.0, composition: 0, workers: 6.0, structures: 0, difficulty: 1, biome: 0, seed: random_seed() }
    }

    pub fn preset(&mut self, name: &str) {
        let (size, freq, res, units, st, diff) = match name {
            "frontier" => (0, 1, 500.0, 8.0, 0, 1),
            "siege" => (1, 2, 1400.0, 30.0, 1, 2),
            "scarcity" => (0, 0, 280.0, 4.0, 0, 1),
            _ => (2, 3, 900.0, 20.0, 1, 2),
        };
        self.size = size;
        self.frequency = freq;
        self.resources = res;
        self.units = units;
        self.structures = st;
        self.difficulty = diff;
    }

    pub fn config(&self) -> serde_json::Value {
        serde_json::json!({
            "width": SIZES[self.size].1, "height": SIZES[self.size].2,
            "frequency": FREQ[self.frequency].1, "resources": self.resources, "units": self.units,
            "workers": self.workers, "seed": self.seed, "biome": self.biome,
            "structures": STRUCT[self.structures].1, "difficulty": DIFF[self.difficulty].1, "composition": COMP[self.composition].1,
        })
    }

    pub fn label(&self) -> String {
        format!("{} \u{b7} seed {}", BIOME[self.biome], self.seed)
    }

    fn ui(&mut self, ui: &mut egui::Ui) {
        ui.spacing_mut().item_spacing = Vec2::new(10.0, 6.0);
        form_combo(ui, "Map size", &mut self.size, &SIZES.iter().map(|s| s.0).collect::<Vec<_>>());
        form_combo(ui, "Resource frequency", &mut self.frequency, &FREQ.iter().map(|s| s.0).collect::<Vec<_>>());
        form_row(ui, "Starting resources per type", |ui| {
            ui.add(egui::DragValue::new(&mut self.resources).range(100.0..=5000.0).speed(10.0));
        });
        form_row(ui, "Starting soldiers per army", |ui| {
            ui.add(egui::DragValue::new(&mut self.units).range(0.0..=80.0));
        });
        form_combo(ui, "Army composition", &mut self.composition, &COMP.iter().map(|s| s.0).collect::<Vec<_>>());
        form_row(ui, "Starting villagers per settlement", |ui| {
            ui.add(egui::DragValue::new(&mut self.workers).range(4.0..=24.0));
        });
        form_combo(ui, "Starting structures", &mut self.structures, &STRUCT.iter().map(|s| s.0).collect::<Vec<_>>());
        form_combo(ui, "AI difficulty", &mut self.difficulty, &DIFF.iter().map(|s| s.0).collect::<Vec<_>>());
        form_combo(ui, "Biome", &mut self.biome, &BIOME);
        form_row(ui, "Generation seed", |ui| {
            ui.add(egui::DragValue::new(&mut self.seed).range(1..=2147483647u64));
        });
    }
}

/// One labelled row: the label sits on a fixed column and everything is vertically centred.
fn form_row(ui: &mut egui::Ui, label: &str, add: impl FnOnce(&mut egui::Ui)) {
    ui.allocate_ui_with_layout(Vec2::new(ui.available_width(), 32.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
        ui.allocate_ui_with_layout(Vec2::new(280.0, 28.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
            ui.set_min_size(Vec2::new(280.0, 28.0));
            ui.label(RichText::new(label).size(12.0).color(col(INK)));
        });
        add(ui);
    });
}

fn form_combo(ui: &mut egui::Ui, label: &str, value: &mut usize, items: &[&str]) {
    form_row(ui, label, |ui| {
        egui::ComboBox::from_id_salt(label).selected_text(items[*value]).width(260.0).show_ui(ui, |ui| {
            for (i, it) in items.iter().enumerate() {
                ui.selectable_value(value, i, *it);
            }
        });
    });
}

fn combo(ui: &mut egui::Ui, label: &str, value: &mut usize, items: &[&str]) {
    ui.label(label);
    egui::ComboBox::from_id_salt(label).selected_text(items[*value]).width(240.0).show_ui(ui, |ui| {
        for (i, it) in items.iter().enumerate() {
            ui.selectable_value(value, i, *it);
        }
    });
    ui.end_row();
}

pub enum Screen {
    Main,
    Campaign,
    Slots,
    Creation(usize),
    LanHub,
    LanHost,
    Loading(String),
    LanMessage(String),
    Playing,
}

pub struct LanState {
    pub browser: Option<Browser>,
    pub hosts: Vec<HostInfo>,
    pub host: Option<Host>,
    pub error: Option<String>,
    pub connecting: Option<Receiver<Result<session::Session, String>>>,
}

pub struct Menu {
    pub screen: Screen,
    pub form: QuickForm,
    pub lan_form: QuickForm,
    pub lan: LanState,
    pub campaign_difficulty: usize,
}

pub enum Out {
    None,
    Campaign(usize, String),
    ResumeCampaign,
    Quick(serde_json::Value, usize),
    ResumeQuick(usize),
    HostLan,
    JoinLan(std::net::SocketAddr),
    Settings,
    Resume,
    Leave,
    Quit,
}

impl Menu {
    pub fn new() -> Menu {
        Menu {
            screen: Screen::Main,
            form: QuickForm::new(),
            lan_form: QuickForm::new(),
            lan: LanState { browser: None, hosts: vec![], host: None, error: None, connecting: None },
            campaign_difficulty: 1,
        }
    }

    pub fn open_lan_hub(&mut self) {
        self.lan.error = None;
        self.lan.hosts.clear();
        self.lan.browser = match Browser::new() {
            Ok(b) => Some(b),
            Err(e) => {
                self.lan.error = Some(format!("Could not listen for games on this network ({e}). Another copy of Cruciata may already be open."));
                None
            }
        };
        self.screen = Screen::LanHub;
    }

    pub fn close_lan(&mut self) {
        self.lan.browser = None;
        self.lan.host = None;
        self.lan.connecting = None;
    }

    pub fn poll_lan(&mut self) {
        if let Some(b) = &mut self.lan.browser {
            self.lan.hosts = b.poll();
        }
    }

    pub fn show(&mut self, ctx: &egui::Context, progress: &Progress, in_game: bool, in_lan: bool, can_resume_campaign: bool, icons: &Icons, banner: Option<egui::TextureId>) -> Out {
        let mut out = Out::None;
        egui::CentralPanel::default().frame(egui::Frame::none()).show(ctx, |ui| {
            let r = ui.max_rect();
            let p = ui.painter().clone();
            p.rect_filled(r, 0.0, col("#0c171c"));
            // Warm glow at 80% / 35% fading out by 55% of the width.
            let glow = Pos2::new(r.min.x + r.width() * 0.8, r.min.y + r.height() * 0.35);
            radial_glow(&p, glow, r.width() * 0.55, crate::paint::rgba(134, 92, 41, 48));
            let left = (((r.width() - 1300.0).max(0.0)) / 2.0 + 75.0).max(40.0);
            let x0 = r.min.x + left;
            icons.draw(&p, "cross-gold", Rect::from_min_size(Pos2::new(x0, r.min.y + 40.0), Vec2::splat(65.0)));
            p.text(Pos2::new(x0 + 87.0, r.min.y + 38.0), Align2::LEFT_TOP, "cruciāta", serif(46.0), col("#ddbd77"));
            spaced(&p, Pos2::new(x0 + 88.0, r.min.y + 92.0), "CHRONICA \u{b7} FIDES \u{b7} IMPERIUM", sans(10.0), col("#ddbd77"), 4.0);
            if let Some(t) = banner {
                let h = (r.height() * 0.58).min(560.0);
                let w = h * 260.0 / 620.0;
                let bx = (r.max.x - 100.0 - w).max(x0 + 800.0);
                p.image(t, Rect::from_min_size(Pos2::new(bx, r.min.y + r.height() * 0.15), Vec2::new(w, h)), Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
            }
            let foot = "A fictional chronicle of the First Crusade \u{b7} Local saves \u{b7} Original overhead artwork";
            p.text(Pos2::new(x0 + 1.0, r.max.y - 42.0), Align2::LEFT_TOP, foot, sans(10.0), col("#8d9a94"));
            let (eyebrow_txt, title): (String, String) = match &self.screen {
                Screen::Main => ("AD MAIOREM DEI GLORIAM".into(), "The road to Jerusalem".into()),
                Screen::Campaign => ("ITINERARIUM \u{b7} 1097\u{2013}1099".into(), "The pilgrim's chronicle".into()),
                Screen::Slots => ("TRES CHRONICAE \u{b7} THREE LOCAL SESSIONS".into(), "Quickmatch".into()),
                Screen::Creation(s) => (format!("QUICKMATCH \u{b7} SESSION {}", s + 1), "Shape the battlefield".into()),
                Screen::LanHub | Screen::LanHost | Screen::LanMessage(_) => ("PLAYER VERSUS PLAYER \u{b7} SAME NETWORK".into(), "LAN multiplayer".into()),
                Screen::Loading(_) => ("PLEASE WAIT".into(), "Raising the standards".into()),
                Screen::Playing => (String::new(), String::new()),
            };
            spaced(&p, Pos2::new(x0, r.min.y + 132.0), &eyebrow_txt, sans(8.0), col("#bba279"), 1.4);
            let main = matches!(self.screen, Screen::Main);
            p.text(Pos2::new(x0, r.min.y + if main { 150.0 } else { 148.0 }), Align2::LEFT_TOP, &title, serif(if main { 52.0 } else { 40.0 }), col("#f7e8c5"));
            let content_top = r.min.y + if main { 235.0 } else { 205.0 };
            if main {
                let galley = p.layout("Raise a settlement. Sustain a host. Carry your standard through a land shaped by faith, siege, and the cost of war.".to_string(), serif(18.0), col("#c5c4ae"), 670.0);
                p.galley(Pos2::new(x0, content_top), galley, col("#c5c4ae"));
                let mut y = r.min.y + 317.0;
                let mut items: Vec<(&str, &str, bool, u8)> = vec![
                    ("Campaign", "Six chapters \u{b7} the pilgrim's chronicle", true, 0),
                    ("Quickmatch", "Generated battlefields \u{b7} three local sessions", true, 1),
                    ("LAN multiplayer", "Play a friend on the same network \u{b7} no setup", true, 2),
                    ("Continue campaign", "Your last recorded march", can_resume_campaign, 3),
                    ("Settings", "Music, sound effects, and battle detail", true, 4),
                    ("Quit", "Leave the game", true, 5),
                ];
                if in_game {
                    items.insert(0, ("Return to the battle", "Close this menu", true, 6));
                    if in_lan {
                        items.insert(1, ("Leave the match", "Concede and disconnect from your opponent", true, 7));
                    }
                }
                for (i, (t, s, enabled, id)) in items.iter().enumerate() {
                    let (col_i, row_i) = (i % 2, i / 2);
                    let rect = Rect::from_min_size(Pos2::new(x0 + col_i as f32 * 397.0, y + row_i as f32 * 94.0), Vec2::new(383.0, 80.0));
                    if menu_button(ui, rect, t, s, *enabled, *id as u32) {
                        match id {
                            0 => self.screen = Screen::Campaign,
                            1 => self.screen = Screen::Slots,
                            2 => self.open_lan_hub(),
                            3 => out = Out::ResumeCampaign,
                            4 => out = Out::Settings,
                            5 => out = Out::Quit,
                            6 => out = Out::Resume,
                            _ => out = Out::Leave,
                        }
                    }
                }
                y += ((items.len() + 1) / 2) as f32 * 94.0 + 6.0;
                p.text(Pos2::new(x0, y + 22.0), Align2::LEFT_TOP, "\u{201c}Beati pacifici, quoniam filii Dei vocabuntur.\u{201d}", serif_italic(18.0), col("#dabd81"));
                p.text(Pos2::new(x0, y + 54.0), Align2::LEFT_TOP, "Blessed are the peacemakers \u{b7} Matthew 5:9", sans(11.0), col("#b2b6a9"));
            } else if matches!(self.screen, Screen::Loading(_)) {
                if let Screen::Loading(t) = &self.screen {
                    p.text(Pos2::new(x0, content_top + 10.0), Align2::LEFT_TOP, t, serif(20.0), col("#e4cda2"));
                }
                let mut child = ui.child_ui(Rect::from_min_size(Pos2::new(x0, content_top + 50.0), Vec2::new(200.0, 60.0)), egui::Layout::left_to_right(egui::Align::Min), None);
                child.add(egui::Spinner::new().size(34.0));
            } else {
                let area = Rect::from_min_max(Pos2::new(x0, content_top), Pos2::new((x0 + 820.0).min(r.max.x - 20.0), r.max.y - 60.0));
                let mut child = ui.child_ui(area, egui::Layout::top_down(egui::Align::Min), None);
                child.set_clip_rect(area);
                egui::ScrollArea::vertical().auto_shrink([false, false]).show(&mut child, |ui| {
                    ui.set_width(area.width() - 12.0);
                    match &self.screen {
                        Screen::Campaign => out = self.campaign(ui, progress),
                        Screen::Slots => out = self.slots(ui),
                        Screen::Creation(slot) => {
                            let slot = *slot;
                            out = self.creation(ui, slot);
                        }
                        Screen::LanHub => out = self.lan_hub(ui),
                        Screen::LanHost => out = self.lan_host(ui),
                        Screen::LanMessage(m) => {
                            let m = m.clone();
                            ui.label(RichText::new(m).size(16.0).color(col("#e4cda2")));
                            ui.add_space(16.0);
                            if ui.button("Back").clicked() {
                                self.screen = Screen::LanHub;
                            }
                        }
                        _ => {}
                    }
                });
            }
        });
        out
    }

    fn campaign(&mut self, ui: &mut egui::Ui, p: &Progress) -> Out {
        let mut out = Out::None;
        ui.horizontal(|ui| {
            ui.label("Enemy command");
            egui::ComboBox::from_id_salt("campdiff").selected_text(["Easy \u{b7} patient opponent", "Normal \u{b7} balanced opponent", "Hard \u{b7} coordinated opponent"][self.campaign_difficulty]).show_ui(ui, |ui| {
                for (i, t) in ["Easy \u{b7} patient opponent", "Normal \u{b7} balanced opponent", "Hard \u{b7} coordinated opponent"].iter().enumerate() {
                    ui.selectable_value(&mut self.campaign_difficulty, i, *t);
                }
            });
        });
        ui.add_space(8.0);
        for (i, l) in data().levels.iter().enumerate() {
            let open = i <= p.unlocked;
            let state = if p.completed.contains(&i) { "Completed" } else if !open { "Locked" } else { "Available" };
            let txt = RichText::new(format!("{}   {}   \u{2014} {}      {}", l.roman, l.name, l.sub, state)).size(14.0);
            if ui.add_enabled(open, egui::Button::new(txt).min_size(Vec2::new(560.0, 40.0))).clicked() {
                out = Out::Campaign(i, ["easy", "normal", "hard"][self.campaign_difficulty].to_string());
            }
        }
        ui.label(RichText::new(format!("{} / 6 chapters completed. Difficulty changes decisions and coordination; resources and unit rules stay equal.", p.completed.len())).size(10.0).color(col(MUTED)));
        ui.add_space(8.0);
        if ui.button("Back to main menu").clicked() {
            self.screen = Screen::Main;
        }
        out
    }

    fn slots(&mut self, ui: &mut egui::Ui) -> Out {
        let mut out = Out::None;
        ui.add_space(8.0);
        for i in 0..3 {
            let saved = store::read_save(Some(i));
            egui::Frame::none().fill(col("#2a2d24")).stroke(Stroke::new(1.0, col("#655039"))).inner_margin(egui::Margin::same(12.0)).show(ui, |ui| {
                ui.set_width(520.0);
                eyebrow(ui, &format!("SESSION {}", i + 1));
                ui.label(RichText::new(if saved.is_some() { "Standards over the frontier" } else { "An unwritten chronicle" }).size(16.0).color(col("#e4cda2")));
                ui.label(RichText::new(saved.as_ref().map(store::describe_save).unwrap_or_else(|| "Choose a preset or shape your own battlefield.".into())).size(10.5).color(col(MUTED)));
                ui.horizontal(|ui| {
                    if ui.button(if saved.is_some() { "Resume session" } else { "Create session" }).clicked() {
                        if saved.is_some() {
                            out = Out::ResumeQuick(i);
                        } else {
                            self.screen = Screen::Creation(i);
                        }
                    }
                    if saved.is_some() && ui.button("Delete this session").clicked() {
                        store::delete_save(Some(i));
                    }
                });
            });
        }
        ui.add_space(8.0);
        if ui.button("Back to main menu").clicked() {
            self.screen = Screen::Main;
        }
        out
    }

    fn creation(&mut self, ui: &mut egui::Ui, slot: usize) -> Out {
        let mut out = Out::None;
        ui.horizontal(|ui| {
            for (n, sub) in [("frontier", "Balanced settlement"), ("siege", "Developed armies"), ("scarcity", "Every patch matters"), ("empire", "A grand battlefield")] {
                if ui.button(format!("{}\n{}", crate::text::cap(n), sub)).clicked() {
                    self.form.preset(n);
                }
            }
        });
        ui.add_space(8.0);
        let mut f = self.form.clone();
        f.ui(ui);
        self.form = f;
        ui.label(RichText::new("Both armies receive the same stores, soldiers, workers, buildings, training costs and population rules. Resources are finite; fog conceals your settlement until explored.").size(10.0).color(col(MUTED)));
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            if ui.button(RichText::new("Raise the standards").size(15.0)).clicked() {
                out = Out::Quick(self.form.config(), slot);
            }
            if ui.button("Back to sessions").clicked() {
                self.screen = Screen::Slots;
            }
        });
        out
    }

    fn lan_hub(&mut self, ui: &mut egui::Ui) -> Out {
        let mut out = Out::None;
        self.poll_lan();
        ui.label(RichText::new("Games on your network appear here by themselves. Nothing to type, no addresses, no ports.").size(11.5).color(col(INK)));
        if let Some(e) = &self.lan.error {
            ui.colored_label(col("#d9604a"), e);
        }
        ui.add_space(10.0);
        eyebrow(ui, "GAMES FOUND");
        egui::Frame::none().fill(col("#2a2d24")).stroke(Stroke::new(1.0, col("#655039"))).inner_margin(egui::Margin::same(10.0)).show(ui, |ui| {
            ui.set_width(520.0);
            ui.set_min_height(90.0);
            if self.lan.hosts.is_empty() {
                ui.label(RichText::new("Looking for games\u{2026}  Ask your friend to choose \u{201c}Host a game\u{201d}.").color(col(MUTED)));
                ui.add(egui::Spinner::new());
            }
            for h in self.lan.hosts.clone() {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(&h.name).size(15.0).color(col("#e4cda2")));
                    ui.label(RichText::new(&h.map).size(10.5).color(col(MUTED)));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button(RichText::new("Join").size(14.0)).clicked() {
                            out = Out::JoinLan(h.addr);
                        }
                    });
                });
            }
        });
        ui.add_space(14.0);
        eyebrow(ui, "OR START ONE");
        let mut f = self.lan_form.clone();
        f.ui(ui);
        self.lan_form = f;
        ui.horizontal(|ui| {
            if ui.button(RichText::new("Host a game").size(15.0)).clicked() {
                out = Out::HostLan;
            }
            if ui.button("Back to main menu").clicked() {
                self.close_lan();
                self.screen = Screen::Main;
            }
        });
        out
    }

    fn lan_host(&mut self, ui: &mut egui::Ui) -> Out {
        ui.label(RichText::new("Waiting for a friend to join\u{2026}").size(22.0).color(col("#e4cda2")));
        ui.label(RichText::new(format!("Your game is visible on this network as \u{201c}{}\u{201d}. Your friend only needs to open LAN multiplayer and press Join.", session::computer_name())).size(12.0).color(col(INK)));
        ui.add_space(10.0);
        ui.add(egui::Spinner::new().size(34.0));
        ui.add_space(14.0);
        if ui.button("Cancel").clicked() {
            self.close_lan();
            self.screen = Screen::LanHub;
            self.open_lan_hub();
        }
        Out::None
    }
}

fn combo_row(ui: &mut egui::Ui, label: &str, value: &mut usize, items: &[&str]) {
    ui.horizontal(|ui| {
        ui.label(label);
        egui::ComboBox::from_id_salt(label).selected_text(items[*value]).width(240.0).show_ui(ui, |ui| {
            for (i, it) in items.iter().enumerate() {
                ui.selectable_value(value, i, *it);
            }
        });
    });
}

pub fn _anchor() -> Align2 {
    Align2::CENTER_CENTER
}

/// One of the big menu buttons (110-degree gradient, serif title).
fn menu_button(ui: &mut egui::Ui, rect: Rect, title: &str, sub: &str, enabled: bool, id: u32) -> bool {
    let resp = ui.interact(rect, Id::new(("menu-btn", id)), if enabled { Sense::click() } else { Sense::hover() });
    let p = ui.painter();
    let hovered = resp.hovered() && enabled;
    let (l, r) = if hovered { (col("#4d4836"), col("#2a3631")) } else { (col("#3c382b"), col("#202927")) };
    gradient_h(p, rect, l, r);
    p.rect_stroke(rect, 0.0, Stroke::new(1.0, if hovered { col("#b09250") } else { col("#887042") }));
    let fade = if enabled { 1.0 } else { 0.45 };
    p.text(Pos2::new(rect.min.x + 20.0, rect.min.y + 17.0), Align2::LEFT_TOP, title, serif(20.0), col("#f3e1b8").gamma_multiply(fade));
    p.text(Pos2::new(rect.min.x + 20.0, rect.min.y + 48.0), Align2::LEFT_TOP, sub, sans(12.0), col("#b6bbaa").gamma_multiply(fade));
    enabled && resp.clicked()
}
