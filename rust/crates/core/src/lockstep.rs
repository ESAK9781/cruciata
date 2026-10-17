//! Deterministic lockstep support: the serialisable command set and a state
//! hash for desync detection.

use crate::commands::Command;
use crate::model::BKind;
use crate::orders::OrderCmd;
use crate::sim::{Event, Sim};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum PlayerCommand {
    Game(Command),
    Order(OrderCmd),
    Stance { units: Vec<u32>, structures: Vec<u32>, value: String },
    Hold { units: Vec<u32> },
    Bless { units: Vec<u32> },
    Deploy { units: Vec<u32> },
    CancelSiege { units: Vec<u32>, structures: Vec<u32> },
    CancelBuild { id: u32 },
    Rally { id: u32, x: f64, y: f64 },
}

impl Sim {
    /// Execute a command on behalf of `team`. Messages and sounds produced by
    /// someone else's commands are dropped so only your own appear locally.
    pub fn run_command(&mut self, team: i32, local: i32, cmd: &PlayerCommand) {
        let mark = self.events.len();
        match cmd {
            PlayerCommand::Game(c) => {
                self.apply(team, c);
            }
            PlayerCommand::Order(o) => self.issue_order(team, o),
            PlayerCommand::Stance { units, structures, value } => self.set_stance(team, units, structures, value),
            PlayerCommand::Hold { units } => self.hold_units(team, units),
            PlayerCommand::Bless { units } => {
                self.bless(team, units);
            }
            PlayerCommand::Deploy { units } => self.toggle_deployment(team, units),
            PlayerCommand::CancelSiege { units, structures } => self.cancel_siege_targeting(team, units, structures),
            PlayerCommand::CancelBuild { id } => {
                self.cancel_structure(team, *id);
            }
            PlayerCommand::Rally { id, x, y } => {
                let p = self.find_free(crate::nav::Pt::new(*x, *y));
                if let Some(b) = self.state.buildings.iter_mut().find(|b| b.id == *id && b.team == team && b.hp > 0.0) {
                    b.rally = Some(p);
                }
            }
        }
        if team != local {
            let mut i = mark;
            while i < self.events.len() {
                if matches!(self.events[i], Event::Toast(_) | Event::Sound { .. }) {
                    self.events.remove(i);
                } else {
                    i += 1;
                }
            }
        }
    }

    /// FNV-1a over the state that matters for gameplay; equal on both peers
    /// exactly when their simulations agree.
    pub fn state_hash(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut feed = |v: u64| {
            for k in 0..8 {
                h ^= (v >> (k * 8)) & 0xff;
                h = h.wrapping_mul(0x100000001b3);
            }
        };
        feed(self.state.time.to_bits());
        feed(self.rng.0 as u32 as u64);
        feed(self.uid as u64);
        for r in [&self.state.resources, &self.state.enemy.resources] {
            feed(r.food.to_bits());
            feed(r.wood.to_bits());
            feed(r.stone.to_bits());
            feed(r.gold.to_bits());
        }
        for u in &self.state.units {
            feed(u.id as u64);
            feed(u.x.to_bits());
            feed(u.y.to_bits());
            feed(u.hp.to_bits());
        }
        for b in &self.state.buildings {
            feed(b.id as u64);
            feed(b.hp.to_bits());
            feed(b.progress.to_bits());
            feed(b.queue.len() as u64);
        }
        h
    }
}
