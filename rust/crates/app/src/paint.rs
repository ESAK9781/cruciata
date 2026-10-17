//! Depth-sorted sprite batching on top of egui meshes, plus small 2-D
//! helpers that mimic the canvas calls the original art used.

use crate::atlas::{Atlas, PAGE};
use crate::view::View;
use eframe::egui::{self, epaint, Color32, Mesh, Painter, Pos2, Rect, Shape, Stroke, TextureId};

/// Parse `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgba(r,g,b,a)`.
pub fn col(s: &str) -> Color32 {
    let s = s.trim();
    if let Some(h) = s.strip_prefix('#') {
        let v = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0);
        return match h.len() {
            3 => {
                let d = |i: usize| u8::from_str_radix(&h[i..i + 1], 16).unwrap_or(0) * 17;
                Color32::from_rgb(d(0), d(1), d(2))
            }
            6 => Color32::from_rgb(v(0), v(2), v(4)),
            8 => rgba(v(0), v(2), v(4), v(6)),
            _ => Color32::from_rgb(255, 0, 255),
        };
    }
    if let Some(r) = s.strip_prefix("rgba(").and_then(|r| r.strip_suffix(')')) {
        let p: Vec<f32> = r.split(',').filter_map(|x| x.trim().parse().ok()).collect();
        if p.len() == 4 {
            return rgba(p[0] as u8, p[1] as u8, p[2] as u8, (p[3] * 255.0) as u8);
        }
    }
    Color32::from_rgb(255, 0, 255)
}

pub fn with_alpha(c: Color32, a: f32) -> Color32 {
    let [r, g, b, al] = c.straight();
    rgba(r, g, b, (al as f32 * a.clamp(0.0, 1.0)) as u8)
}

enum Item {
    Quad { tex: TextureId, rect: Rect, uv: Rect, tint: Color32 },
    Shape(Shape),
}

/// One atlas frame that was queued (kept so a falling building can be cut into shards).
#[derive(Clone)]
pub struct Drawn {
    pub key: String,
    pub ox: f64,
    pub oy: f64,
    pub wx: f64,
    pub wy: f64,
    pub scale: f64,
}

/// Collects drawables with a depth (world y) and flushes them in order.
pub struct Batch {
    items: Vec<(f32, u32, Item)>,
    pub record: bool,
    pub drawn: Vec<Drawn>,
}

impl Batch {
    pub fn new() -> Batch {
        Batch { items: Vec::with_capacity(4096), record: false, drawn: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Baked atlas frame at world position `(wx, wy)`, sprite origin `(ox, oy)`, uniform `scale`.
    #[allow(clippy::too_many_arguments)]
    pub fn frame(&mut self, atlas: &mut Atlas, view: &View, key: &str, ox: f64, oy: f64, wx: f64, wy: f64, scale: f64, depth: f64, tint: Color32) -> bool {
        let Some((f, tex)) = atlas.lookup(key) else { return false };
        let Some(tex) = tex else { return true };
        if self.record {
            self.drawn.push(Drawn { key: key.to_string(), ox, oy, wx, wy, scale });
        }
        let s = f.res as f64;
        let tl = view.to_screen(wx + (f.dx as f64 - ox) * scale, wy + (f.dy as f64 - oy) * scale);
        let size = egui::vec2((f.w as f64 / s * scale * view.zoom) as f32, (f.h as f64 / s * scale * view.zoom) as f32);
        let uv = Rect::from_min_max(Pos2::new(f.x / PAGE, f.y / PAGE), Pos2::new((f.x + f.w) / PAGE, (f.y + f.h) / PAGE));
        let n = self.items.len() as u32;
        self.items.push((depth as f32, n, Item::Quad { tex, rect: Rect::from_min_size(tl, size), uv, tint }));
        true
    }

    /// Same as `frame` but only the lower `fraction` of the sprite (construction sites).
    #[allow(clippy::too_many_arguments)]
    pub fn frame_partial(&mut self, atlas: &mut Atlas, view: &View, key: &str, ox: f64, oy: f64, wx: f64, wy: f64, scale: f64, depth: f64, fraction: f64, tint: Color32) -> bool {
        let Some((f, tex)) = atlas.lookup(key) else { return false };
        let Some(tex) = tex else { return true };
        let s = f.res as f64;
        let keep = fraction.clamp(0.0, 1.0) as f32;
        let h = f.h * keep;
        let top = f.h - h;
        let tl = view.to_screen(wx + (f.dx as f64 - ox) * scale, wy + ((f.dy + top / f.res) as f64 - oy) * scale);
        let size = egui::vec2((f.w as f64 / s * scale * view.zoom) as f32, (h as f64 / s * scale * view.zoom) as f32);
        let uv = Rect::from_min_max(Pos2::new(f.x / PAGE, (f.y + top) / PAGE), Pos2::new((f.x + f.w) / PAGE, (f.y + f.h) / PAGE));
        let n = self.items.len() as u32;
        self.items.push((depth as f32, n, Item::Quad { tex, rect: Rect::from_min_size(tl, size), uv, tint }));
        true
    }

    /// Like `frame`, rotated by `angle` radians about the sprite origin.
    #[allow(clippy::too_many_arguments)]
    pub fn frame_rot(&mut self, atlas: &mut Atlas, view: &View, key: &str, ox: f64, oy: f64, wx: f64, wy: f64, scale: f64, depth: f64, angle: f64, tint: Color32) -> bool {
        let Some((f, tex)) = atlas.lookup(key) else { return false };
        let Some(tex) = tex else { return true };
        let s = f.res as f64;
        let tl = view.to_screen(wx + (f.dx as f64 - ox) * scale, wy + (f.dy as f64 - oy) * scale);
        let size = egui::vec2((f.w as f64 / s * scale * view.zoom) as f32, (f.h as f64 / s * scale * view.zoom) as f32);
        let uv = Rect::from_min_max(Pos2::new(f.x / PAGE, f.y / PAGE), Pos2::new((f.x + f.w) / PAGE, (f.y + f.h) / PAGE));
        let mut mesh = Mesh::with_texture(tex);
        mesh.add_rect_with_uv(Rect::from_min_size(tl, size), uv, tint);
        mesh.rotate(egui::emath::Rot2::from_angle(angle as f32), view.to_screen(wx, wy));
        self.shape(depth, Shape::mesh(mesh));
        true
    }

    pub fn quad(&mut self, tex: TextureId, rect: Rect, uv: Rect, depth: f64, tint: Color32) {
        let n = self.items.len() as u32;
        self.items.push((depth as f32, n, Item::Quad { tex, rect, uv, tint }));
    }

    pub fn shape(&mut self, depth: f64, s: Shape) {
        let n = self.items.len() as u32;
        self.items.push((depth as f32, n, Item::Shape(s)));
    }

    pub fn flush(mut self, painter: &Painter) {
        self.items.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
        let mut mesh: Option<Mesh> = None;
        for (_, _, it) in self.items {
            match it {
                Item::Quad { tex, rect, uv, tint } => {
                    let m = match &mut mesh {
                        Some(m) if m.texture_id == tex => m,
                        _ => {
                            if let Some(done) = mesh.take() {
                                painter.add(Shape::mesh(done));
                            }
                            mesh = Some(Mesh::with_texture(tex));
                            mesh.as_mut().unwrap()
                        }
                    };
                    m.add_rect_with_uv(rect, uv, tint);
                }
                Item::Shape(s) => {
                    if let Some(done) = mesh.take() {
                        painter.add(Shape::mesh(done));
                    }
                    painter.add(s);
                }
            }
        }
        if let Some(done) = mesh.take() {
            painter.add(Shape::mesh(done));
        }
    }
}

// ---- canvas-like helpers ------------------------------------------------------

pub struct Canvas<'a> {
    pub painter: &'a Painter,
    pub view: &'a View,
}

impl<'a> Canvas<'a> {
    pub fn p(&self, x: f64, y: f64) -> Pos2 {
        self.view.to_screen(x, y)
    }

    pub fn ellipse(&self, x: f64, y: f64, rx: f64, ry: f64, c: Color32) {
        self.painter.add(ellipse_shape(self.view, x, y, rx, ry, c, Stroke::NONE));
    }

    pub fn ellipse_stroke(&self, x: f64, y: f64, rx: f64, ry: f64, w: f32, c: Color32) {
        self.painter.add(ellipse_shape(self.view, x, y, rx, ry, Color32::TRANSPARENT, Stroke::new(w, c)));
    }

    pub fn circle_stroke(&self, x: f64, y: f64, r: f64, w: f32, c: Color32) {
        self.ellipse_stroke(x, y, r, r, w, c);
    }

    pub fn dashed_circle(&self, x: f64, y: f64, r: f64, w: f32, c: Color32, dash: f32, gap: f32, offset: f32) {
        let pts = circle_points(self.view, x, y, r, r, true);
        for s in Shape::dashed_line_with_offset(&pts, Stroke::new(w, c), &[dash * self.view.zoom as f32], &[gap * self.view.zoom as f32], offset) {
            self.painter.add(s);
        }
    }

    pub fn line(&self, pts: &[(f64, f64)], w: f32, c: Color32) {
        let v: Vec<Pos2> = pts.iter().map(|&(x, y)| self.p(x, y)).collect();
        self.painter.add(Shape::line(v, Stroke::new(w * self.view.zoom as f32, c)));
    }

    pub fn dashed_line(&self, a: (f64, f64), b: (f64, f64), w: f32, c: Color32, dash: f32, gap: f32, offset: f32) {
        let pts = [self.p(a.0, a.1), self.p(b.0, b.1)];
        for s in Shape::dashed_line_with_offset(&pts, Stroke::new(w, c), &[dash], &[gap], offset) {
            self.painter.add(s);
        }
    }

    pub fn polygon(&self, pts: &[(f64, f64)], fill: Color32, stroke: Stroke) {
        let v: Vec<Pos2> = pts.iter().map(|&(x, y)| self.p(x, y)).collect();
        self.painter.add(Shape::convex_polygon(v, fill, stroke));
    }

    pub fn rect(&self, x: f64, y: f64, w: f64, h: f64, c: Color32) {
        self.painter.rect_filled(Rect::from_two_pos(self.p(x, y), self.p(x + w, y + h)), 0.0, c);
    }

    pub fn rect_stroke(&self, x: f64, y: f64, w: f64, h: f64, sw: f32, c: Color32) {
        self.painter.rect_stroke(Rect::from_two_pos(self.p(x, y), self.p(x + w, y + h)), 0.0, Stroke::new(sw, c));
    }

    pub fn text(&self, x: f64, y: f64, text: &str, size: f32, c: Color32) {
        self.painter.text(self.p(x, y), egui::Align2::CENTER_CENTER, text, egui::FontId::proportional(size), c);
    }
}

pub fn circle_points(view: &View, x: f64, y: f64, rx: f64, ry: f64, closed: bool) -> Vec<Pos2> {
    let r = (rx.max(ry) * view.zoom).max(1.0);
    let n = ((r.sqrt() * 5.0) as usize).clamp(12, 96);
    let mut v: Vec<Pos2> = (0..n).map(|i| {
        let a = i as f64 / n as f64 * std::f64::consts::TAU;
        view.to_screen(x + a.cos() * rx, y + a.sin() * ry)
    }).collect();
    if closed {
        v.push(v[0]);
    }
    v
}

pub fn ellipse_shape(view: &View, x: f64, y: f64, rx: f64, ry: f64, fill: Color32, stroke: Stroke) -> Shape {
    let pts = circle_points(view, x, y, rx, ry, false);
    if stroke.width > 0.0 && fill.a() == 0 {
        let mut p = pts;
        p.push(p[0]);
        Shape::line(p, stroke)
    } else {
        Shape::Path(epaint::PathShape { points: pts, closed: true, fill, stroke: stroke.into() })
    }
}

/// Straight-alpha colour to egui's premultiplied form, blended in gamma space
/// like a 2D canvas (egui's own constructor premultiplies in linear light,
/// which makes every translucent colour paler than the web version).
pub fn rgba(r: u8, g: u8, b: u8, a: u8) -> Color32 {
    let m = |v: u8| ((v as u32 * a as u32 + 127) / 255) as u8;
    Color32::from_rgba_premultiplied(m(r), m(g), m(b), a)
}

/// Build a texture image from straight-alpha RGBA bytes (canvas-style blending).
pub fn image_from_straight(size: [usize; 2], rgba_bytes: &[u8]) -> eframe::egui::ColorImage {
    let pixels = rgba_bytes.chunks_exact(4).map(|p| rgba(p[0], p[1], p[2], p[3])).collect();
    eframe::egui::ColorImage { size, pixels }
}

pub trait Straight {
    /// Straight-alpha bytes, inverse of `rgba`.
    fn straight(&self) -> [u8; 4];
}

impl Straight for Color32 {
    fn straight(&self) -> [u8; 4] {
        let a = self.a();
        if a == 0 {
            return [0, 0, 0, 0];
        }
        let u = |v: u8| ((v as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8;
        [u(self.r()), u(self.g()), u(self.b()), a]
    }
}
