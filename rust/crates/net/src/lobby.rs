//! The pre-match lobby. The host edits the settings and picks a faction; the guest sees every
//! setting but can only change their own faction. Each side presses ready, then the host starts
//! the match. Messages ride the same TCP link the lockstep uses afterwards.

use crate::link::{Link, TcpLink};
use crate::protocol::{LobbyState, Msg};
use crate::session::Session;

/// One line of lobby chat.
#[derive(Clone, Debug)]
pub struct ChatLine {
    pub mine: bool,
    pub text: String,
}

pub struct Lobby {
    link: TcpLink,
    pub is_host: bool,
    pub state: LobbyState,
    pub chat: Vec<ChatLine>,
    /// The other player left or the connection dropped.
    pub closed: bool,
    /// Both are ready and the host started: build the match from `config`.
    pub started: Option<serde_json::Value>,
}

impl Lobby {
    /// The host side: a guest just connected.
    pub fn host(session: Session, state: LobbyState) -> Lobby {
        let mut l = Lobby { link: session.link, is_host: true, state, chat: Vec::new(), closed: false, started: None };
        l.broadcast();
        l
    }

    /// The guest side: wait for the host's first `Lobby` message (`poll`).
    pub fn guest(session: Session, my_name: String) -> Lobby {
        let state = LobbyState {
            config: session.config.clone(),
            host_name: session.peer_name.clone(),
            guest_name: my_name,
            host_faction: 0,
            guest_faction: 0,
            host_ready: false,
            guest_ready: false,
        };
        Lobby { link: session.link, is_host: false, state, chat: Vec::new(), closed: false, started: None }
    }

    pub fn my_name(&self) -> &str {
        if self.is_host { &self.state.host_name } else { &self.state.guest_name }
    }

    pub fn peer_name(&self) -> &str {
        if self.is_host { &self.state.guest_name } else { &self.state.host_name }
    }

    pub fn my_faction(&self) -> i32 {
        if self.is_host { self.state.host_faction } else { self.state.guest_faction }
    }

    pub fn peer_faction(&self) -> i32 {
        if self.is_host { self.state.guest_faction } else { self.state.host_faction }
    }

    pub fn my_ready(&self) -> bool {
        if self.is_host { self.state.host_ready } else { self.state.guest_ready }
    }

    pub fn peer_ready(&self) -> bool {
        if self.is_host { self.state.guest_ready } else { self.state.host_ready }
    }

    fn broadcast(&mut self) {
        if self.is_host && self.link.send(&Msg::Lobby(self.state.clone())).is_err() {
            self.closed = true;
        }
    }

    /// Handle everything that arrived. Returns true when the lobby state changed.
    pub fn poll(&mut self) -> bool {
        let mut changed = false;
        while let Some(m) = self.link.recv() {
            match m {
                Msg::Lobby(s) if !self.is_host => {
                    self.state = s;
                    changed = true;
                }
                Msg::LobbyPick { faction } if self.is_host => {
                    // Both players must play different factions.
                    if faction != self.state.host_faction && crate::factions_ok(faction) {
                        self.state.guest_faction = faction;
                        self.state.host_ready = false;
                        self.state.guest_ready = false;
                    }
                    self.broadcast();
                    changed = true;
                }
                Msg::LobbyReady { ready } if self.is_host => {
                    self.state.guest_ready = ready;
                    self.broadcast();
                    self.try_start();
                    changed = true;
                }
                Msg::Chat { text } => {
                    self.chat.push(ChatLine { mine: false, text });
                    changed = true;
                }
                Msg::Start { config } if !self.is_host => {
                    self.started = Some(config);
                    changed = true;
                }
                Msg::Bye | Msg::Closed => {
                    self.closed = true;
                    changed = true;
                }
                _ => {}
            }
        }
        changed
    }

    /// Host: replace the game settings (clears both ready flags).
    pub fn set_config(&mut self, config: serde_json::Value) {
        if self.is_host && self.state.config != config {
            self.state.config = config;
            self.state.host_ready = false;
            self.state.guest_ready = false;
            self.broadcast();
        }
    }

    /// Choose my faction. Refused (false) when the other player already holds it.
    pub fn pick(&mut self, faction: i32) -> bool {
        if faction == self.peer_faction() || !crate::factions_ok(faction) {
            return false;
        }
        if faction == self.my_faction() {
            return true;
        }
        if self.is_host {
            self.state.host_faction = faction;
            self.state.host_ready = false;
            self.state.guest_ready = false;
            self.broadcast();
        } else {
            // The host confirms by sending the new lobby state back.
            self.state.guest_faction = faction;
            self.state.guest_ready = false;
            if self.link.send(&Msg::LobbyPick { faction }).is_err() {
                self.closed = true;
            }
        }
        true
    }

    pub fn set_ready(&mut self, ready: bool) {
        if self.is_host {
            self.state.host_ready = ready;
            self.broadcast();
            self.try_start();
        } else {
            self.state.guest_ready = ready;
            if self.link.send(&Msg::LobbyReady { ready }).is_err() {
                self.closed = true;
            }
        }
    }

    /// Host: start once both are ready. Called after any ready change.
    pub fn try_start(&mut self) {
        if !self.is_host || self.started.is_some() || !(self.state.host_ready && self.state.guest_ready) {
            return;
        }
        let mut cfg = self.state.config.clone();
        cfg["factions"] = serde_json::json!([self.state.host_faction, self.state.guest_faction]);
        if self.link.send(&Msg::Start { config: cfg.clone() }).is_err() {
            self.closed = true;
            return;
        }
        self.started = Some(cfg);
    }

    pub fn say(&mut self, text: String) {
        let text = text.trim().to_string();
        if text.is_empty() {
            return;
        }
        if self.link.send(&Msg::Chat { text: text.clone() }).is_err() {
            self.closed = true;
        }
        self.chat.push(ChatLine { mine: true, text });
    }

    pub fn leave(&mut self) {
        let _ = self.link.send(&Msg::Bye);
    }

    /// Hand the connection to the match loader.
    pub fn into_session(self, config: serde_json::Value) -> Session {
        let team = if self.is_host { 0 } else { 1 };
        let peer = self.peer_name().to_string();
        Session { link: self.link, team, config, peer_name: peer }
    }
}
