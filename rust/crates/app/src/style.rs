//! Look of the original interface: fonts, palette, gradients, ridged frames
//! and the hand-painted buttons the web version styled with CSS.

use crate::paint::col;
use eframe::egui::{self, epaint, Align2, Color32, FontData, FontDefinitions, FontFamily, FontId, Mesh, Pos2, Rect, Response, Sense, Shape, Stroke, TextureHandle, Vec2};
use std::collections::HashMap;

pub fn fell(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("fell".into()))
}
pub fn fell_italic(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("fell-italic".into()))
}
pub fn serif(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("serif".into()))
}
pub fn serif_italic(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("serif-italic".into()))
}
pub fn sans(size: f32) -> FontId {
    FontId::new(size, FontFamily::Proportional)
}

pub fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let mut add = |name: &str, bytes: &'static [u8]| {
        fonts.font_data.insert(name.to_string(), FontData::from_static(bytes));
    };
    add("dm", include_bytes!("../../../../assets/fonts/DMSans-Variable.ttf"));
    add("fell", include_bytes!("../../../../assets/fonts/IMFellEnglish-Regular.ttf"));
    add("fell-italic", include_bytes!("../../../../assets/fonts/IMFellEnglish-Italic.ttf"));
    add("gelasio", include_bytes!("../../../../assets/fonts/Gelasio-Variable.ttf"));
    add("gelasio-italic", include_bytes!("../../../../assets/fonts/Gelasio-Italic-Variable.ttf"));
    let fallback: Vec<String> = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    let with_fallback = |first: &str| -> Vec<String> {
        let mut v = vec![first.to_string()];
        v.extend(fallback.iter().cloned());
        v
    };
    fonts.families.insert(FontFamily::Proportional, with_fallback("dm"));
    fonts.families.insert(FontFamily::Name("fell".into()), with_fallback("fell"));
    fonts.families.insert(FontFamily::Name("fell-italic".into()), with_fallback("fell-italic"));
    fonts.families.insert(FontFamily::Name("serif".into()), with_fallback("gelasio"));
    fonts.families.insert(FontFamily::Name("serif-italic".into()), with_fallback("gelasio-italic"));
    ctx.set_fonts(fonts);
}

// ---- palette (values read from the web page's computed styles) ----------------

pub const INK: &str = "#f4e5c9";
pub const CREAM: &str = "#e9d8b1";
pub const GOLD: &str = "#bba279";
pub const MUTED: &str = "#a2997e";

/// Vertical gradient quad.
pub fn gradient_v(painter: &egui::Painter, rect: Rect, top: Color32, bottom: Color32) {
    let mut m = Mesh::default();
    let i = m.vertices.len() as u32;
    let v = |p: Pos2, c: Color32| epaint::Vertex { pos: p, uv: epaint::WHITE_UV, color: c };
    m.vertices.push(v(rect.left_top(), top));
    m.vertices.push(v(rect.right_top(), top));
    m.vertices.push(v(rect.right_bottom(), bottom));
    m.vertices.push(v(rect.left_bottom(), bottom));
    m.indices.extend_from_slice(&[i, i + 1, i + 2, i, i + 2, i + 3]);
    painter.add(Shape::mesh(m));
}

pub fn gradient_h(painter: &egui::Painter, rect: Rect, left: Color32, right: Color32) {
    let mut m = Mesh::default();
    let v = |p: Pos2, c: Color32| epaint::Vertex { pos: p, uv: epaint::WHITE_UV, color: c };
    m.vertices.push(v(rect.left_top(), left));
    m.vertices.push(v(rect.right_top(), right));
    m.vertices.push(v(rect.right_bottom(), right));
    m.vertices.push(v(rect.left_bottom(), left));
    m.indices.extend_from_slice(&[0, 1, 2, 0, 2, 3]);
    painter.add(Shape::mesh(m));
}

/// `border: Npx ridge`: light outer half, dark inner half.
pub fn ridge(painter: &egui::Painter, rect: Rect, width: f32, color: Color32) {
    let [r, g, b, a] = color.to_srgba_unmultiplied();
    let dark = |f: f32| Color32::from_rgba_unmultiplied((r as f32 * f) as u8, (g as f32 * f) as u8, (b as f32 * f) as u8, a);
    let h = width / 2.0;
    painter.rect_stroke(rect.shrink(h / 2.0), 0.0, Stroke::new(h, dark(1.12)));
    painter.rect_stroke(rect.shrink(h * 1.5), 0.0, Stroke::new(h, dark(0.62)));
}

/// `border-bottom: 3px double`.
pub fn double_line(painter: &egui::Painter, from: Pos2, to: Pos2, color: Color32, horizontal: bool) {
    let off = if horizontal { Vec2::new(0.0, 2.0) } else { Vec2::new(2.0, 0.0) };
    painter.line_segment([from, to], Stroke::new(1.0, color));
    painter.line_segment([from + off, to + off], Stroke::new(1.0, color));
}

pub fn text(painter: &egui::Painter, pos: Pos2, anchor: Align2, s: &str, font: FontId, color: Color32) -> Rect {
    painter.text(pos, anchor, s, font, color)
}

/// Spaced capitals as in `.eyebrow` (egui has no letter-spacing, so draw glyph by glyph).
pub fn spaced(painter: &egui::Painter, pos: Pos2, s: &str, font: FontId, color: Color32, spacing: f32) -> f32 {
    let mut x = pos.x;
    for ch in s.chars() {
        let r = painter.text(Pos2::new(x, pos.y), Align2::LEFT_TOP, ch, font.clone(), color);
        x += r.width() + spacing;
    }
    x - pos.x
}

pub fn spaced_width(ctx: &egui::Context, s: &str, font: FontId, spacing: f32) -> f32 {
    ctx.fonts(|f| s.chars().map(|c| f.glyph_width(&font, c) + spacing).sum())
}

pub fn text_width(ctx: &egui::Context, s: &str, font: FontId) -> f32 {
    ctx.fonts(|f| s.chars().map(|c| f.glyph_width(&font, c)).sum())
}

/// Word-wrapped paragraph; returns its height.
pub fn paragraph(painter: &egui::Painter, pos: Pos2, width: f32, s: &str, font: FontId, color: Color32, line: f32) -> f32 {
    let galley = painter.layout(s.to_string(), font, color, width);
    let rows = galley.rows.len().max(1) as f32;
    // Paint row by row so the line height matches the CSS line-height.
    let mut y = pos.y;
    for row in &galley.rows {
        let text: String = row.glyphs.iter().map(|g| g.chr).collect();
        painter.text(Pos2::new(pos.x, y), Align2::LEFT_TOP, text, galley.job.sections.first().map(|s| s.format.font_id.clone()).unwrap_or_default(), color);
        y += line;
    }
    rows * line
}

pub fn paragraph_height(ctx: &egui::Context, width: f32, s: &str, font: FontId, line: f32) -> f32 {
    let g = ctx.fonts(|f| f.layout(s.to_string(), font, Color32::WHITE, width));
    g.rows.len().max(1) as f32 * line
}

pub struct ButtonStyle {
    pub font: FontId,
    pub fg: Color32,
    pub top: Color32,
    pub bottom: Color32,
    pub border: Color32,
    pub hover_top: Color32,
    pub hover_bottom: Color32,
    pub hover_border: Color32,
}

impl ButtonStyle {
    /// The default `button` of style.css.
    pub fn standard(size: f32) -> ButtonStyle {
        ButtonStyle { font: sans(size), fg: col(INK), top: col("#51412e"), bottom: col("#3e3023"), border: col("#806647"), hover_top: col("#695236"), hover_bottom: col("#493725"), hover_border: col("#b2915d") }
    }

    pub fn overlay(size: f32) -> ButtonStyle {
        ButtonStyle { font: sans(size), fg: col("#d0c69b"), top: col("#37392cdf"), bottom: col("#37392cdf"), border: col("#93825b"), hover_top: col("#4a4a38"), hover_bottom: col("#4a4a38"), hover_border: col("#c3af7b") }
    }
}

/// Button painted like the CSS buttons; returns its response.
pub fn button(ui: &mut egui::Ui, size: Vec2, label: &str, st: &ButtonStyle, active: bool, enabled: bool) -> Response {
    let (rect, resp) = ui.allocate_exact_size(size, if enabled { Sense::click() } else { Sense::hover() });
    paint_button(ui.painter(), rect, label, st, active, enabled, resp.hovered());
    resp
}

pub fn paint_button(painter: &egui::Painter, rect: Rect, label: &str, st: &ButtonStyle, active: bool, enabled: bool, hovered: bool) {
    let (top, bottom, border) = if active { (col("#754a2d"), col("#754a2d"), col("#d3aa6b")) } else if hovered && enabled { (st.hover_top, st.hover_bottom, st.hover_border) } else { (st.top, st.bottom, st.border) };
    let fade = if enabled { 1.0 } else { 0.42 };
    gradient_v(painter, rect, top.gamma_multiply(fade), bottom.gamma_multiply(fade));
    painter.rect_stroke(rect, 2.0, Stroke::new(1.0, border.gamma_multiply(fade)));
    painter.line_segment([rect.left_top() + Vec2::new(1.0, 1.0), rect.right_top() + Vec2::new(-1.0, 1.0)], Stroke::new(1.0, col("#ad93662b")));
    painter.text(rect.center(), Align2::CENTER_CENTER, label, st.font.clone(), st.fg.gamma_multiply(fade));
}

pub fn kbd(painter: &egui::Painter, right_center: Pos2, label: &str) -> f32 {
    let font = sans(8.0);
    let w = label.chars().count() as f32 * 5.2 + 8.0;
    let rect = Rect::from_min_max(Pos2::new(right_center.x - w, right_center.y - 8.0), Pos2::new(right_center.x, right_center.y + 8.0));
    painter.rect_filled(rect, 2.0, col("#241e1877"));
    painter.rect_stroke(rect, 2.0, Stroke::new(1.0, col("#95754555")));
    painter.text(rect.center(), Align2::CENTER_CENTER, label, font, col("#ac966e"));
    w
}

/// Pre-rendered SVG icons.
pub struct Icons {
    pub map: HashMap<&'static str, TextureHandle>,
}

fn render_svg(svg: &str, px: u32) -> Option<egui::ColorImage> {
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).ok()?;
    let mut pm = resvg::tiny_skia::Pixmap::new(px, px)?;
    let s = tree.size();
    let k = (px as f32 / s.width()).min(px as f32 / s.height());
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(k, k), &mut pm.as_mut());
    let pixels = pm
        .pixels()
        .iter()
        .map(|p| {
            let c = p.demultiply();
            Color32::from_rgba_unmultiplied(c.red(), c.green(), c.blue(), c.alpha())
        })
        .collect();
    Some(egui::ColorImage { size: [px as usize, px as usize], pixels })
}

fn render_svg_wh(svg: &str, w: u32, h: u32) -> Option<egui::ColorImage> {
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).ok()?;
    let mut pm = resvg::tiny_skia::Pixmap::new(w, h)?;
    let s = tree.size();
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(w as f32 / s.width(), h as f32 / s.height()), &mut pm.as_mut());
    let pixels = pm.pixels().iter().map(|p| {
        let c = p.demultiply();
        Color32::from_rgba_unmultiplied(c.red(), c.green(), c.blue(), c.alpha())
    }).collect();
    Some(egui::ColorImage { size: [w as usize, h as usize], pixels })
}

/// The Jerusalem-cross emblem (stroke colour substituted).
pub fn cross_svg(color: &str) -> String {
    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><g fill='none' stroke='{c}' stroke-width='7'><path d='M50 13v74M13 50h74M38 13h24M38 87h24M13 38v24M87 38v24'/><path stroke-width='5' d='M26 18v16M18 26h16M74 18v16M66 26h16M26 66v16M18 74h16M74 66v16M66 74h16'/></g></svg>",
        c = color
    )
}

impl Icons {
    pub fn load(ctx: &egui::Context, assets: &std::path::Path) -> Icons {
        let mut map = HashMap::new();
        for name in ["food", "wood", "gold", "stone", "people", "faith"] {
            let path = assets.join("icons").join(format!("{name}.svg"));
            if let Some(img) = std::fs::read_to_string(&path).ok().and_then(|s| render_svg(&s, 64)) {
                map.insert(name, ctx.load_texture(format!("icon-{name}"), img, egui::TextureOptions::LINEAR));
            }
        }
        for (name, color) in [("cross-gold", "#ddbd77"), ("cross-rust", "#b66a4d"), ("cross-dim", "#9d8357")] {
            if let Some(img) = render_svg(&cross_svg(color), 128) {
                map.insert(name, ctx.load_texture(format!("icon-{name}"), img, egui::TextureOptions::LINEAR));
            }
        }
        if let Some(img) = std::fs::read_to_string(assets.join("standards.svg")).ok().and_then(|s| render_svg_wh(&s, 520, 620)) {
            map.insert("banner", ctx.load_texture("icon-banner", img, egui::TextureOptions::LINEAR));
        }
        Icons { map }
    }

    pub fn draw(&self, painter: &egui::Painter, name: &str, rect: Rect) {
        if let Some(t) = self.map.get(name) {
            painter.image(t.id(), rect, Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
        }
    }
}

/// Soft radial glow (`radial-gradient(color, transparent)`).
pub fn radial_glow(painter: &egui::Painter, center: Pos2, radius: f32, color: Color32) {
    let [r, g, b, a] = color.to_srgba_unmultiplied();
    let mut m = Mesh::default();
    let v = |p: Pos2, c: Color32| epaint::Vertex { pos: p, uv: epaint::WHITE_UV, color: c };
    m.vertices.push(v(center, Color32::from_rgba_unmultiplied(r, g, b, a)));
    let n = 64;
    for i in 0..n {
        let t = i as f32 / n as f32 * std::f32::consts::TAU;
        m.vertices.push(v(center + Vec2::new(t.cos(), t.sin()) * radius, Color32::from_rgba_unmultiplied(r, g, b, 0)));
    }
    for i in 0..n {
        m.indices.extend_from_slice(&[0, 1 + i as u32, 1 + ((i + 1) % n) as u32]);
    }
    painter.add(Shape::mesh(m));
}
