//! Stockpiles, population and entity filters (`stock`, `afford`, `pay`,
//! `population`, `fighters`, `workers`, `completeBuildings`).

use crate::data::data;
use crate::model::*;
use crate::sim::Sim;

pub struct Population {
    pub used: f64,
    pub queued: f64,
    pub cap: f64,
}

impl Sim {
    pub fn stock(&self, team: i32) -> &Resources {
        if team == 0 {
            &self.state.resources
        } else {
            &self.state.enemy.resources
        }
    }

    pub fn stock_mut(&mut self, team: i32) -> &mut Resources {
        if team == 0 {
            &mut self.state.resources
        } else {
            &mut self.state.enemy.resources
        }
    }

    pub fn afford(&self, cost: &Cost, team: i32) -> bool {
        let s = self.stock(team);
        cost.0.iter().all(|(r, n)| s.get(*r) >= *n)
    }

    pub fn afford_opt(&self, cost: &Option<Cost>, team: i32) -> bool {
        match cost {
            Some(c) => self.afford(c, team),
            None => true,
        }
    }

    pub fn pay(&mut self, cost: &Cost, mult: f64, team: i32) {
        for (r, n) in &cost.0 {
            *self.stock_mut(team).get_mut(*r) -= n * mult;
            if team == 1 {
                *self.state.enemy.paid.get_mut(*r) += n * mult;
            }
        }
    }

    pub fn fighters(&self, team: i32) -> Vec<usize> {
        self.state
            .units
            .iter()
            .enumerate()
            .filter(|(_, u)| u.team == team && u.hp > 0.0 && !matches!(u.ty, UType::Worker | UType::Civilian | UType::Pilgrim | UType::Merchant))
            .map(|(i, _)| i)
            .collect()
    }

    pub fn workers(&self, team: i32) -> Vec<usize> {
        self.state.units.iter().enumerate().filter(|(_, u)| u.team == team && u.ty == UType::Worker && u.hp > 0.0).map(|(i, _)| i).collect()
    }

    pub fn complete_buildings(&self, kind: Option<BKind>, team: i32) -> Vec<usize> {
        self.state
            .buildings
            .iter()
            .enumerate()
            .filter(|(_, b)| b.team == team && b.hp > 0.0 && b.progress >= 1.0 && kind.map(|k| b.kind == k).unwrap_or(true))
            .map(|(i, _)| i)
            .collect()
    }

    pub fn population(&self, team: i32) -> Population {
        let total = self.state.units.iter().filter(|u| u.team == team && u.hp > 0.0 && !matches!(u.ty, UType::Pilgrim | UType::Merchant)).count();
        let done = self.complete_buildings(None, team);
        let queued: usize = done.iter().map(|&i| self.state.buildings[i].queue.iter().filter(|q| q.kind == "unit").count()).sum();
        let cap: f64 = done.iter().map(|&i| data().bld(self.state.buildings[i].kind).pop).sum();
        Population { used: total as f64, queued: queued as f64, cap: cap.min(520.0) }
    }

    pub fn is_capital(&self, bi: usize) -> bool {
        let b = &self.state.buildings[bi];
        let player = self.state.capitals.player.filter(|&p| p != 0).or(self.state.buildings.first().map(|b| b.id));
        let enemy = self
            .state
            .capitals
            .enemy
            .filter(|&p| p != 0)
            .or_else(|| self.state.buildings.iter().find(|c| c.team == 1 && c.kind == BKind::Towncenter).map(|c| c.id));
        Some(b.id) == player
            || Some(b.id) == enemy
            || (self.state.mode != "quickmatch" && b.outpost != Some(true) && Some(b.id) == self.state.buildings.get(1).map(|c| c.id))
    }

    pub fn observer_sees(&self, team: i32, x: f64, y: f64) -> bool {
        match team {
            3 => self.militia_fog.sees(x, y),
            0 => self.fog.sees(x, y),
            _ => self.enemy_fog.sees(x, y),
        }
    }
}
