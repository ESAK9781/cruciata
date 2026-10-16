//! Chapter-specific preparation (`prepareCampaign`).

use crate::build::Plot;
use crate::data::data;
use crate::js::{cos, round, sin};
use crate::model::*;
use crate::nav::Pt;
use crate::sim::Sim;
use crate::world::*;

impl Sim {
    pub fn prepare_campaign(&mut self) {
        let d = data();
        let l = d.levels[self.state.level].clone();
        let (w, _h) = (self.geo.w, self.geo.h);
        let camp = 0usize;
        let level = self.state.level;
        if l.kind == "survival" {
            let fighters: Vec<usize> = self.fighters(0);
            for u in fighters {
                self.state.units[u].castle_guard = Some(true);
            }
            {
                let c = &mut self.state.buildings[camp];
                c.w = 240.0;
                c.h = 210.0;
                c.r = 160.0;
                c.hp = 6500.0;
                c.max_hp = 6500.0;
                c.castle = Some(true);
            }
            let n = self.state.buildings.len();
            for bi in 0..n {
                if bi != camp && self.state.buildings[bi].team == 0 {
                    self.place_clear(bi, 8.0);
                }
            }
            let (cid, cx, cy) = (self.state.buildings[camp].id, self.state.buildings[camp].x, self.state.buildings[camp].y);
            let plots: Vec<Plot> = self.defensive_plots(cid, cx, cy, self.state.buildings[camp].fortress_shape.clone().as_ref(), 720.0);
            for p in &plots {
                let mut b = self.make_from_plot(p, 0, 1.0);
                b.closed = Some(false);
                b.defence = Some(true);
                self.state.buildings.push(b);
            }
            for i in 0..12 {
                let angle = i as f64 * 2.399;
                let r = 230.0 + (i as f64 / 6.0).floor() * 100.0;
                let kind = if i < 8 {
                    BKind::House
                } else if i == 8 {
                    BKind::Watchtower
                } else if i == 9 {
                    BKind::Stable
                } else if i == 10 {
                    BKind::Siegeworkshop
                } else {
                    BKind::Barracks
                };
                let b = self.make_building(kind, 0, cx + cos(angle) * r, cy + sin(angle) * r, 1.0);
                self.state.buildings.push(b);
                let bi = self.state.buildings.len() - 1;
                self.place_clear(bi, 8.0);
            }
            for i in 0..36 {
                let angle = i as f64 * 2.399;
                let r = 280.0 + (i % 3) as f64 * 90.0;
                let ty = if i % 7 == 0 {
                    UType::Knight
                } else if i % 3 == 0 {
                    UType::Archer
                } else if i == 35 {
                    UType::Standard
                } else {
                    UType::Sword
                };
                let (px, py) = (cx + cos(angle) * r, cy + sin(angle) * r);
                let mut u = self.make_unit(ty, 0, px, py);
                u.castle_guard = Some(true);
                u.home = Some(Pt::new(px, py));
                self.state.units.push(u);
            }
            self.rebuild_navigation();
        }
        if l.kind == "escort" {
            let rx = river_x(&self.state, w, 1150.0);
            let route: Vec<Pt> = vec![
                Pt::new(1100.0, 1420.0),
                Pt::new(rx - 130.0, 1150.0),
                Pt::new(rx + 210.0, 1150.0),
                Pt::new(3200.0, 1800.0),
                Pt::new(5900.0, 3900.0),
                Pt::new(6900.0, 4100.0),
                Pt::new(9000.0, 2800.0),
                Pt::new(11200.0, 1600.0),
            ];
            let pil: Vec<usize> = (0..self.state.units.len()).filter(|&i| self.state.units[i].ty == UType::Pilgrim).collect();
            for u in pil {
                let r: Vec<Pt> = route.iter().map(|&p| self.find_free(p)).collect();
                let un = &mut self.state.units[u];
                un.route = Some(r);
                un.route_index = Some(0);
                un.hp = 300.0;
                un.max_hp = 300.0;
            }
            if let Some(refuge) = self.state.sites.iter_mut().find(|p| p.name == "Pilgrim refuge") {
                let last = *route.last().unwrap();
                refuge.x = last.x;
                refuge.y = last.y;
            }
            self.state.campaign_rules.as_mut().unwrap().route = Some(route);
        }
        if l.kind == "liberation" || l.kind == "occupation" {
            let ids: Vec<u32> = self.state.sites.iter().filter(|p| p.optional != Some(true) && p.name != "Pilgrim refuge").map(|s| s.id).collect();
            for (i, sid) in ids.iter().enumerate() {
                let goal = Pt::new(if i > 0 { 9400.0 } else { 5600.0 }, if i > 0 { 4900.0 } else { 3300.0 });
                let si = self.state.sites.iter().position(|s| s.id == *sid).unwrap();
                let dx = goal.x - self.state.sites[si].x;
                let dy = goal.y - self.state.sites[si].y;
                self.state.sites[si].x = goal.x;
                self.state.sites[si].y = goal.y;
                for b in self.state.buildings.iter_mut() {
                    if b.site == Some(*sid) {
                        b.x += dx;
                        b.y += dy;
                    }
                }
                for u in self.state.units.iter_mut() {
                    if u.site == Some(*sid) {
                        u.x += dx;
                        u.y += dy;
                        if let Some(h) = u.home.as_mut() {
                            h.x += dx;
                            h.y += dy;
                        }
                    }
                }
            }
            if l.kind == "liberation" {
                let rx = river_x(&self.state, w, 1150.0);
                let (cx, cy) = (self.state.buildings[camp].x, self.state.buildings[camp].y);
                for i in 0..3 {
                    let mut u = self.make_unit(UType::Merchant, 0, cx + 250.0 + i as f64 * 50.0, cy + 180.0);
                    u.route = Some(vec![Pt::new(1100.0, 1420.0), Pt::new(rx + 240.0, 1150.0), Pt::new(5600.0, 3300.0), Pt::new(9400.0, 4900.0)]);
                    u.route_index = Some(0);
                    u.mission_supply = Some(true);
                    self.state.units.push(u);
                }
            }
        }
        if l.kind == "siege" {
            for b in self.state.buildings.iter_mut() {
                if b.gate == Some(true) {
                    b.hp = 16000.0;
                    b.max_hp = 16000.0;
                }
            }
        }
        let (cx, cy) = (self.state.buildings[camp].x, self.state.buildings[camp].y);
        let rx = river_x(&self.state, w, 1150.0);
        let mut anchors: Vec<Pt> = match l.kind {
            "escort" => vec![Pt::new(rx + 340.0, 1370.0), Pt::new(4900.0, 3700.0), Pt::new(8650.0, 3000.0), Pt::new(10500.0, 1950.0)],
            "survival" => (0..6).map(|i| Pt::new(cx + cos((i as f64 * std::f64::consts::PI) / 3.0) * 1150.0, cy + sin((i as f64 * std::f64::consts::PI) / 3.0) * 1150.0)).collect(),
            "settlement" => vec![Pt::new(self.state.buildings[1].x + 300.0, self.state.buildings[1].y + 350.0)],
            _ => vec![Pt::new(5950.0, 3500.0), Pt::new(9750.0, 5100.0), Pt::new(cx + 950.0, cy + 650.0)],
        };
        if level >= 3 {
            anchors.push(Pt::new(7800.0, 4000.0));
            if level >= 4 {
                anchors.push(Pt::new(9000.0, 2200.0));
            }
            if level >= 5 {
                anchors.push(Pt::new(9300.0, 6600.0));
            }
        }
        let strength = self.state.campaign_rules.as_ref().unwrap().strength;
        for (j, raw) in anchors.iter().enumerate() {
            let mut p = self.find_free(*raw);
            for i in 0..48 {
                let a = i as f64 * 2.399;
                let r = (i as f64 / 8.0).floor() * 70.0;
                let q = Pt::new(raw.x + cos(a) * r, raw.y + sin(a) * r);
                if [-55.0, 0.0, 55.0].iter().all(|dx| [-50.0, 0.0, 50.0].iter().all(|dy| self.ground_free(q.x + dx, q.y + dy, 10.0))) {
                    p = q;
                    break;
                }
            }
            let mut post = self.make_building(BKind::Barracks, 1, p.x, p.y, 1.0);
            post.campaign_post = Some(serde_json::json!(true));
            post.hp = 2200.0;
            post.max_hp = 2200.0;
            let post_id = post.id;
            self.state.buildings.push(post);
            for sign in [-1.0, 1.0] {
                let q = self.find_free(Pt::new(p.x + sign * 160.0, p.y - 120.0));
                let mut t = self.make_building(BKind::Tower, 1, q.x, q.y, 1.0);
                t.campaign_post = Some(serde_json::json!(post_id));
                t.hp = 1800.0;
                t.max_hp = 1800.0;
                self.state.buildings.push(t);
            }
            let goal: Pt = match l.kind {
                "escort" => {
                    let route = self.state.campaign_rules.as_ref().unwrap().route.clone().unwrap();
                    route[(route.len() - 2).min(2 + j * 2)]
                }
                "survival" => Pt::new(cx, cy),
                "settlement" => Pt::new(self.state.buildings[1].x, self.state.buildings[1].y),
                _ => Pt::new(p.x - 350.0, p.y - 200.0),
            };
            self.state.campaign_rules.as_mut().unwrap().posts.push(Post { id: post_id, x: p.x, y: p.y, goal });
            let count = round((8.0 + level as f64 * 2.0) * strength) as i32;
            for i in 0..count {
                let ty = if i == count - 1 && level >= 2 {
                    UType::Trebuchet
                } else if i == count - 2 && level >= 2 {
                    UType::Ram
                } else if i % 4 == 0 {
                    UType::Archer
                } else if i % 7 == 0 {
                    UType::Knight
                } else {
                    UType::Sword
                };
                let q = self.find_free(Pt::new(p.x - 150.0 + (i % 5) as f64 * 35.0, p.y + 130.0 + (i as f64 / 5.0).floor() * 35.0));
                let mut u = self.make_unit(ty, 1, q.x, q.y);
                u.campaign_post = Some(post_id);
                u.garrison_base = Some(post_id);
                u.home = Some(q);
                u.stance = "fight".into();
                self.state.units.push(u);
            }
            if level >= 2 {
                let idx: Vec<usize> = (0..self.state.units.len()).filter(|&i| self.state.units[i].campaign_post == Some(post_id) && matches!(self.state.units[i].ty, UType::Trebuchet | UType::Ram)).collect();
                for ui in idx {
                    let r = if self.state.units[ui].ty == UType::Trebuchet { 2.0 } else { 2f64.min((level as f64 / 2.0).floor()) };
                    self.apply_rank(ui, r);
                }
            }
            if level >= 3 {
                let idx: Vec<usize> = (0..self.state.units.len()).filter(|&i| self.state.units[i].campaign_post == Some(post_id) && !matches!(self.state.units[i].ty, UType::Trebuchet | UType::Ram)).collect();
                for ui in idx {
                    self.apply_rank(ui, 2f64.min((level as f64 / 2.0).floor()));
                }
            }
            self.rebuild_navigation();
        }
        self.state.wave_timer = self.state.campaign_rules.as_ref().unwrap().grace;
    }
}
