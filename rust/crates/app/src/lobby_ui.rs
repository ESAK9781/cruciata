//! LAN screens: the game list and the pre-match lobby (settings, factions, chat, ready).

use crate::emblem;
use crate::hud::{GOLD, INK, MUTED};
use crate::menu::{big_button, menu_button_plain, Menu, Out, QuickForm, Screen};
use crate::paint::col;
use crate::style::*;
use cruciata_core::factions::{self, FACTIONS};
use cruciata_net::lobby::Lobby;
use cruciata_net::protocol::LobbyState;
use eframe::egui::{self, Align2, Id, Pos2, Rect, RichText, Sense, Stroke, Vec2};

impl Menu {
    pub fn poll_lan(&mut self) {
        if let Some(b) = &mut self.lan.browser {
            self.lan.hosts = b.poll();
        }
        let label = self.lan_form.label();
        if let Some(h) = self.lan.host.as_mut() {
            h.set_label(label);
            if let Some(s) = h.poll() {
                // The guest is in: stop announcing and open the lobby around the connection.
                self.lan.host = None;
                let host_faction = self.lan.pending_faction;
                let guest_faction = if host_faction == factions::MUSLIM { factions::TEMPLAR } else { factions::MUSLIM };
                let state = LobbyState {
                    config: self.lan_form.config(),
                    host_name: self.lan.my_name.clone(),
                    guest_name: s.peer_name.clone(),
                    host_faction,
                    guest_faction,
                    host_ready: false,
                    guest_ready: false,
                };
                self.lan.lobby = Some(Lobby::host(s, state));
                self.lan.chat_input.clear();
                self.lan.error = None;
            }
        }
        if let Some(rx) = &self.lan.connecting {
            if let Ok(res) = rx.try_recv() {
                self.lan.connecting = None;
                match res {
                    Ok(s) => {
                        self.lan.lobby = Some(Lobby::guest(s, self.lan.my_name.clone()));
                        self.lan.chat_input.clear();
                        self.screen = Screen::LanLobby;
                    }
                    Err(e) => self.screen = Screen::LanMessage(e),
                }
            }
        }
        if let Some(p) = self.lan.debug_peer.as_mut() {
            p.poll();
        }
        if let Some(l) = self.lan.lobby.as_mut() {
            l.poll();
            if l.closed {
                let host = l.is_host;
                self.lan.lobby = None;
                if host {
                    // The guest left: open the door again.
                    self.lan.rehost = true;
                    self.lan.error = Some("Your guest left the lobby. Waiting for another player.".into());
                } else {
                    self.screen = Screen::LanMessage("The host closed the lobby.".into());
                }
            }
        }
    }

    /// Debug (`--do screen:lobby`): a host and a guest connected over loopback, so the lobby can be
    /// photographed from either side. The other side is driven by `debug_peer`.
    pub fn debug_lobby(&mut self, guest_view: bool) {
        use cruciata_net::session;
        let mut host = session::Host::start_on("Sir Godfrey".into(), "demo".into(), serde_json::Value::Null, 0, 47999).expect("host");
        let addr = std::net::SocketAddr::new("127.0.0.1".parse().unwrap(), host.port);
        let js = session::join(addr, "Lady Eleanor").expect("join");
        let hs = loop {
            if let Some(s) = host.poll() {
                break s;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        let state = LobbyState { config: self.lan_form.config(), host_name: "Sir Godfrey".into(), guest_name: "Lady Eleanor".into(), host_faction: factions::TEMPLAR, guest_faction: factions::HOSPITALLER, host_ready: false, guest_ready: false };
        let mut h = Lobby::host(hs, state);
        let mut g = Lobby::guest(js, "Lady Eleanor".into());
        let pump = |h: &mut Lobby, g: &mut Lobby| {
            for _ in 0..30 {
                h.poll();
                g.poll();
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        };
        pump(&mut h, &mut g);
        h.say("Welcome. Shall we say the seed is fair?".into());
        g.say("Fair enough. I will take the Hospitallers.".into());
        pump(&mut h, &mut g);
        g.set_ready(true);
        pump(&mut h, &mut g);
        self.lan.my_name = if guest_view { "Lady Eleanor".into() } else { "Sir Godfrey".into() };
        if guest_view {
            self.lan.lobby = Some(g);
            self.lan.debug_peer = Some(h);
        } else {
            self.lan.lobby = Some(h);
            self.lan.debug_peer = Some(g);
        }
        self.screen = Screen::LanLobby;
    }

    pub fn leave_lobby(&mut self) {
        if let Some(l) = self.lan.lobby.as_mut() {
            l.leave();
        }
        self.close_lan();
        self.open_lan_hub();
    }

    /// The top LAN screen: join one of the games found, or host a new one.
    pub(crate) fn lan_hub(&mut self, ui: &mut egui::Ui) -> Out {
        let mut out = Out::None;
        ui.label(RichText::new("Games on your network appear here by themselves. Nothing to type, no addresses, no ports.").size(11.5).color(col(INK)));
        if let Some(e) = &self.lan.error {
            ui.colored_label(col("#d9604a"), e);
        }
        ui.add_space(10.0);
        crate::hud::eyebrow(ui, "GAMES FOUND");
        egui::Frame::none().fill(col("#2a2d24")).stroke(Stroke::new(1.0, col("#655039"))).inner_margin(egui::Margin::same(10.0)).show(ui, |ui| {
            ui.set_width(620.0);
            ui.set_min_height(120.0);
            if self.lan.hosts.is_empty() {
                ui.horizontal(|ui| {
                    ui.add(egui::Spinner::new());
                    ui.label(RichText::new("Looking for games\u{2026}  Ask your friend to press \u{201c}Host a game\u{201d}.").color(col(MUTED)));
                });
            }
            for h in self.lan.hosts.clone() {
                ui.horizontal(|ui| {
                    ui.add_sized(Vec2::new(200.0, 28.0), egui::Label::new(RichText::new(&h.name).size(16.0).color(col("#e4cda2"))).truncate());
                    ui.label(RichText::new(&h.map).size(11.0).color(col(MUTED)));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.add_sized(Vec2::new(90.0, 28.0), egui::Button::new(RichText::new("Join").size(14.0))).clicked() {
                            out = Out::JoinLan(h.addr);
                        }
                    });
                });
                ui.separator();
            }
        });
        ui.add_space(16.0);
        ui.horizontal(|ui| {
            if ui.add_sized(Vec2::new(300.0, 46.0), egui::Button::new(RichText::new("Host a game").size(18.0))).clicked() {
                out = Out::HostLan;
            }
            if ui.add_sized(Vec2::new(200.0, 46.0), egui::Button::new(RichText::new("Back to main menu").size(14.0))).clicked() {
                self.close_lan();
                self.screen = Screen::Main;
            }
        });
        out
    }

    /// The lobby: game options, factions, players, chat and the ready button.
    pub(crate) fn lan_lobby(&mut self, ui: &mut egui::Ui) -> Out {
        let mut out = Out::None;
        if std::mem::take(&mut self.lan.rehost) {
            out = Out::HostLan;
        }
        if let Some(cfg) = self.lan.lobby.as_ref().and_then(|l| l.started.clone()) {
            return Out::StartLan(cfg);
        }
        let is_host = self.lan.lobby.as_ref().map(|l| l.is_host).unwrap_or(true);
        let origin = ui.cursor().min;
        let total = ui.available_width().min(1140.0);
        let left_w = (total * 0.62).min(740.0);
        let right_x = origin.x + left_w + 30.0;
        let right_w = (total - left_w - 30.0).max(300.0);
        let painter = ui.painter().clone();

        // ---- left: game options -------------------------------------------------------------
        spaced(&painter, origin, "GAME OPTIONS", sans(9.5), col(GOLD), 1.2);
        let mut y = origin.y + 22.0;
        if is_host {
            let names = [("frontier", "Frontier"), ("siege", "Siege"), ("scarcity", "Scarcity"), ("empire", "Empire")];
            let bw = (left_w - 3.0 * 8.0) / 4.0;
            for (i, (key, label)) in names.iter().enumerate() {
                let r = Rect::from_min_size(Pos2::new(origin.x + i as f32 * (bw + 8.0), y), Vec2::new(bw, 30.0));
                if menu_button_plain(ui, r, label) {
                    self.lan_form.preset(key);
                }
            }
            y += 42.0;
        } else {
            painter.text(Pos2::new(origin.x, y + 2.0), Align2::LEFT_TOP, "Only the host can change these settings. You choose your faction.", sans(11.5), col(MUTED));
            y += 28.0;
        }
        let shown = match (&self.lan.lobby, is_host) {
            (Some(l), false) => QuickForm::from_config(&l.state.config),
            _ => self.lan_form.clone(),
        };
        let mut form = shown;
        let form_rect = Rect::from_min_size(Pos2::new(origin.x, y), Vec2::new(left_w, 5.0 * 82.0));
        let mut form_ui = ui.child_ui(form_rect, egui::Layout::top_down(egui::Align::Min), None);
        form_ui.set_enabled(is_host);
        form.ui(&mut form_ui, true);
        if is_host {
            self.lan_form = form.clone();
            let cfg = self.lan_form.config();
            if let Some(l) = self.lan.lobby.as_mut() {
                l.set_config(cfg);
            }
        }
        y += 5.0 * 82.0 + 4.0;
        painter.line_segment([Pos2::new(origin.x, y), Pos2::new(origin.x + left_w, y)], Stroke::new(1.0, col("#4d4a38")));
        painter.text(Pos2::new(origin.x, y + 12.0), Align2::LEFT_TOP, "Both players start with the same stores, soldiers, workers and buildings. Fog hides each settlement until it is explored.", sans(10.0), col("#b6bbaa"));
        let left_bottom = y + 40.0;

        // ---- right: players, factions, chat, ready ------------------------------------------
        let mut ry = origin.y;
        spaced(&painter, Pos2::new(right_x, ry), "PLAYERS", sans(9.5), col(GOLD), 1.2);
        ry += 22.0;
        let (my_name, my_faction, peer, my_ready) = match &self.lan.lobby {
            Some(l) => (l.my_name().to_string(), l.my_faction(), Some((l.peer_name().to_string(), l.peer_faction(), l.peer_ready())), l.my_ready()),
            None => (self.lan.my_name.clone(), self.lan.pending_faction, None, false),
        };
        player_row(&painter, Rect::from_min_size(Pos2::new(right_x, ry), Vec2::new(right_w, 58.0)), Some((&my_name, my_faction, my_ready)), true, if is_host { "Host" } else { "Guest" });
        ry += 64.0;
        match &peer {
            Some((n, f, r)) => player_row(&painter, Rect::from_min_size(Pos2::new(right_x, ry), Vec2::new(right_w, 58.0)), Some((n, *f, *r)), false, if is_host { "Guest" } else { "Host" }),
            None => player_row(&painter, Rect::from_min_size(Pos2::new(right_x, ry), Vec2::new(right_w, 58.0)), None, false, "Guest"),
        }
        ry += 72.0;

        spaced(&painter, Pos2::new(right_x, ry), "YOUR FACTION", sans(9.5), col(GOLD), 1.2);
        ry += 22.0;
        let taken = peer.as_ref().map(|p| p.1);
        let cw = (right_w - 8.0) / 2.0;
        let mut wanted = None;
        for (i, f) in FACTIONS.iter().enumerate() {
            let r = Rect::from_min_size(Pos2::new(right_x + (i % 2) as f32 * (cw + 8.0), ry + (i / 2) as f32 * 66.0), Vec2::new(cw, 58.0));
            let blocked = taken == Some(f.slot);
            let resp = ui.interact(r, Id::new(("faction", f.slot)), if blocked { Sense::hover() } else { Sense::click() });
            let chosen = my_faction == f.slot;
            let fade = if blocked { 0.4 } else { 1.0 };
            let (l, rr) = if resp.hovered() && !blocked { (col("#4d4836"), col("#2a3631")) } else { (col("#3c382b"), col("#202927")) };
            gradient_h(&painter, r, l.gamma_multiply(fade), rr.gamma_multiply(fade));
            painter.rect_stroke(r, 0.0, Stroke::new(if chosen { 2.0 } else { 1.0 }, if chosen { col("#f0c978") } else { col("#887042").gamma_multiply(fade) }));
            emblem::shield(&painter, Rect::from_center_size(Pos2::new(r.min.x + 28.0, r.center().y), Vec2::new(34.0, 40.0)), f.slot);
            painter.text(Pos2::new(r.min.x + 54.0, r.min.y + 12.0), Align2::LEFT_TOP, f.name, serif(14.5), col("#f3e1b8").gamma_multiply(fade));
            painter.text(Pos2::new(r.min.x + 54.0, r.min.y + 34.0), Align2::LEFT_TOP, if blocked { "Taken" } else if chosen { "Chosen" } else { short_blurb(f.slot) }, sans(10.0), col("#b6bbaa").gamma_multiply(fade));
            if resp.on_hover_text(f.blurb).clicked() && !blocked {
                wanted = Some(f.slot);
            }
        }
        ry += 2.0 * 66.0 + 6.0;
        if let Some(f) = wanted {
            match self.lan.lobby.as_mut() {
                Some(l) => {
                    l.pick(f);
                }
                None => self.lan.pending_faction = f,
            }
        }

        spaced(&painter, Pos2::new(right_x, ry), "CHAT", sans(9.5), col(GOLD), 1.2);
        ry += 22.0;
        let chat_h = 170.0;
        let chat_rect = Rect::from_min_size(Pos2::new(right_x, ry), Vec2::new(right_w, chat_h));
        painter.rect_filled(chat_rect, 0.0, col("#121e23"));
        painter.rect_stroke(chat_rect, 0.0, Stroke::new(1.0, col("#7c6e4a")));
        let lines: Vec<(bool, String)> = self.lan.lobby.as_ref().map(|l| l.chat.iter().map(|c| (c.mine, c.text.clone())).collect()).unwrap_or_default();
        let peer_name = peer.as_ref().map(|p| p.0.clone()).unwrap_or_default();
        let mut chat_ui = ui.child_ui(chat_rect.shrink(8.0), egui::Layout::top_down(egui::Align::Min), None);
        chat_ui.set_clip_rect(chat_rect.shrink(2.0));
        egui::ScrollArea::vertical().id_salt("lobby-chat").stick_to_bottom(true).auto_shrink([false, false]).show(&mut chat_ui, |ui| {
            ui.set_width(right_w - 24.0);
            if lines.is_empty() {
                ui.label(RichText::new(if self.lan.lobby.is_some() { "Say hello to your opponent." } else { "Chat opens when a player joins." }).size(12.0).color(col(MUTED)));
            }
            for (mine, text) in &lines {
                let (name, color) = if *mine { (my_name.as_str(), "#f0c978") } else { (peer_name.as_str(), "#9fd0b8") };
                ui.label(RichText::new(format!("{name}: {text}")).size(12.5).color(col(color)));
            }
        });
        ry += chat_h + 6.0;
        let input_rect = Rect::from_min_size(Pos2::new(right_x, ry), Vec2::new(right_w - 78.0, 32.0));
        let enabled = self.lan.lobby.is_some();
        let mut send = false;
        let mut input_ui = ui.child_ui(input_rect, egui::Layout::left_to_right(egui::Align::Center), None);
        input_ui.set_enabled(enabled);
        let edit = input_ui.add_sized(input_rect.size(), egui::TextEdit::singleline(&mut self.lan.chat_input).hint_text("Type a message and press Enter").char_limit(200));
        if edit.lost_focus() && input_ui.input(|i| i.key_pressed(egui::Key::Enter)) {
            send = true;
            edit.request_focus();
        }
        let send_rect = Rect::from_min_size(Pos2::new(right_x + right_w - 70.0, ry), Vec2::new(70.0, 32.0));
        if enabled && menu_button_plain(ui, send_rect, "Send") {
            send = true;
        }
        if send {
            let text = std::mem::take(&mut self.lan.chat_input);
            if let Some(l) = self.lan.lobby.as_mut() {
                l.say(text);
            }
        }
        ry += 44.0;

        let can_ready = self.lan.lobby.is_some();
        let label = if !can_ready { "Waiting for a player\u{2026}" } else if my_ready { "Not ready" } else { "I am ready" };
        let half = (right_w - 8.0) / 2.0;
        let ready_rect = Rect::from_min_size(Pos2::new(right_x, ry), Vec2::new(half, 52.0));
        if can_ready {
            if big_button(ui, ready_rect, label, ("lobby-ready", 0)) {
                if let Some(l) = self.lan.lobby.as_mut() {
                    l.set_ready(!my_ready);
                }
            }
        } else {
            painter.rect_filled(ready_rect, 0.0, col("#202927"));
            painter.rect_stroke(ready_rect, 0.0, Stroke::new(1.0, col("#4d4a38")));
            painter.text(ready_rect.center(), Align2::CENTER_CENTER, label, serif(15.0), col(MUTED));
        }
        let leave_rect = Rect::from_min_size(Pos2::new(right_x + half + 8.0, ry), Vec2::new(half, 52.0));
        if big_button(ui, leave_rect, "Leave lobby", ("lobby-leave", 0)) {
            self.leave_lobby();
            return Out::None;
        }
        ry += 60.0;
        let status = match &self.lan.lobby {
            None => "Your game is listed on the network. Settings and faction can change until someone joins.".to_string(),
            Some(l) if l.my_ready() && l.peer_ready() => "Both ready. Starting the match\u{2026}".to_string(),
            Some(l) if l.my_ready() => format!("Waiting for {} to be ready.", l.peer_name()),
            Some(l) if l.peer_ready() => format!("{} is ready.", l.peer_name()),
            Some(_) => "Each player picks a different faction, then presses ready.".to_string(),
        };
        painter.text(Pos2::new(right_x, ry), Align2::LEFT_TOP, status, sans(11.0), col("#c5c4ae"));
        if let Some(e) = &self.lan.error {
            painter.text(Pos2::new(right_x, ry + 18.0), Align2::LEFT_TOP, e, sans(11.0), col("#d9a56a"));
        }
        ry += 40.0;
        ui.allocate_space(Vec2::new(total, left_bottom.max(ry) - origin.y + 10.0));
        out
    }
}

fn short_blurb(slot: i32) -> &'static str {
    match slot {
        factions::TEMPLAR => "Red cross on white",
        factions::HOSPITALLER => "White cross on black",
        factions::TEUTONIC => "Black cross on white",
        _ => "Crescent on green",
    }
}

fn player_row(p: &egui::Painter, r: Rect, who: Option<(&str, i32, bool)>, me: bool, role: &str) {
    p.rect_filled(r, 0.0, col("#162127"));
    p.rect_stroke(r, 0.0, Stroke::new(1.0, if me { col("#887042") } else { col("#4d4a38") }));
    match who {
        Some((name, faction, ready)) => {
            emblem::shield(p, Rect::from_center_size(Pos2::new(r.min.x + 30.0, r.center().y), Vec2::new(36.0, 42.0)), faction);
            p.text(Pos2::new(r.min.x + 58.0, r.min.y + 9.0), Align2::LEFT_TOP, format!("{name}{}", if me { " (you)" } else { "" }), serif(16.0), col("#f3e1b8"));
            p.text(Pos2::new(r.min.x + 58.0, r.min.y + 34.0), Align2::LEFT_TOP, format!("{role} \u{b7} {}", factions::name(faction)), sans(11.0), col("#b6bbaa"));
            p.text(Pos2::new(r.max.x - 12.0, r.center().y), Align2::RIGHT_CENTER, if ready { "READY" } else { "NOT READY" }, sans(10.0), if ready { col("#8fd09b") } else { col(MUTED) });
        }
        None => {
            p.text(r.center(), Align2::CENTER_CENTER, "Waiting for a player to join\u{2026}", sans(12.0), col(MUTED));
        }
    }
}
