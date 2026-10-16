//! Camera: a plain 2-D scale and offset over world coordinates (the art is
//! already projected, so there is no isometric transform here).

use eframe::egui::{Pos2, Rect};

#[derive(Clone, Debug)]
pub struct View {
    /// Camera centre in world units.
    pub cx: f64,
    pub cy: f64,
    pub zoom: f64,
    pub world_w: f64,
    pub world_h: f64,
    /// Screen rectangle of the map area (points).
    pub rect: Rect,
    // Derived by `update`.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl View {
    pub fn new(world_w: f64, world_h: f64) -> View {
        let mut v = View { cx: world_w / 2.0, cy: world_h / 2.0, zoom: 0.8, world_w, world_h, rect: Rect::from_min_size(Pos2::ZERO, eframe::egui::vec2(1280.0, 720.0)), x: 0.0, y: 0.0, w: 0.0, h: 0.0 };
        v.update();
        v
    }

    pub fn min_zoom(&self) -> f64 {
        (self.rect.width() as f64 / self.world_w).max(self.rect.height() as f64 / self.world_h)
    }

    /// Recompute the visible world rectangle (`updateView`).
    pub fn update(&mut self) {
        self.zoom = self.zoom.clamp(self.min_zoom().min(2.4), 2.4);
        let w = (self.rect.width() as f64 / self.zoom).min(self.world_w);
        let h = (self.rect.height() as f64 / self.zoom).min(self.world_h);
        self.w = w;
        self.h = h;
        // The view may slide past the edge (black) to centre edge objects, but a
        // fifth of it must still overlap the land.
        self.cx = self.cx.clamp(-w * 0.3, self.world_w + w * 0.3);
        self.cy = self.cy.clamp(-h * 0.3, self.world_h + h * 0.3);
        self.x = self.cx - w / 2.0;
        self.y = self.cy - h / 2.0;
    }

    /// Centre on a point keeping the view on the land (used for starting and home views).
    pub fn center_tight(&mut self, x: f64, y: f64) {
        self.cx = x;
        self.cy = y;
        self.update();
        self.cx = self.cx.clamp(self.w / 2.0, (self.world_w - self.w / 2.0).max(self.w / 2.0));
        self.cy = self.cy.clamp(self.h / 2.0, (self.world_h - self.h / 2.0).max(self.h / 2.0));
        self.update();
    }

    pub fn to_screen(&self, x: f64, y: f64) -> Pos2 {
        Pos2::new(self.rect.min.x + ((x - self.x) * self.zoom) as f32, self.rect.min.y + ((y - self.y) * self.zoom) as f32)
    }

    pub fn to_world(&self, p: Pos2) -> (f64, f64) {
        (self.x + (p.x - self.rect.min.x) as f64 / self.zoom, self.y + (p.y - self.rect.min.y) as f64 / self.zoom)
    }

    pub fn on_screen(&self, x: f64, y: f64, margin: f64) -> bool {
        x >= self.x - margin && y >= self.y - margin && x <= self.x + self.w + margin && y <= self.y + self.h + margin
    }

    /// Zoom around a screen point, keeping the world point under it fixed.
    pub fn zoom_at(&mut self, delta: f64, at: Pos2) {
        let before = self.to_world(at);
        self.zoom += delta;
        self.update();
        self.cx = before.0 - (at.x - self.rect.center().x) as f64 / self.zoom;
        self.cy = before.1 - (at.y - self.rect.center().y) as f64 / self.zoom;
        self.update();
    }
}
