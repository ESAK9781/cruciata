//! `moveUnit`, `marchUnit`, rally positions and formation upkeep.

use crate::data::data;
use crate::js::{atan2, clamp, cos, hypot, sin};
use crate::model::*;
use crate::movement::{dist, is_heavy};
use crate::nav::Pt;
use crate::sim::Sim;

fn sign(v: f64) -> f64 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v
    }
}

impl Sim {
    pub fn formation_index(&self, id: u32) -> Option<usize> {
        self.state.formations.iter().position(|f| f.id == id)
    }

    pub fn rally_position(&mut self, ui: usize, origin: Pt) -> Pt {
        let (uid, team) = (self.state.units[ui].id, self.state.units[ui].team);
        let occupied: Vec<(Pt, Option<Pt>)> = self
            .state
            .units
            .iter()
            .filter(|v| v.id != uid && v.hp > 0.0 && v.team == team)
            .map(|v| (Pt::new(v.x, v.y), v.order.as_ref().map(|o| Pt::new(o.x, o.y))))
            .collect();
        let available = |sim: &Sim, p: Pt| -> bool {
            sim.ground_free(p.x, p.y, 6.0) && !occupied.iter().any(|(pos, ord)| dist(*pos, p) < 32.0 || ord.map(|o| dist(o, p) < 32.0).unwrap_or(false))
        };
        if available(self, origin) {
            return origin;
        }
        let mut radius = 40.0;
        while radius <= 640.0 {
            let count = ((2.0 * std::f64::consts::PI * radius) / 40.0).ceil() as i32;
            for i in 0..count {
                let angle = (i as f64 * 2.0 * std::f64::consts::PI) / count as f64;
                let p = Pt::new(origin.x + cos(angle) * radius, origin.y + sin(angle) * radius);
                if available(self, p) && self.route_possible(ui, p) {
                    return p;
                }
            }
            radius += 40.0;
        }
        self.march_point(origin)
    }

    pub fn march_unit(&mut self, ui: usize, dt: f64) {
        // Join a rally crowd without stacking on an occupied rally slot.
        let reroute = {
            let u = &self.state.units[ui];
            match &u.order {
                Some(o) if o.rally.is_some() && dist(Pt::new(u.x, u.y), Pt::new(o.x, o.y)) < 90.0 => {
                    let target = Pt::new(o.x, o.y);
                    self.state.units.iter().any(|v| v.id != u.id && v.hp > 0.0 && v.team == u.team && !v.moving && dist(Pt::new(v.x, v.y), target) < 32.0)
                }
                _ => false,
            }
        };
        if reroute {
            let rally = self.state.units[ui].order.as_ref().unwrap().rally.unwrap();
            let goal = self.rally_position(ui, rally);
            let u = &mut self.state.units[ui];
            if let Some(o) = u.order.as_mut() {
                o.x = goal.x;
                o.y = goal.y;
            }
            u.path_timer = 0.0;
        }
        if let Some(o) = self.state.units[ui].order.clone() {
            if self.move_unit(ui, Pt::new(o.x, o.y), dt, 6.0) {
                if let Some(fid) = o.formation {
                    if let Some(fi) = self.formation_index(fid) {
                        if let Some(esc) = self.state.formations[fi].escort_id {
                            if self.get_object(esc).is_some() {
                                return;
                            }
                        }
                    }
                }
                let u = &mut self.state.units[ui];
                u.order = None;
                u.hold = false;
                u.march_goal = None;
            }
        }
    }

    pub fn move_unit(&mut self, ui: usize, destination: Pt, dt: f64, stop: f64) -> bool {
        let (w, h) = (self.geo.w, self.geo.h);
        {
            let (ux, uy) = (self.state.units[ui].x, self.state.units[ui].y);
            if !self.ground_free(ux, uy, 6.0) {
                let exit = self.find_free(Pt::new(ux, uy));
                let u = &mut self.state.units[ui];
                u.x = exit.x;
                u.y = exit.y;
                u.path.clear();
                u.path_goal = None;
                u.path_request = None;
            }
        }
        let p = Pt::new(clamp(destination.x, 25.0, w - 25.0), clamp(destination.y, 25.0, h - 25.0));
        let upos = self.unit_pt(ui);
        let dist_to_goal = dist(upos, p);
        if dist_to_goal < stop {
            let u = &mut self.state.units[ui];
            u.moving = false;
            u.vx = Some(0.0);
            u.vy = Some(0.0);
            return true;
        }
        // A swarm fills in from its shared point outward.
        let swarm_arrive = self.state.units[ui].order.as_ref().and_then(|o| if o.swarm == Some(true) { o.arrive } else { None });
        if let Some(arrive) = swarm_arrive {
            if dist_to_goal < arrive * 2.6 {
                let (uid, team) = (self.state.units[ui].id, self.state.units[ui].team);
                let blocked = self.nearby(ui, 28.0).into_iter().any(|oi| {
                    let o = &self.state.units[oi];
                    o.id != uid && o.team == team && o.hp > 0.0 && !o.moving && o.order.is_none() && dist(Pt::new(o.x, o.y), p) < dist_to_goal
                });
                if blocked {
                    let u = &mut self.state.units[ui];
                    u.moving = false;
                    u.vx = Some(0.0);
                    u.vy = Some(0.0);
                    return true;
                }
            }
        }
        // Stall watchdog.
        let now = self.state.time;
        let progress = self.state.units[ui].progress.clone();
        match progress {
            Some(pr) if now - pr.last <= 0.5 => {
                let upos = self.unit_pt(ui);
                let moved = dist(Pt::new(pr.x, pr.y), upos);
                let swarm_reach = self.state.units[ui].order.as_ref().and_then(|o| o.arrive).unwrap_or(0.0);
                let u = &mut self.state.units[ui];
                let prm = u.progress.as_mut().unwrap();
                prm.last = now;
                if moved > 14.0 {
                    prm.x = upos.x;
                    prm.y = upos.y;
                    prm.t = now;
                    prm.stalled = 0.0;
                } else if now - prm.t > 2.5 {
                    prm.t = now;
                    prm.stalled += 2.5;
                    let stalled = prm.stalled;
                    if dist_to_goal < 40f64.max(swarm_reach) || (stalled >= 7.5 && dist_to_goal < 150f64.max(swarm_reach * 3.0)) {
                        u.moving = false;
                        u.vx = Some(0.0);
                        u.vy = Some(0.0);
                        u.progress = None;
                        return true;
                    }
                    u.path.clear();
                    u.path_goal = None;
                    u.path_request = None;
                    u.shared_route_revision = None;
                    u.arrival_avoid_side = None;
                    u.stuck = 0.0;
                    // Wedged between footprints: step out to roomier ground.
                    let wedged = if !u.moving {
                        true
                    } else {
                        let s = u.stalls.unwrap_or(0.0) + 1.0;
                        u.stalls = Some(s);
                        s >= 2.0
                    };
                    if wedged {
                        if let Some(out) = self.roomy_ground(ui) {
                            let u = &mut self.state.units[ui];
                            u.x = out.x;
                            u.y = out.y;
                            u.stalls = Some(0.0);
                        }
                    }
                }
            }
            _ => {
                let (x, y) = (self.state.units[ui].x, self.state.units[ui].y);
                self.state.units[ui].progress = Some(Progress { x, y, t: now, last: now, stalled: 0.0 });
            }
        }

        let ty = self.state.units[ui].ty;
        let unit_r = if is_heavy(ty) { 26.0 } else { 14.0 };
        let reach_dist = 20f64.max(unit_r * 1.15);

        let mut waiting_for_route = false;
        let order_formation = self.state.units[ui].order.as_ref().and_then(|o| o.formation);
        let company_idx = order_formation.and_then(|f| self.formation_index(f));
        let mut shared = false;
        if let Some(ci) = company_idx {
            let c = &self.state.formations[ci];
            let o = self.state.units[ui].order.as_ref().unwrap();
            shared = c.shared_route == Some(true) && c.escort_id.is_none() && dist(destination, Pt::new(o.x, o.y)) < 1.0;
        }
        if shared && dist_to_goal >= 220.0 {
            let ci = company_idx.unwrap();
            let (route_ready, path_empty) = {
                let c = &self.state.formations[ci];
                (c.route_ready == Some(true), c.path.is_empty())
            };
            if !route_ready || path_empty {
                if !self.provisional_path(ui, p) {
                    self.state.units[ui].moving = false;
                    return false;
                }
                waiting_for_route = true;
            } else {
                let revision = self.state.formations[ci].revision;
                let need = {
                    let u = &self.state.units[ui];
                    u.shared_route_revision != Some(revision) || u.path.is_empty() || u.path_goal.is_none() || dist(u.path_goal.unwrap(), p) > 24.0
                };
                if need {
                    let company_path = self.state.formations[ci].path.clone();
                    let upos = self.unit_pt(ui);
                    let mut entry = 0usize;
                    let mut scans = 0;
                    while scans < 12 && entry + 1 < company_path.len() && dist(upos, company_path[entry + 1]) < (if entry > 0 { 900.0 } else { 2600.0 }) && self.clear_line(upos, company_path[entry + 1]) {
                        entry += 1;
                        scans += 1;
                    }
                    let mut route: Vec<Pt> = company_path[entry..].to_vec();
                    if !route.is_empty() && !self.clear_line(upos, route[0]) {
                        let stale = {
                            let u = &self.state.units[ui];
                            match &u.path_request {
                                None => true,
                                Some(r) => r.revision != revision || dist(r.goal, route[0]) > 1.0,
                            }
                        };
                        if stale {
                            self.state.units[ui].path_request = Some(PathRequest { start: upos, goal: route[0], revision });
                        }
                        let pr = self.state.units[ui].path_request.clone().unwrap();
                        let team = self.state.units[ui].team;
                        let uid = self.state.units[ui].id;
                        let connector = self.nav_query(pr.start, pr.goal, if team == 0 { 2 } else { 0 }, Some(uid * 2));
                        match connector {
                            None => {
                                self.state.units[ui].moving = false;
                                return false;
                            }
                            Some(c) if c.is_empty() => {
                                self.state.units[ui].moving = false;
                                return false;
                            }
                            Some(c) => {
                                let mut head: Vec<Pt> = c[..c.len() - 1].to_vec();
                                head.extend(route);
                                route = head;
                            }
                        }
                    }
                    let uid = self.state.units[ui].id;
                    let lane = ((uid % 9) as f64 - 4.0) * 9.0;
                    let mut behind = upos;
                    let mut lanes: Vec<Pt> = Vec::new();
                    let rl = route.len();
                    for (i, q) in route.iter().enumerate() {
                        let ahead = if i + 1 < rl { route[i + 1] } else { p };
                        let len = {
                            let l = hypot(ahead.x - behind.x, ahead.y - behind.y);
                            if l == 0.0 { 1.0 } else { l }
                        };
                        let shifted = Pt::new(q.x - ((ahead.y - behind.y) / len) * lane, q.y + ((ahead.x - behind.x) / len) * lane);
                        let ok = (i as i64) < rl as i64 - 1 + (if rl > 0 { 0 } else { 1 }) && self.ground_free(shifted.x, shifted.y, 12.0) && self.clear_line(behind, shifted);
                        let point = if ok { shifted } else { *q };
                        behind = point;
                        lanes.push(point);
                    }
                    lanes.push(p);
                    let u = &mut self.state.units[ui];
                    u.path = lanes;
                    u.path_goal = Some(p);
                    u.path_revision = revision;
                    u.shared_route_revision = Some(revision);
                    u.path_request = None;
                    u.stuck = 0.0;
                }
            }
        }
        // Direct line-of-sight shortcut.
        {
            let upos = self.unit_pt(ui);
            let already = {
                let u = &self.state.units[ui];
                u.path.len() == 1 && u.path[0].x == p.x && u.path[0].y == p.y
            };
            if dist_to_goal < 220.0 && !already && self.clear_cached(ui, "goal", upos, p) {
                let rev = self.nav.revision as i64;
                let u = &mut self.state.units[ui];
                u.path = vec![p];
                u.path_goal = Some(p);
                u.path_request = None;
                u.path_revision = rev;
                u.stuck = 0.0;
            }
        }
        // Only query a new path when genuinely needed.
        let (has_valid, same_goal, same_rev, not_stuck) = {
            let u = &self.state.units[ui];
            (!u.path.is_empty(), u.path_goal.map(|g| dist(p, g) <= 24.0).unwrap_or(false), u.path_revision == self.nav.revision as i64, u.stuck < 0.8)
        };
        let needs_new_path = !has_valid || !same_goal || !same_rev || (!not_stuck && !shared);
        if needs_new_path && !waiting_for_route {
            let rev = self.nav.revision as i64;
            let upos = self.unit_pt(ui);
            let stale = {
                let u = &self.state.units[ui];
                match &u.path_request {
                    None => true,
                    Some(r) => r.revision != rev || dist(r.goal, p) > 24.0,
                }
            };
            if stale {
                self.state.units[ui].path_request = Some(PathRequest { start: upos, goal: p, revision: rev });
            }
            let pr = self.state.units[ui].path_request.clone().unwrap();
            let (team, uid, has_order) = {
                let u = &self.state.units[ui];
                (u.team, u.id, u.order.is_some())
            };
            let priority = if team == 0 { if has_order { 2 } else { 1 } } else { 0 };
            match self.nav_query(pr.start, pr.goal, priority, Some(uid * 2)) {
                None => {
                    let keep = {
                        let u = &self.state.units[ui];
                        u.path_revision != rev || u.path.is_empty()
                    };
                    if keep && !self.provisional_path(ui, p) {
                        self.state.units[ui].moving = false;
                        return false;
                    }
                }
                Some(path) => {
                    {
                        let u = &mut self.state.units[ui];
                        u.path = path;
                        u.path_request = None;
                        u.path_goal = Some(p);
                        u.path_revision = rev;
                        u.stuck = 0.0;
                    }
                    // Prune stale waypoints behind the unit or already shortcut.
                    while self.state.units[ui].path.len() > 1 {
                        let (p0, p1, upos) = {
                            let u = &self.state.units[ui];
                            (u.path[0], u.path[1], Pt::new(u.x, u.y))
                        };
                        let seg_x = p1.x - p0.x;
                        let seg_y = p1.y - p0.y;
                        let dot = (upos.x - p0.x) * seg_x + (upos.y - p0.y) * seg_y;
                        if (dot > 0.0 || dist(upos, p0) < reach_dist) && self.clear_line(upos, p1) {
                            self.state.units[ui].path.remove(0);
                        } else {
                            break;
                        }
                    }
                }
            }
        }
        // Advance waypoints along the path.
        while !self.state.units[ui].path.is_empty() {
            let (cur, upos, len) = {
                let u = &self.state.units[ui];
                (u.path[0], Pt::new(u.x, u.y), u.path.len())
            };
            let dist_to_cur = dist(upos, cur);
            if dist_to_cur < reach_dist {
                let next_ok = if len < 2 {
                    true
                } else {
                    let n1 = self.state.units[ui].path[1];
                    self.clear_cached(ui, "next", upos, n1)
                };
                if next_ok {
                    self.state.units[ui].path.remove(0);
                    continue;
                }
            }
            if len >= 2 {
                let next_wp = self.state.units[ui].path[1];
                let seg_x = next_wp.x - cur.x;
                let seg_y = next_wp.y - cur.y;
                let dot = (upos.x - cur.x) * seg_x + (upos.y - cur.y) * seg_y;
                if dot > 0.0 && (next_wp.x - upos.x).abs() < 480.0 && (next_wp.y - upos.y).abs() < 480.0 && self.clear_cached(ui, "next", upos, next_wp) {
                    self.state.units[ui].path.remove(0);
                    continue;
                }
                if dist(upos, next_wp) < 220.0 && self.clear_cached(ui, "next", upos, next_wp) {
                    self.state.units[ui].path.remove(0);
                    continue;
                }
            }
            break;
        }
        if self.state.units[ui].path.is_empty() {
            if dist_to_goal < stop {
                let u = &mut self.state.units[ui];
                u.moving = false;
                u.vx = Some(0.0);
                u.vy = Some(0.0);
                return true;
            }
            if self.ground_free(p.x, p.y, 6.0) && dist_to_goal < 75.0 {
                self.state.units[ui].path = vec![p];
            } else {
                let u = &mut self.state.units[ui];
                u.stuck += dt;
                u.moving = false;
                return false;
            }
        }

        let upos = self.unit_pt(ui);
        let next = self.state.units[ui].path.first().copied().unwrap_or(p);
        let d = dist(upos, next);
        let base_speed = data().ty(ty).speed;
        let speed = base_speed;

        // 1. Path force.
        let p_dir_x = if d > 0.001 { (next.x - upos.x) / d } else { 0.0 };
        let p_dir_y = if d > 0.001 { (next.y - upos.y) / d } else { 0.0 };
        let path_len = self.state.units[ui].path.len();
        let path_speed = if path_len <= 1 && dist_to_goal < 30.0 { speed * 1f64.min(0.35f64.max(dist_to_goal / 25.0)) } else { speed };
        let f_path_x = p_dir_x * path_speed;
        let f_path_y = p_dir_y * path_speed;

        // 2. Cohesion.
        let mut f_coh_x = 0.0;
        let mut f_coh_y = 0.0;
        let formation_anchor = order_formation.and_then(|f| self.formation_index(f)).map(|i| self.state.formations[i].anchor);
        if let Some(coh) = formation_anchor {
            if dist_to_goal > 220.0 && (coh.x - upos.x).abs() < 320.0 && (coh.y - upos.y).abs() < 320.0 && self.clear_cached(ui, "coh", upos, coh) {
                let cdx = coh.x - upos.x;
                let cdy = coh.y - upos.y;
                let cd = hypot(cdx, cdy);
                if cd > 24.0 {
                    let coh_fade = 1f64.min(0f64.max((dist_to_goal - 35.0) / 50.0));
                    let coh_strength = (speed * 0.35).min(cd * 0.4) * coh_fade;
                    f_coh_x = (cdx / cd) * coh_strength;
                    f_coh_y = (cdy / cd) * coh_strength;
                }
            }
        }

        // 3. Alignment.
        let (uid, team, uvx, uvy) = {
            let u = &self.state.units[ui];
            (u.id, u.team, u.vx.unwrap_or(0.0), u.vy.unwrap_or(0.0))
        };
        let mut f_align_x = 0.0;
        let mut f_align_y = 0.0;
        let mut align_count = 0;
        for oi in self.nearby(ui, 90.0) {
            let o = &self.state.units[oi];
            if o.id != uid && o.team == team && o.hp > 0.0 && o.moving && (o.vx.is_some() || o.vy.is_some()) {
                f_align_x += o.vx.unwrap_or(0.0);
                f_align_y += o.vy.unwrap_or(0.0);
                align_count += 1;
            }
        }
        if align_count > 0 && dist_to_goal > 30.0 {
            let avg_vx = f_align_x / align_count as f64;
            let avg_vy = f_align_y / align_count as f64;
            f_align_x = (avg_vx - uvx) * 0.3;
            f_align_y = (avg_vy - uvy) * 0.3;
        } else {
            f_align_x = 0.0;
            f_align_y = 0.0;
        }

        // 4. Separation.
        let mut f_sep_x = 0.0;
        let mut f_sep_y = 0.0;
        let my_r = if is_heavy(ty) { 26.0 } else { 14.0 };
        let order_present_non_attack = self.state.units[ui].order.as_ref().map(|o| o.attack != Some(true)).unwrap_or(false);
        for oi in self.nearby(ui, my_r + 28.0) {
            let (oid, ohp, oty, oteam, omoving, ox, oy) = {
                let o = &self.state.units[oi];
                (o.id, o.hp, o.ty, o.team, o.moving, o.x, o.y)
            };
            if oid == uid || ohp <= 0.0 {
                continue;
            }
            let other_r = if is_heavy(oty) { 26.0 } else { 14.0 };
            let sep_dist = (my_r + other_r) * 0.92;
            let odx = upos.x - ox;
            let ody = upos.y - oy;
            let od = hypot(odx, ody);
            if order_present_non_attack
                && dist_to_goal > 30.0
                && dist_to_goal < 220.0
                && oteam == team
                && !omoving
                && od < sep_dist + 12.0
                && od > 0.1
                && -(odx * p_dir_x + ody * p_dir_y) > od * 0.4
                && self.clear_line(upos, p)
            {
                let cross = p_dir_x * ody - p_dir_y * odx;
                let side = {
                    let u = &mut self.state.units[ui];
                    match u.arrival_avoid_side {
                        Some(s) if s != 0.0 => s,
                        _ => {
                            let s = if cross.abs() > 1.0 { sign(cross) } else if uid % 2 == 1 { 1.0 } else { -1.0 };
                            u.arrival_avoid_side = Some(s);
                            s
                        }
                    }
                };
                f_sep_x += -p_dir_y * side * speed * 0.8;
                f_sep_y += p_dir_x * side * speed * 0.8;
            }
            if od < sep_dist {
                if od > 0.1 {
                    let rep = ((sep_dist - od) / sep_dist) * speed * 1.6;
                    f_sep_x += (odx / od) * rep;
                    f_sep_y += (ody / od) * rep;
                } else {
                    f_sep_x += (if uid % 2 == 0 { 1.0 } else { -1.0 }) * speed;
                    f_sep_y += (if uid % 3 == 0 { 1.0 } else { -1.0 }) * speed;
                }
            }
        }
        if dist_to_goal < 24.0 {
            let f = 0.15f64.max(dist_to_goal / 24.0);
            f_sep_x *= f;
            f_sep_y *= f;
        }

        // 5. Obstacle avoidance.
        let mut f_obs_x = 0.0;
        let mut f_obs_y = 0.0;
        if upos.x < 42.0 {
            f_obs_x += ((42.0 - upos.x) / 18.0) * speed * 1.8;
        } else if upos.x > w - 42.0 {
            f_obs_x -= ((upos.x - (w - 42.0)) / 18.0) * speed * 1.8;
        }
        if upos.y < 42.0 {
            f_obs_y += ((42.0 - upos.y) / 18.0) * speed * 1.8;
        } else if upos.y > h - 42.0 {
            f_obs_y -= ((upos.y - (h - 42.0)) / 18.0) * speed * 1.8;
        }
        let look_dist = 26f64.min(speed * 0.32 + 8.0).min(if dist_to_goal < 30.0 && self.clear_line(upos, p) { 0f64.max(dist_to_goal - stop) } else { f64::INFINITY });
        let ahead_x = upos.x + p_dir_x * look_dist;
        let ahead_y = upos.y + p_dir_y * look_dist;
        if !self.ground_free(ahead_x, ahead_y, 6.0) {
            let hh = atan2(p_dir_y, p_dir_x);
            let lx = upos.x + cos(hh + 0.6) * look_dist;
            let ly = upos.y + sin(hh + 0.6) * look_dist;
            let rx = upos.x + cos(hh - 0.6) * look_dist;
            let ry = upos.y + sin(hh - 0.6) * look_dist;
            let left_ok = self.ground_free(lx, ly, 6.0);
            let right_ok = self.ground_free(rx, ry, 6.0);
            if left_ok && !right_ok {
                f_obs_x += -p_dir_y * speed * 1.4;
                f_obs_y += p_dir_x * speed * 1.4;
            } else if right_ok && !left_ok {
                f_obs_x += p_dir_y * speed * 1.4;
                f_obs_y += -p_dir_x * speed * 1.4;
            } else {
                f_obs_x += -p_dir_x * speed * 1.2;
                f_obs_y += -p_dir_y * speed * 1.2;
            }
        }

        // 6. Tactical / stance force.
        let mut f_tact_x = 0.0;
        let mut f_tact_y = 0.0;
        let (stance_fight, hold, manual_target, order_attack, has_order) = {
            let u = &self.state.units[ui];
            let stance = if u.stance.is_empty() { if u.hold { "hold" } else { "fight" } } else { u.stance.as_str() };
            (stance == "fight", u.hold, u.manual_target, u.order.as_ref().map(|o| o.attack == Some(true)).unwrap_or(false), u.order.is_some())
        };
        let committed_move = team == 0 && has_order && !order_attack;
        if stance_fight && !hold && !manual_target && !committed_move {
            if ty == UType::Archer {
                for ti in self.nearby(ui, 170.0) {
                    let t = &self.state.units[ti];
                    if t.team != team && t.team != 2 && t.hp > 0.0 && t.ty != UType::Civilian {
                        let tdx = upos.x - t.x;
                        let tdy = upos.y - t.y;
                        let td = hypot(tdx, tdy);
                        let kite_range = if t.ty == UType::Knight { 170.0 } else { 135.0 };
                        if td < kite_range && td > 0.1 {
                            let rep = ((kite_range - td) / kite_range) * speed * 1.5;
                            f_tact_x += (tdx / td) * rep;
                            f_tact_y += (tdy / td) * rep;
                        }
                    }
                }
            } else if ty == UType::Sword || ty == UType::Knight {
                let mut target_enemy: Option<crate::sim::Obj> = self.state.units[ui].target.and_then(|id| self.get_object(id));
                let bad = match target_enemy {
                    None => true,
                    Some(o) => self.obj_team(o) == team || self.obj_hp(o) <= 0.0,
                };
                if bad {
                    target_enemy = None;
                    if order_attack || !has_order {
                        let mut foes: Vec<usize> = self
                            .nearby(ui, 220.0)
                            .into_iter()
                            .filter(|&e| {
                                let e = &self.state.units[e];
                                e.team != team && e.team != 2 && e.hp > 0.0 && e.ty != UType::Civilian
                            })
                            .collect();
                        if !foes.is_empty() {
                            foes.sort_by(|&a, &b| {
                                let da = dist(Pt::new(self.state.units[a].x, self.state.units[a].y), upos);
                                let db = dist(Pt::new(self.state.units[b].x, self.state.units[b].y), upos);
                                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                            });
                            target_enemy = Some(crate::sim::Obj::Unit(foes[0]));
                        }
                    }
                }
                if let Some(te) = target_enemy {
                    let tp = self.obj_pos(te);
                    let tdx = tp.x - upos.x;
                    let tdy = tp.y - upos.y;
                    let td = hypot(tdx, tdy);
                    let is_building = matches!(te, crate::sim::Obj::Building(_));
                    let combat_range = data().ty(ty).range + if is_building { 15.0 } else { 6.0 };
                    if td > combat_range && td < 240.0 {
                        let pull = (speed * 1.3).min(speed * ((td - combat_range) / 80.0 + 0.3));
                        f_tact_x += (tdx / td) * pull;
                        f_tact_y += (tdy / td) * pull;
                    }
                }
            }
            if has_order && !order_attack && dist_to_goal < 30.0 {
                let fade = dist_to_goal / 30.0;
                f_tact_x *= fade;
                f_tact_y *= fade;
            }
        }

        // Combine forces into a smooth velocity.
        let mut des_vx = f_path_x + f_sep_x + f_coh_x + f_align_x + f_obs_x + f_tact_x;
        let mut des_vy = f_path_y + f_sep_y + f_coh_y + f_align_y + f_obs_y + f_tact_y;
        let des_mag = hypot(des_vx, des_vy);
        if des_mag > base_speed {
            des_vx = (des_vx / des_mag) * base_speed;
            des_vy = (des_vy / des_mag) * base_speed;
        }
        let (mut vx, mut vy) = {
            let u = &self.state.units[ui];
            (u.vx.unwrap_or(0.0) * 0.5 + des_vx * 0.5, u.vy.unwrap_or(0.0) * 0.5 + des_vy * 0.5)
        };
        let v_mag = hypot(vx, vy);
        if v_mag > base_speed {
            vx = (vx / v_mag) * base_speed;
            vy = (vy / v_mag) * base_speed;
        }

        // Integrate with slide on collision.
        let mut nx = upos.x + vx * dt;
        let mut ny = upos.y + vy * dt;
        if !self.ground_free(nx, ny, 6.0) {
            if self.ground_free(nx, upos.y, 6.0) {
                ny = upos.y;
                vy = 0.0;
            } else if self.ground_free(upos.x, ny, 6.0) {
                nx = upos.x;
                vx = 0.0;
            } else {
                let heading = atan2(if vy != 0.0 { vy } else { p_dir_y }, if vx != 0.0 { vx } else { p_dir_x });
                let step_len = 0.1f64.max(d.min(speed * dt));
                let mut turned = false;
                for turn in [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6] {
                    let tx = upos.x + cos(heading + turn) * step_len;
                    let ty2 = upos.y + sin(heading + turn) * step_len;
                    if self.ground_free(tx, ty2, 6.0) {
                        nx = tx;
                        ny = ty2;
                        turned = true;
                        break;
                    }
                }
                if !turned {
                    nx = upos.x;
                    ny = upos.y;
                    vx = 0.0;
                    vy = 0.0;
                }
            }
        }
        self.state.units[ui].vx = Some(vx);
        self.state.units[ui].vy = Some(vy);

        if self.ground_free(nx, ny, 6.0) {
            if nx != upos.x || ny != upos.y {
                let now = self.state.time;
                let u = &mut self.state.units[ui];
                u.angle = atan2(ny - upos.y, nx - upos.x);
                if ty == UType::Knight {
                    let base = if now - u.run_at.unwrap_or(-9.0) < 0.25 { u.run_up.unwrap_or(0.0) } else { 0.0 };
                    u.run_up = Some(base + hypot(nx - upos.x, ny - upos.y));
                    u.run_at = Some(now);
                }
                u.x = nx;
                u.y = ny;
            }
            let visual = self.visual;
            {
                let u = &mut self.state.units[ui];
                u.moving = true;
                if visual {
                    u.anim += dt * 10.0;
                }
                u.stuck = 0.0;
            }
            let (head, len, upos2) = {
                let u = &self.state.units[ui];
                (u.path.first().copied(), u.path.len(), Pt::new(u.x, u.y))
            };
            if let Some(h0) = head {
                if dist(upos2, h0) < reach_dist {
                    let ok = if len < 2 {
                        true
                    } else {
                        let n1 = self.state.units[ui].path[1];
                        self.clear_line(upos2, n1)
                    };
                    if ok {
                        self.state.units[ui].path.remove(0);
                    }
                }
            }
            if dist(upos2, p) < stop {
                let u = &mut self.state.units[ui];
                u.moving = false;
                u.vx = Some(0.0);
                u.vy = Some(0.0);
                return true;
            }
        } else {
            self.state.units[ui].stuck += dt;
        }
        false
    }

    pub fn obj_team(&self, o: crate::sim::Obj) -> i32 {
        match o {
            crate::sim::Obj::Unit(i) => self.state.units[i].team,
            crate::sim::Obj::Building(i) => self.state.buildings[i].team,
            crate::sim::Obj::Node(_) => -1,
        }
    }

    pub fn obj_hp(&self, o: crate::sim::Obj) -> f64 {
        match o {
            crate::sim::Obj::Unit(i) => self.state.units[i].hp,
            crate::sim::Obj::Building(i) => self.state.buildings[i].hp,
            crate::sim::Obj::Node(_) => 1.0,
        }
    }
}
