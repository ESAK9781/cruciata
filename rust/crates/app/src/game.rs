//! One running match: the simulation, which side the local player controls,
//! and (for LAN games) the lockstep link to the other player.

use cruciata_core::fog::Fog;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::sim::{Event, Sim, STEP};
use cruciata_net::lockstep::Lockstep;

pub struct Game {
    pub sim: Sim,
    /// Team the local player commands (0 or 1).
    pub me: i32,
    pub lock: Option<Lockstep>,
    pub peer_name: Option<String>,
    acc: f64,
    pub events: Vec<Event>,
    /// Chat lines received (LAN).
    pub chat: Vec<String>,
    pub left: bool,
}

impl Game {
    pub fn solo(sim: Sim) -> Game {
        Game { sim, me: 0, lock: None, peer_name: None, acc: 0.0, events: Vec::new(), chat: Vec::new(), left: false }
    }

    pub fn lan(mut sim: Sim, lock: Lockstep, peer: String) -> Game {
        sim.settings.pvp = true;
        sim.state.paused = false;
        let me = lock.team;
        Game { sim, me, lock: Some(lock), peer_name: Some(peer), acc: 0.0, events: Vec::new(), chat: Vec::new(), left: false }
    }

    pub fn is_lan(&self) -> bool {
        self.lock.is_some()
    }

    /// Route a command: immediately in solo play, through lockstep on a LAN.
    pub fn issue(&mut self, c: PlayerCommand) {
        if let Some(ls) = self.lock.as_mut() {
            ls.issue(c);
        } else {
            let me = self.me;
            self.sim.run_command(me, me, &c);
        }
    }

    pub fn advance(&mut self, dt: f64) {
        if let Some(ls) = self.lock.as_mut() {
            ls.advance(&mut self.sim, dt);
            self.chat.append(&mut ls.chat);
        } else if !self.sim.state.paused {
            self.acc = (self.acc + dt).min(0.25);
            while self.acc >= STEP {
                self.sim.update(STEP);
                self.acc -= STEP;
            }
        }
        self.events.append(&mut self.sim.events);
    }

    pub fn paused(&self) -> bool {
        self.lock.is_none() && self.sim.state.paused
    }

    pub fn stock(&self) -> &Resources {
        self.sim.stock(self.me)
    }

    pub fn faith(&self) -> f64 {
        if self.me == 0 { self.sim.state.faith } else { self.sim.state.enemy.faith }
    }

    pub fn fog(&self) -> &Fog {
        if self.me == 0 { &self.sim.fog } else { &self.sim.enemy_fog }
    }

    pub fn sees(&self, x: f64, y: f64) -> bool {
        self.fog().sees(x, y)
    }

    pub fn remembers(&self, x: f64, y: f64) -> bool {
        self.fog().remembers(x, y)
    }

    pub fn has_tech(&self, key: &str) -> bool {
        self.sim.has_tech(key, self.me)
    }

    pub fn rank_for(&self, ty: UType) -> f64 {
        self.sim.rank_for(ty, self.me)
    }

    /// Did the local player win? (`result` is relative to team 0.)
    pub fn outcome(&self) -> Option<bool> {
        self.sim.state.result.as_ref().map(|r| (r == "won") == (self.me == 0))
    }

    pub fn my_units(&self) -> Vec<usize> {
        (0..self.sim.state.units.len()).filter(|&i| self.sim.state.units[i].team == self.me && self.sim.state.units[i].hp > 0.0).collect()
    }

    pub fn my_fighters(&self) -> Vec<usize> {
        self.sim.fighters(self.me)
    }

    pub fn my_workers(&self) -> Vec<usize> {
        self.my_units().into_iter().filter(|&i| self.sim.state.units[i].ty == UType::Worker).collect()
    }
}
