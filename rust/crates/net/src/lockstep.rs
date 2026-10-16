//! Deterministic lockstep. Every `TURN_STEPS` simulation steps form a turn;
//! commands issued now run `DELAY` turns later on both machines, so the
//! network always has a few frames of slack and nothing ever rolls back.

use crate::link::Link;
use crate::protocol::Msg;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::sim::{Sim, STEP};
use std::collections::BTreeMap;

pub const TURN_STEPS: u32 = 2;
pub const DELAY: u32 = 2;
const TURN_DT: f64 = STEP * TURN_STEPS as f64;
const HASH_EVERY: u32 = 15;

pub struct Lockstep {
    pub team: i32,
    link: Box<dyn Link>,
    turn: u32,
    sent_next: u32,
    pending: Vec<PlayerCommand>,
    mine: BTreeMap<u32, Vec<PlayerCommand>>,
    theirs: BTreeMap<u32, Vec<PlayerCommand>>,
    my_hashes: BTreeMap<u32, u64>,
    their_hashes: BTreeMap<u32, u64>,
    acc: f64,
    pub desync: Option<u32>,
    pub disconnected: bool,
    pub stalled: bool,
    pub chat: Vec<String>,
}

impl Lockstep {
    pub fn new(team: i32, link: Box<dyn Link>) -> Lockstep {
        let mut mine = BTreeMap::new();
        let mut theirs = BTreeMap::new();
        for t in 0..DELAY {
            mine.insert(t, Vec::new());
            theirs.insert(t, Vec::new());
        }
        Lockstep {
            team,
            link,
            turn: 0,
            sent_next: DELAY,
            pending: Vec::new(),
            mine,
            theirs,
            my_hashes: BTreeMap::new(),
            their_hashes: BTreeMap::new(),
            acc: 0.0,
            desync: None,
            disconnected: false,
            stalled: false,
            chat: Vec::new(),
        }
    }

    pub fn turn(&self) -> u32 {
        self.turn
    }

    /// Queue a command; it runs on both machines a few turns from now.
    pub fn issue(&mut self, c: PlayerCommand) {
        self.pending.push(c);
    }

    pub fn send_chat(&mut self, text: String) {
        let _ = self.link.send(&Msg::Chat { text });
    }

    pub fn leave(&mut self) {
        let _ = self.link.send(&Msg::Bye);
    }

    fn pump_link(&mut self) {
        while let Some(m) = self.link.recv() {
            match m {
                Msg::Turn { turn, cmds } => {
                    self.theirs.insert(turn, cmds);
                }
                Msg::Hash { turn, hash } => {
                    self.their_hashes.insert(turn, hash);
                    self.compare(turn);
                }
                Msg::Chat { text } => self.chat.push(text),
                Msg::Bye | Msg::Closed => self.disconnected = true,
                _ => {}
            }
        }
    }

    fn compare(&mut self, turn: u32) {
        if let (Some(a), Some(b)) = (self.my_hashes.get(&turn), self.their_hashes.get(&turn)) {
            if a != b && self.desync.is_none() {
                self.desync = Some(turn);
            }
        }
    }

    fn fill_sends(&mut self) {
        while self.sent_next <= self.turn + DELAY {
            let cmds = std::mem::take(&mut self.pending);
            if self.link.send(&Msg::Turn { turn: self.sent_next, cmds: cmds.clone() }).is_err() {
                self.disconnected = true;
            }
            self.mine.insert(self.sent_next, cmds);
            self.sent_next += 1;
        }
    }

    /// Advance by `dt` real seconds. Returns the number of simulation steps run.
    pub fn advance(&mut self, sim: &mut Sim, dt: f64) -> u32 {
        if self.disconnected {
            return 0;
        }
        self.acc = (self.acc + dt).min(TURN_DT * 12.0);
        let mut steps = 0;
        loop {
            self.pump_link();
            self.fill_sends();
            if self.acc < TURN_DT {
                self.stalled = false;
                break;
            }
            let (Some(m), Some(t)) = (self.mine.get(&self.turn), self.theirs.get(&self.turn)) else {
                self.stalled = true;
                break;
            };
            let (m, t) = (m.clone(), t.clone());
            let (c0, c1) = if self.team == 0 { (m, t) } else { (t, m) };
            for c in &c0 {
                sim.run_command(0, self.team, c);
            }
            for c in &c1 {
                sim.run_command(1, self.team, c);
            }
            for _ in 0..TURN_STEPS {
                sim.update(STEP);
                steps += 1;
            }
            self.mine.remove(&self.turn);
            self.theirs.remove(&self.turn);
            if self.turn % HASH_EVERY == 0 {
                let h = sim.state_hash();
                self.my_hashes.insert(self.turn, h);
                if self.link.send(&Msg::Hash { turn: self.turn, hash: h }).is_err() {
                    self.disconnected = true;
                }
                self.compare(self.turn);
                let keep = self.turn.saturating_sub(HASH_EVERY * 8);
                self.my_hashes.retain(|&k, _| k >= keep);
                self.their_hashes.retain(|&k, _| k >= keep);
            }
            self.turn += 1;
            self.acc -= TURN_DT;
        }
        steps
    }
}
