// Emits reference values from the JS engine for numeric parity tests.
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const out = { seeded: {}, hypot: [], trig: [], round: [] };
for (const seed of [1, 1888, 2219, 7777, 123456789]) {
  const r = seeded(seed);
  out.seeded[seed] = Array.from({ length: 64 }, () => r());
}
let s = seeded(99);
for (let i = 0; i < 400; i++) {
  const a = (s() - 0.5) * 4000, b = (s() - 0.5) * 4000;
  out.hypot.push([a, b, Math.hypot(a, b)]);
  const x = (s() - 0.5) * 20;
  out.trig.push([x, Math.sin(x), Math.cos(x), Math.atan2(a, b)]);
  const v = (s() - 0.5) * 200;
  out.round.push([v, Math.round(v)]);
}
for (const v of [0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 0.49999999999999994])
  out.round.push([v, Math.round(v)]);
out.large = [];
for (let i = 0; i < 600; i++) {
  const x = (s() - 0.3) * (i % 3 === 0 ? 2000 : i % 3 === 1 ? 60000 : 8);
  out.large.push([x, Math.sin(x), Math.cos(x)]);
}
for (const x of [Math.PI / 2, Math.PI, (3 * Math.PI) / 4, 1.5707963267948966, 2.356194490192345, 3.141592653589793, 100 * Math.PI, 0, -0.5, 0.2])
  out.large.push([x, Math.sin(x), Math.cos(x)]);
require("fs").writeFileSync(__dirname + "/../fixtures/js-math.json", JSON.stringify(out));
