//! Front menus: campaign, quickmatch sessions, LAN play, settings.

use crate::hud::{eyebrow, GOLD, INK, MUTED};
use crate::paint::col;
use crate::store::{self, Progress};
use cruciata_core::data::data;
use cruciata_net::discovery::{Browser, HostInfo};
use cruciata_net::session::{self, Host};
use eframe::egui::{self, Align2, RichText, Stroke, Vec2};
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
        egui::Grid::new("quickform").num_columns(2).spacing([14.0, 8.0]).show(ui, |ui| {
            combo(ui, "Map size", &mut self.size, &SIZES.iter().map(|s| s.0).collect::<Vec<_>>());
            combo(ui, "Resource frequency", &mut self.frequency, &FREQ.iter().map(|s| s.0).collect::<Vec<_>>());
            ui.label("Starting resources per type");
            ui.add(egui::DragValue::new(&mut self.resources).range(100.0..=5000.0).speed(10.0));
            ui.end_row();
            ui.label("Starting soldiers per army");
            ui.add(egui::DragValue::new(&mut self.units).range(0.0..=80.0));
            ui.end_row();
            combo(ui, "Army composition", &mut self.composition, &COMP.iter().map(|s| s.0).collect::<Vec<_>>());
            ui.label("Starting villagers per settlement");
            ui.add(egui::DragValue::new(&mut self.workers).range(4.0..=24.0));
            ui.end_row();
            combo(ui, "Starting structures", &mut self.structures, &STRUCT.iter().map(|s| s.0).collect::<Vec<_>>());
            combo(ui, "Biome", &mut self.biome, &BIOME);
            ui.label("Generation seed");
            ui.add(egui::DragValue::new(&mut self.seed).range(1..=2147483647u64));
            ui.end_row();
        });
    }
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

    pub fn show(&mut self, ctx: &egui::Context, progress: &Progress, in_game: bool, in_lan: bool, can_resume_campaign: bool) -> Out {
        let mut out = Out::None;
        egui::CentralPanel::default().frame(egui::Frame::none().fill(col("#1c1f18"))).show(ctx, |ui| {
            let r = ui.max_rect();
            // Vignette.
            ui.painter().rect_filled(r, 0.0, col("#1c1f18"));
            ui.painter().circle_filled(r.center_top() + Vec2::new(-r.width() * 0.2, 0.0), r.width() * 0.45, col("#2d2b22"));
            ui.vertical_centered(|ui| {
                ui.add_space((r.height() * 0.06).max(20.0));
                egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                    ui.set_max_width(760.0);
                    ui.vertical_centered(|ui| {
                        ui.set_width(720.0);
                        ui.label(RichText::new("+  cruciāta").size(34.0).color(col("#e4cda2")).italics());
                        ui.label(RichText::new("CHRONICA \u{b7} FIDES \u{b7} IMPERIUM").size(10.0).color(col(MUTED)).extra_letter_spacing(3.0));
                        ui.add_space(14.0);
                        match &self.screen {
                            Screen::Main => out = self.main(ui, progress, in_game, in_lan, can_resume_campaign),
                            Screen::Campaign => out = self.campaign(ui, progress),
                            Screen::Slots => out = self.slots(ui),
                            Screen::Creation(slot) => {
                                let slot = *slot;
                                out = self.creation(ui, slot);
                            }
                            Screen::LanHub => out = self.lan_hub(ui),
                            Screen::LanHost => out = self.lan_host(ui),
                            Screen::Loading(t) => {
                                ui.add_space(60.0);
                                ui.label(RichText::new(t.as_str()).size(22.0).color(col("#e4cda2")));
                                ui.add(egui::Spinner::new().size(36.0));
                            }
                            Screen::LanMessage(m) => {
                                ui.add_space(40.0);
                                ui.label(RichText::new(m.as_str()).size(16.0).color(col("#e4cda2")));
                                ui.add_space(16.0);
                                if ui.button("Back").clicked() {
                                    self.screen = Screen::LanHub;
                                }
                            }
                            Screen::Playing => {}
                        }
                        ui.add_space(24.0);
                        ui.label(RichText::new("A fictional chronicle of the First Crusade \u{b7} Local saves \u{b7} Original overhead artwork").size(9.5).color(col(MUTED)));
                    });
                });
            });
        });
        out
    }

    fn big(ui: &mut egui::Ui, title: &str, sub: &str) -> bool {
        let r = ui.add_sized([420.0, 54.0], egui::Button::new(RichText::new(format!("{title}\n{sub}")).size(15.0)).wrap());
        r.clicked()
    }

    fn main(&mut self, ui: &mut egui::Ui, _p: &Progress, in_game: bool, in_lan: bool, can_resume_campaign: bool) -> Out {
        let mut out = Out::None;
        eyebrow(ui, "AD MAIOREM DEI GLORIAM");
        ui.label(RichText::new("The road to Jerusalem").size(30.0).color(col("#e4cda2")));
        ui.label(RichText::new("Raise a settlement. Sustain a host. Carry your standard through a land shaped by faith, siege, and the cost of war.").size(12.0).color(col(INK)));
        ui.add_space(14.0);
        if in_game && Self::big(ui, "Return to the battle", "Close this menu") {
            out = Out::Resume;
        }
        if in_game && in_lan && Self::big(ui, "Leave the match", "Concede and disconnect from your opponent") {
            out = Out::Leave;
        }
        if Self::big(ui, "Campaign", "Six chapters \u{b7} the pilgrim's chronicle") {
            self.screen = Screen::Campaign;
        }
        if Self::big(ui, "Quickmatch", "Generated battlefields \u{b7} three local sessions") {
            self.screen = Screen::Slots;
        }
        if Self::big(ui, "LAN multiplayer", "Play a friend on the same network \u{b7} no setup") {
            self.open_lan_hub();
        }
        ui.add_enabled_ui(can_resume_campaign, |ui| {
            if Self::big(ui, "Continue campaign", "Your last recorded march") {
                out = Out::ResumeCampaign;
            }
        });
        if Self::big(ui, "Settings", "Music, sound effects, and battle detail") {
            out = Out::Settings;
        }
        if Self::big(ui, "Quit", "") {
            out = Out::Quit;
        }
        ui.add_space(12.0);
        ui.label(RichText::new("\u{201c}Beati pacifici, quoniam filii Dei vocabuntur.\u{201d}").italics().size(13.0).color(col(GOLD)));
        ui.label(RichText::new("Blessed are the peacemakers \u{b7} Matthew 5:9").size(9.5).color(col(MUTED)));
        out
    }

    fn campaign(&mut self, ui: &mut egui::Ui, p: &Progress) -> Out {
        let mut out = Out::None;
        eyebrow(ui, "ITINERARIUM \u{b7} 1097\u{2013}1099");
        ui.label(RichText::new("The pilgrim's chronicle").size(26.0).color(col("#e4cda2")));
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
        eyebrow(ui, "TRES CHRONICAE \u{b7} THREE LOCAL SESSIONS");
        ui.label(RichText::new("Quickmatch").size(26.0).color(col("#e4cda2")));
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
        eyebrow(ui, &format!("QUICKMATCH \u{b7} SESSION {}", slot + 1));
        ui.label(RichText::new("Shape the battlefield").size(26.0).color(col("#e4cda2")));
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
        combo_row(ui, "AI difficulty", &mut f.difficulty, &DIFF.iter().map(|s| s.0).collect::<Vec<_>>());
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
        eyebrow(ui, "PLAYER VERSUS PLAYER \u{b7} SAME NETWORK");
        ui.label(RichText::new("LAN multiplayer").size(26.0).color(col("#e4cda2")));
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
        ui.add_space(30.0);
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
