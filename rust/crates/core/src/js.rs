//! JavaScript-compatible numeric helpers. The original game relies on V8's
//! `Math` functions; fdlibm-derived `libm` gives bit-identical sin/cos/atan2
//! and these helpers reproduce `Math.hypot`, `Math.round`, `Math.imul`.

#[inline]
pub fn sin(x: f64) -> f64 { crate::fdlibm::sin(x) }
#[inline]
pub fn cos(x: f64) -> f64 { crate::fdlibm::cos(x) }
#[inline]
pub fn atan2(y: f64, x: f64) -> f64 { crate::fdlibm::atan2(y, x) }

/// `Math.hypot(a, b)` exactly as V8 computes it (scaled, Kahan-summed).
pub fn hypot(a: f64, b: f64) -> f64 {
    let (a, b) = (a.abs(), b.abs());
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let max = if a > b { a } else { b };
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut comp = 0.0;
    for v in [a, b] {
        let n = v / max;
        let summand = n * n - comp;
        let prelim = sum + summand;
        comp = (prelim - sum) - summand;
        sum = prelim;
    }
    sum.sqrt() * max
}

/// `Math.round`: halves round toward +infinity.
#[inline]
pub fn round(x: f64) -> f64 {
    if !x.is_finite() { return x; }
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

#[inline]
pub fn clamp(n: f64, a: f64, b: f64) -> f64 {
    // Math.max(a, Math.min(b, n))
    let m = if b < n || b.is_nan() { b } else { n };
    if a > m || a.is_nan() { a } else { m }
}

/// `Math.imul`.
#[inline]
pub fn imul(a: i32, b: i32) -> i32 { a.wrapping_mul(b) }

/// The game's mulberry32 generator (`seeded(seed)` in game.js).
#[derive(Clone, Debug)]
pub struct Seeded(pub i32);
impl Seeded {
    pub fn new(seed: f64) -> Self { Seeded(to_i32(seed)) }
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5u32 as i32);
        let s = self.0;
        let mut t = imul(s ^ (((s as u32) >> 15) as i32), 1 | s);
        t = t.wrapping_add(imul(t ^ (((t as u32) >> 7) as i32), 61 | t)) ^ t;
        (((t ^ (((t as u32) >> 14) as i32)) as u32) as f64) / 4294967296.0
    }
}

/// JS `x | 0` (ToInt32).
pub fn to_i32(x: f64) -> i32 {
    if !x.is_finite() { return 0; }
    let m = x.trunc() % 4294967296.0;
    let m = if m < 0.0 { m + 4294967296.0 } else { m };
    (m as u64 as u32) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    fn fixture() -> Value {
        let text = include_str!("../../../fixtures/js-math.json");
        serde_json::from_str(text).unwrap()
    }
    #[test]
    fn seeded_matches_js() {
        let f = fixture();
        for (seed, values) in f["seeded"].as_object().unwrap() {
            let mut r = Seeded::new(seed.parse::<f64>().unwrap());
            for v in values.as_array().unwrap() {
                assert_eq!(r.next(), v.as_f64().unwrap(), "seed {seed}");
            }
        }
    }
    #[test]
    fn hypot_matches_v8() {
        for row in fixture()["hypot"].as_array().unwrap() {
            let r: Vec<f64> = row.as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
            assert_eq!(hypot(r[0], r[1]), r[2]);
        }
    }
    fn rows() -> Vec<Vec<f64>> {
        fixture()["trig"].as_array().unwrap().iter()
            .map(|row| row.as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect()).collect()
    }
    #[test]
    fn sin_matches_v8() {
        let bad: Vec<_> = rows().into_iter().filter(|r| sin(r[0]) != r[1]).map(|r| r[0]).collect();
        assert!(bad.is_empty(), "sin mismatches: {bad:?}");
    }
    #[test]
    fn cos_matches_v8() {
        let bad: Vec<_> = rows().into_iter().filter(|r| cos(r[0]) != r[2]).map(|r| r[0]).collect();
        assert!(bad.is_empty(), "cos mismatches: {bad:?}");
    }
    #[test]
    fn atan2_matches_v8() {
        let f = fixture();
        let hyp = f["hypot"].as_array().unwrap();
        let tri = f["trig"].as_array().unwrap();
        let mut bad = 0;
        for (h, t) in hyp.iter().zip(tri.iter()) {
            let a = h[0].as_f64().unwrap();
            let b = h[1].as_f64().unwrap();
            if atan2(a, b) != t[3].as_f64().unwrap() {
                bad += 1;
            }
        }
        assert_eq!(bad, 0, "atan2 mismatches");
    }
    #[test]
    fn large_trig_matches_v8() {
        let f = fixture();
        for row in f["large"].as_array().unwrap() {
            let x = row[0].as_f64().unwrap();
            assert_eq!(sin(x), row[1].as_f64().unwrap(), "sin({x})");
            assert_eq!(cos(x), row[2].as_f64().unwrap(), "cos({x})");
        }
    }
    #[test]
    fn round_matches_js() {
        for row in fixture()["round"].as_array().unwrap() {
            let r: Vec<f64> = row.as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
            assert_eq!(round(r[0]), r[1], "round({})", r[0]);
        }
    }
}
