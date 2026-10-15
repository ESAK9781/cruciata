/* Ground painting, cloth physics and canvas primitives. isometric-art.js installs
   the projected world models over the legacy shape fallbacks before game.js. */
(() => {
  "use strict";
  const C = {
    red: "#b73527",
    green: "#197654",
    cream: "#f2e1b7",
    gold: "#edb442",
    stone: "#aa9f80",
    wall: "#d8c49a",
    wood: "#776042",
  };
  function ellipse(g, x, y, rx, ry, color) {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  function line(g, points, width, color) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  function polygon(g, points, fill, stroke) {
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 1.5;
      g.stroke();
    }
  }
  function rect(g, x, y, w, h, fill, stroke) {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 2;
      g.strokeRect(x, y, w, h);
    }
  }
  function cross(g, x, y, size, color) {
    line(
      g,
      [
        [x, y - size],
        [x, y + size],
      ],
      Math.max(1, size * 0.4),
      color,
    );
    line(
      g,
      [
        [x - size * 0.65, y - size * 0.25],
        [x + size * 0.65, y - size * 0.25],
      ],
      Math.max(1, size * 0.4),
      color,
    );
  }
  function jerusalemCross(g, x, y, size, color, weight = 1) {
    const arm = size * 0.6,
      width = Math.max(1, size * 0.18) * weight;
    line(
      g,
      [
        [x - size, y],
        [x + size, y],
      ],
      width,
      color,
    );
    line(
      g,
      [
        [x, y - size],
        [x, y + size],
      ],
      width,
      color,
    );
    for (const end of [-1, 1]) {
      line(
        g,
        [
          [x + end * size, y - size * 0.3],
          [x + end * size, y + size * 0.3],
        ],
        width,
        color,
      );
      line(
        g,
        [
          [x - size * 0.3, y + end * size],
          [x + size * 0.3, y + end * size],
        ],
        width,
        color,
      );
    }
    for (const dx of [-arm, arm])
      for (const dy of [-arm, arm]) {
        line(
          g,
          [
            [x + dx - size * 0.18, y + dy],
            [x + dx + size * 0.18, y + dy],
          ],
          width * 0.7,
          color,
        );
        line(
          g,
          [
            [x + dx, y + dy - size * 0.18],
            [x + dx, y + dy + size * 0.18],
          ],
          width * 0.7,
          color,
        );
      }
  }
  function sigil(g, x, y, size, team, color = C.cream) {
    if (team === 3) {
      polygon(
        g,
        [
          [x - size, y - size],
          [x + size, y - size],
          [x + size * 0.7, y + size * 0.5],
          [x, y + size],
          [x - size * 0.7, y + size * 0.5],
        ],
        color,
        "#755b32",
      );
      return;
    }
    if (team !== 1) {
      jerusalemCross(g, x, y, size, color);
      return;
    }
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, size * 0.35);
    g.beginPath();
    g.arc(x, y, size * 0.8, 0.7, 5.5);
    g.stroke();
  }
  function roof(g, x, y, w, h, color = C.red) {
    rect(g, x - 3, y - 3, w + 6, h + 6, "#6c6249");
    rect(g, x, y, w, h, color);
    rect(g, x, y + h * 0.5, w, h * 0.5, "#00000018");
    line(
      g,
      [
        [x, y + h / 2],
        [x + w, y + h / 2],
      ],
      2,
      "#e2b48070",
    );
    for (let row = 5; row < h; row += 7) {
      line(
        g,
        [
          [x + 2, y + row],
          [x + w - 2, y + row],
        ],
        0.7,
        "#3f332844",
      );
      for (let col = (row % 2) * 5 + 5; col < w; col += 11)
        line(
          g,
          [
            [x + col, y + row - 5],
            [x + col, y + row],
          ],
          0.6,
          "#e7c99a38",
        );
    }
  }
  function lappingWave(time, band, along, scale = 1) {
    const phase = (time * 9 + band * 38) % 190;
    return {
      offset:
        (-190 + phase + Math.sin(along / 54 + time * 0.65 + band) * 4) * scale,
      opacity: Math.sin((phase / 190) * Math.PI) * 0.28,
      width: (0.7 + phase / 150) * scale,
    };
  }
  // Army cloth is transient: simulation advances it, rendering only reads it.
  const standardCloths = new WeakMap();
  function standardAnchor(u) {
    const a = (u.angle || 0) + Math.PI / 2;
    return { x: u.x + Math.cos(a) * 6, y: u.y + Math.sin(a) * 6, z: 44 };
  }
  function standardCloth(u) {
    let cloth = standardCloths.get(u);
    if (cloth) return cloth;
    const anchor = standardAnchor(u),
      points = [],
      rows = [],
      links = [];
    for (let r = 0; r < 5; r++) {
      rows[r] = [];
      const end = 12 + Math.abs(r - 2) * 2;
      for (let c = 0; c <= end; c++) {
        const p = {
          x: anchor.x - Math.cos(u.angle || 0) * c * 4.2,
          y: anchor.y - Math.sin(u.angle || 0) * c * 4.2,
          z: anchor.z - r * 4 + Math.sin(c * 0.7 + r) * 0.3 * (c > 0),
          vx: 0,
          vy: 0,
          vz: 0,
          r,
          c,
          pinned: c === 0,
        };
        rows[r][c] = p;
        points.push(p);
      }
    }
    const join = (a, b, length, stiffness = 1) => {
      if (a && b)
        links.push({ a, b, length, length2: length * length, stiffness });
    };
    for (const p of points) {
      join(p, rows[p.r][p.c + 1], 4.2);
      join(p, rows[p.r + 1]?.[p.c], 4);
      join(p, rows[p.r + 1]?.[p.c + 1], Math.hypot(4.2, 4), 0.65);
      join(p, rows[p.r + 1]?.[p.c - 1], Math.hypot(4.2, 4), 0.65);
      join(p, rows[p.r][p.c + 2], 8.4, 0.18);
    }
    cloth = { points, rows, links, anchor, time: 0 };
    standardCloths.set(u, cloth);
    return cloth;
  }
  function updateStandard(u, dt) {
    if (!(dt > 0)) return;
    const cloth = standardCloth(u),
      target = standardAnchor(u);
    if (cloth.suspended) {
      const dx = target.x - cloth.anchor.x,
        dy = target.y - cloth.anchor.y;
      for (const p of cloth.points) {
        p.x += dx;
        p.y += dy;
        p.vx = p.vy = p.vz = 0;
      }
      cloth.anchor = target;
      cloth.suspended = false;
      cloth.sleeping = false;
      cloth.settledFor = 0;
    }
    const old = cloth.anchor;
    const anchorTravel = Math.hypot(target.x - old.x, target.y - old.y);
    if (cloth.sleeping && anchorTravel < 0.02) return;
    if (anchorTravel >= 0.02) {
      cloth.sleeping = false;
      cloth.settledFor = 0;
    }
    // Teleports/load placement reset inertia without stretching the cloth.
    if (Math.hypot(target.x - old.x, target.y - old.y) > 150) {
      for (const p of cloth.points) {
        p.x += target.x - old.x;
        p.y += target.y - old.y;
        p.vx = p.vy = p.vz = 0;
      }
      cloth.anchor = target;
      return;
    }
    const steps = Math.ceil(dt / (1 / 90)),
      h = dt / steps;
    const speed = Math.hypot(target.x - old.x, target.y - old.y) / dt;
    for (let step = 1; step <= steps; step++) {
      const anchor = {
        x: old.x + ((target.x - old.x) * step) / steps,
        y: old.y + ((target.y - old.y) * step) / steps,
      };
      cloth.time += h;
      for (const p of cloth.points) {
        p.px = p.x;
        p.py = p.y;
        p.pz = p.z;
        if (p.pinned) {
          p.x = anchor.x;
          p.y = anchor.y;
          p.z = target.z - p.r * 4;
          continue;
        }
        // Gravity, still-air drag and small movement-driven turbulent forces.
        // The moving pinned edge pulls the mass through air, leaving it behind.
        const flutter =
          Math.min(1, speed / 65) *
          Math.sin(cloth.time * 11 - p.c * 0.8 + p.r * 0.7) *
          32;
        p.vx = (p.vx + flutter * h) * Math.exp(-3.5 * h);
        p.vy = (p.vy + flutter * 0.35 * h) * Math.exp(-3.5 * h);
        p.vz = (p.vz + (-85 + flutter) * h) * Math.exp(-3.5 * h);
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.z += p.vz * h;
      }
      for (let iteration = 0; iteration < 5; iteration++)
        for (const { a, b, length, length2, stiffness } of cloth.links) {
          const dx = b.x - a.x,
            dy = b.y - a.y,
            dz = b.z - a.z,
            squared = dx * dx + dy * dy + dz * dz;
          if (Math.abs(squared - length2) < 0.004) continue;
          const d = Math.sqrt(squared) || 1;
          const correction =
            (((d - length) / d) * stiffness) / (a.pinned || b.pinned ? 1 : 2);
          if (!a.pinned) {
            a.x += dx * correction;
            a.y += dy * correction;
            a.z += dz * correction;
          }
          if (!b.pinned) {
            b.x -= dx * correction;
            b.y -= dy * correction;
            b.z -= dz * correction;
          }
        }
      for (const p of cloth.points) {
        if (!p.pinned && p.z < 7) {
          p.z = 7;
          p.x = p.px + (p.x - p.px) * 0.85;
          p.y = p.py + (p.y - p.py) * 0.85;
        }
        p.vx = (p.x - p.px) / h;
        p.vy = (p.y - p.py) / h;
        p.vz = (p.z - p.pz) / h;
      }
    }
    cloth.anchor = target;
    const energy =
      cloth.points.reduce(
        (sum, p) => sum + p.vx * p.vx + p.vy * p.vy + p.vz * p.vz,
        0,
      ) / cloth.points.length;
    cloth.settledFor =
      speed < 0.1 && energy < 0.3 ? (cloth.settledFor || 0) + dt : 0;
    cloth.sleeping = cloth.settledFor > 0.8;
  }
  const standardEmblems = new Map();
  function standardEmblem(team) {
    if (standardEmblems.has(team)) return standardEmblems.get(team);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 64;
    const cg = canvas.getContext("2d");
    cg.scale(4, 4);
    if (team === 0) jerusalemCross(cg, 22, 8, 6.7, C.cream, 1.7);
    else sigil(cg, 22, 8, 6.7, team, C.cream);
    standardEmblems.set(team, canvas);
    return canvas;
  }
  function clothEmblemTriangle(g, image, shape, c, r, second) {
    const [a, b, d] = shape,
      sx = c * 5,
      sy = r * 4;
    const ax = (second ? b[0] - d[0] : b[0] - a[0]) / 5;
    const ay = (second ? b[1] - d[1] : b[1] - a[1]) / 5;
    const bx = (second ? d[0] - a[0] : d[0] - b[0]) / 4;
    const by = (second ? d[1] - a[1] : d[1] - b[1]) / 4;
    g.save();
    g.beginPath();
    g.moveTo(...a);
    g.lineTo(...b);
    g.lineTo(...d);
    g.closePath();
    g.clip();
    g.transform(
      ax / 4,
      ay / 4,
      bx / 4,
      by / 4,
      a[0] - ax * sx - bx * sy,
      a[1] - ay * sx - by * sy,
    );
    g.drawImage(image, 0, 0);
    g.restore();
  }
  function armyStandard(g, u) {
    const cloth = standardCloth(u),
      anchor = cloth.anchor;
    // Foreshorten cloth depth independently of elevation. Rear-facing resting
    // tails must still read as hanging down, rather than rising behind the pole.
    const local = (p) => [
      (p.x - u.x) / 0.72,
      (anchor.y + (p.y - anchor.y) * 0.35 - (p.z || 0) - u.y) / 0.72,
    ];
    const tip = local(anchor);
    line(
      g,
      [
        [tip[0], tip[1] - 3],
        [tip[0], tip[1] + 62],
      ],
      1.8,
      "#695d43",
    );
    ellipse(g, tip[0], tip[1] - 4, 2, 2, "#b9a578");
    const color =
      u.team === 1
        ? C.green
        : u.team === 3
          ? "#b18b3b"
          : u.team === 2
            ? "#9a917e"
            : C.red;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 16; c++) {
        const nodes = [
          cloth.rows[r][c],
          cloth.rows[r][c + 1],
          cloth.rows[r + 1][c + 1],
          cloth.rows[r + 1][c],
        ].filter(Boolean);
        if (nodes.length < 3) continue;
        const shape = nodes.map(local);
        polygon(g, shape, color);
        // Subpixel overlap seals antialiased mesh seams without outlining cells.
        g.strokeStyle = color;
        g.lineWidth = 0.65;
        g.stroke();
        const slope = (nodes[1].y - nodes[0].y) / 5;
        polygon(
          g,
          shape,
          `rgba(${slope > 0 ? "0,0,0" : "255,239,209"},${Math.min(0.24, Math.abs(slope) * 0.12)})`,
        );
        // Warp all five crosses onto the fabric, keeping the complete emblem
        // inside the hem and allowing individual folds to deform the stitching.
        if (c >= 3 && c <= 5 && nodes.length === 4) {
          const emblem = standardEmblem(u.team);
          clothEmblemTriangle(
            g,
            emblem,
            [shape[0], shape[1], shape[2]],
            c,
            r,
            false,
          );
          clothEmblemTriangle(
            g,
            emblem,
            [shape[0], shape[2], shape[3]],
            c,
            r,
            true,
          );
        }
      }
    for (const r of [0, 4]) line(g, cloth.rows[r].map(local), 0.75, "#d1ae72");
    for (const r of [0, 1, 2, 3]) {
      const a = cloth.rows[r].at(-1),
        b = cloth.rows[r + 1].at(-1);
      line(g, [local(a), local(b)], 0.8, "#d1ae72");
    }
  }
  const particleImages = new Map(),
    particleTints = new Map();
  for (const name of [
    "smoke_01",
    "smoke_04",
    "dirt_01",
    "spark_01",
    "light_02",
    "flame_01",
  ])
    if (typeof Image !== "undefined") {
      const img = new Image();
      img.src = `assets/particles/${name}.png`;
      particleImages.set(name, img);
    }
  function particle(g, p) {
    const img = particleImages.get(p.sprite);
    if (!img?.complete || !img.naturalWidth) {
      ellipse(g, p.x, p.y, p.r, p.r, p.color);
      return;
    }
    const key = p.sprite + p.color;
    let tint = particleTints.get(key);
    if (!tint) {
      tint = document.createElement("canvas");
      tint.width = tint.height = 128;
      const cg = tint.getContext("2d");
      cg.drawImage(img, 0, 0, 128, 128);
      cg.globalCompositeOperation = "source-in";
      cg.fillStyle = p.color;
      cg.fillRect(0, 0, 128, 128);
      particleTints.set(key, tint);
    }
    const radius = p.r * (1 + ((p.growth || 0) * p.t) / p.life);
    g.save();
    g.translate(p.x, p.y);
    g.rotate((p.angle || 0) + (p.spin || 0) * p.t);
    if (p.glow) g.globalCompositeOperation = "lighter";
    g.drawImage(tint, -radius, -radius, radius * 2, radius * 2);
    g.restore();
  }
  function banner(g, x, y, team, time, scale = 1) {
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    x = 0;
    y = 0;
    line(
      g,
      [
        [x, y - 10],
        [x, y + 25],
      ],
      1.6,
      "#695d43",
    );
    ellipse(g, x, y - 11, 1.8, 1.8, "#b9a578");
    const color =
      team === 3
        ? "#b18b3b"
        : team === 2
          ? "#9a917e"
          : team === 1
            ? C.green
            : C.red;
    const gust =
      0.7 + Math.sin(time * 0.57) * 0.18 + Math.sin(time * 0.23) * 0.12;
    const wave = (t) =>
      (Math.sin(time * 2.1 - t * 5.4) * 2.8 +
        Math.sin(time * 3.3 - t * 9) * 0.8) *
      t *
      gust;
    for (let i = 0; i < 10; i++) {
      const a = i / 10,
        b = (i + 1) / 10;
      polygon(
        g,
        [
          [x + 1 + a * 21, y - 8 + wave(a)],
          [x + 1 + b * 21, y - 8 + wave(b)],
          [x + 1 + b * 21, y + 9 + wave(b) - b * 2],
          [x + 1 + a * 21, y + 9 + wave(a) - a * 2],
        ],
        color,
      );
      polygon(
        g,
        [
          [x + 1 + a * 21, y - 8 + wave(a)],
          [x + 1 + b * 21, y - 8 + wave(b)],
          [x + 1 + b * 21, y + 9 + wave(b) - b * 2],
          [x + 1 + a * 21, y + 9 + wave(a) - a * 2],
        ],
        `rgba(${Math.cos(time * 2.6 - a * 6) > 0 ? "255,239,209" : "0,0,0"},${Math.abs(Math.cos(time * 2.6 - a * 6)) * 0.14})`,
      );
    }
    const cy = y + wave(0.5);
    if (team === 0) cross(g, x + 11, cy, 4, C.cream);
    else if (team === 3) sigil(g, x + 11, cy, 4, team, C.cream);
    else if (team === 1) {
      g.strokeStyle = C.cream;
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(x + 11, cy, 4, 0.7, 5.3);
      g.stroke();
    }
    g.restore();
  }

  function tree(g, x, y, scale = 1, palm = false) {
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    ellipse(g, 5, 7, 26, 24, "#293e2630");
    if (palm) {
      for (let i = 0; i < 9; i++) {
        const a = (i * Math.PI * 2) / 9;
        polygon(
          g,
          [
            [0, 0],
            [Math.cos(a - 0.3) * 12, Math.sin(a - 0.3) * 12],
            [Math.cos(a) * 31, Math.sin(a) * 31],
            [Math.cos(a + 0.2) * 14, Math.sin(a + 0.2) * 14],
          ],
          i % 2 ? "#65844c" : "#789354",
        );
      }
      ellipse(g, 0, 0, 5, 5, "#aa955d");
    } else {
      ellipse(g, 0, 0, 24, 23, "#245b32");
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        ellipse(
          g,
          Math.cos(a) * 13,
          Math.sin(a) * 11,
          11,
          12,
          i % 3 === 0 ? "#79a747" : i % 2 ? "#599334" : "#397b30",
        );
      }
      ellipse(g, -3, -4, 10, 10, "#8cba50");
      line(
        g,
        [
          [-5, -7],
          [0, -10],
          [4, -8],
        ],
        1,
        "#c3bf8670",
      );
    }
    g.restore();
  }
  function resource(g, n, time) {
    if (n.remaining <= 0) return;
    g.save();
    g.translate(n.x, n.y);
    if (n.kind === "wood") {
      if (n.remaining > 0) {
        ellipse(g, 0, 0, 38, 37, n.palm ? "#446b36" : "#285c32");
        tree(g, 0, 0, 1.45, n.palm);
        if (n.snow)
          for (let i = 0; i < 5; i++) {
            const a = i * 2.4;
            ellipse(
              g,
              Math.cos(a) * 16,
              Math.sin(a) * 15 - 4,
              15,
              12,
              "#d0dfd0",
            );
          }
        for (let i = 0; i < 8; i++) {
          const a = i * 2.4;
          ellipse(
            g,
            Math.cos(a) * 26,
            Math.sin(a) * 25,
            10,
            11,
            i % 2 ? "#467c32" : "#5b903b",
          );
        }
      } else {
        ellipse(g, 0, 0, 9, 7, "#a58b5d");
        ellipse(g, 0, 0, 5, 4, "#c4aa77");
      }
    } else if (n.kind === "food") {
      ellipse(g, 3, 4, 25, 22, "#23352240");
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        ellipse(
          g,
          Math.cos(a) * 13,
          Math.sin(a) * 11,
          11,
          9,
          i % 2 ? "#366d32" : "#548539",
        );
      }
      for (let i = 0; i < 28; i++) {
        const a = i * 2.399,
          r = Math.sqrt(i / 28) * 21,
          x = Math.cos(a) * r,
          y = Math.sin(a) * r;
        polygon(
          g,
          [
            [x - 3, y],
            [x, y - 3],
            [x + 4, y],
            [x, y + 2],
          ],
          i % 3 ? "#689446" : "#8cab55",
        );
        line(
          g,
          [
            [x - 2, y],
            [x + 2, y],
          ],
          0.5,
          "#274b28",
        );
      }
      for (let i = 0; i < 11; i++) {
        const x = Math.cos(i * 2.399) * Math.sqrt((i + 1) / 12) * 20,
          y = Math.sin(i * 2.399) * Math.sqrt((i + 1) / 12) * 18;
        line(
          g,
          [
            [x, y],
            [x + 1, y - 3],
          ],
          0.7,
          "#304923",
        );
        ellipse(g, x + 0.8, y + 0.8, 2.7, 2.7, "#782c24");
        ellipse(g, x, y, 2.5, 2.5, i % 2 ? "#d7602c" : "#bd3a29");
        ellipse(g, x - 0.7, y - 0.8, 0.7, 0.7, "#f7b47a");
      }
    } else {
      ellipse(g, 4, 5, 27, 23, "#39432a30");
      polygon(
        g,
        [
          [-23, -6],
          [-11, -24],
          [12, -21],
          [28, 1],
          [18, 21],
          [-15, 19],
        ],
        n.kind === "gold" ? "#8c886a" : "#949b8a",
        "#687363",
      );
      polygon(
        g,
        [
          [-23, -6],
          [-11, -24],
          [12, -21],
          [4, -3],
        ],
        n.kind === "gold" ? "#b0a67b" : "#bec0a5",
      );
      if (n.remaining > 0 && n.kind === "gold")
        for (let i = 0; i < 6; i++) {
          const x = Math.cos(i * 2.3) * 15,
            y = Math.sin(i * 2.3) * 12;
          polygon(
            g,
            [
              [x - 3, y],
              [x, y - 4],
              [x + 4, y + 1],
              [x, y + 4],
            ],
            "#d8b55c",
            "#948146",
          );
        }
      for (let i = 0; i < 12; i++) {
        const x = Math.sin(i * 7.3 + n.id) * 20,
          y = Math.cos(i * 4.1 + n.id) * 16;
        line(
          g,
          [
            [x - 3, y - 2],
            [x, y + 1],
            [x + 4, y - 1],
          ],
          0.8,
          n.kind === "gold" ? "#514d3944" : "#56685b55",
        );
        ellipse(g, x, y, 1, 0.6, "#d6dcc166");
      }
      if (n.kind === "gold") {
        for (const path of [
          [
            [-14, -13],
            [-4, -6],
            [2, -9],
            [9, 1],
            [17, 7],
          ],
          [
            [-4, -6],
            [-8, 5],
            [-2, 11],
          ],
        ]) {
          line(g, path, 2.3, "#906a2e");
          line(g, path, 1.1, "#efd36a");
        }
      } else {
        line(
          g,
          [
            [-14, 9],
            [-5, 3],
            [5, 6],
            [18, -1],
          ],
          1.2,
          "#617263",
        );
        line(
          g,
          [
            [-5, 3],
            [-2, -7],
            [10, -14],
          ],
          0.8,
          "#e0dfc5",
        );
      }
    }
    g.restore();
  }
  // Fallen equipment shares the living units' cloth, armor, and heraldry.
  function corpse(g, u) {
    g.save();
    g.rotate((u.angle || 0) + Math.PI / 2 + 0.65);
    g.scale(0.72, 0.72);
    const civilian = u.type === "worker" || u.type === "civilian";
    const color =
      u.team === 1
        ? C.green
        : u.team === 3
          ? "#ad873a"
          : u.team === 2
            ? "#b99b63"
            : C.red;
    const cloth =
      u.type === "chaplain" && u.team !== 1
        ? C.cream
        : u.rank > 0 && u.team === 0
          ? "#f0e5c9"
          : color;
    const trim = u.rank > 1 ? C.gold : "#d4d9cb";
    if (u.type === "knight") {
      ellipse(g, 8, 5, 13, 23, u.team === 1 ? "#7b6a4f" : "#bca681");
      ellipse(g, 10, -19, 6, 10, "#ae9c78");
      for (const [x, y, dx] of [
        [-3, -8, -13],
        [18, -9, 28],
        [-2, 17, -12],
        [17, 18, 28],
      ]) {
        line(
          g,
          [
            [x, y],
            [dx, y + 7],
          ],
          4,
          "#69593e",
        );
        ellipse(g, dx, y + 8, 3, 2, "#403a30");
      }
      line(
        g,
        [
          [9, 26],
          [17, 34],
        ],
        3,
        "#766246",
      );
      rect(g, 0, 0, 17, 17, cloth);
      sigil(g, 8, 8, 4, u.team);
      g.translate(-13, 5);
    }
    ellipse(g, 1, 8, 15, 10, "#211d172b");
    line(
      g,
      [
        [-3, 8],
        [-10, 19],
        [-16, 21],
      ],
      5,
      "#5a513c",
    );
    line(
      g,
      [
        [4, 8],
        [11, 17],
        [17, 15],
      ],
      5,
      "#5a513c",
    );
    line(
      g,
      [
        [-5, 0],
        [-15, 5],
        [-20, 1],
      ],
      5,
      civilian ? "#bfa37d" : "#a8ad96",
    );
    line(
      g,
      [
        [5, 0],
        [14, -5],
        [20, -1],
      ],
      5,
      civilian ? "#bfa37d" : "#a8ad96",
    );
    ellipse(g, 0, 2, 8, 11, cloth);
    if (!civilian) {
      for (const x of [-6, 6])
        for (let y = -4; y < 8; y += 3) ellipse(g, x, y, 0.8, 0.8, trim);
      sigil(g, 0, 3, 3, u.team, u.rank > 0 && u.team === 0 ? C.red : C.cream);
    } else if (u.team !== 2) sigil(g, 0, 4, 3, u.team, C.cream);
    line(
      g,
      [
        [-7, 8],
        [7, 8],
      ],
      1.5,
      "#65503a",
    );
    ellipse(
      g,
      -2,
      -11,
      5,
      5,
      civilian ? "#ceb18a" : u.type === "archer" ? "#847b50" : "#bfc7b5",
    );
    if (!civilian && !["archer", "chaplain"].includes(u.type)) {
      line(
        g,
        [
          [-3, -16],
          [-1, -7],
        ],
        1.3,
        "#687767",
      );
      ellipse(g, -22, 10, 6, 8, color);
      sigil(g, -22, 10, 3, u.team);
      line(
        g,
        [
          [19, 7],
          [27, -14],
        ],
        2,
        "#eef0d8",
      );
      line(
        g,
        [
          [18, 2],
          [24, 5],
        ],
        2,
        C.gold,
      );
    } else if (u.type === "archer") {
      g.beginPath();
      g.arc(23, 3, 13, -1.25, 1.25);
      g.strokeStyle = "#835b35";
      g.lineWidth = 2;
      g.stroke();
      line(
        g,
        [
          [27, -9],
          [27, 15],
        ],
        0.8,
        "#d6c7a2",
      );
      rect(g, -14, -4, 4, 12, "#655038");
      for (let i = 0; i < 3; i++)
        line(
          g,
          [
            [-14 + i, -7],
            [-12 + i, 5],
          ],
          0.7,
          "#ead7ad",
        );
    } else if (u.type === "chaplain") {
      line(
        g,
        [
          [18, 18],
          [24, -19],
        ],
        2,
        "#906e43",
      );
      if (u.team === 1) sigil(g, 24, -18, 5, u.team, C.gold);
      else cross(g, 24, -18, 5, C.gold);
    } else {
      line(
        g,
        [
          [18, 16],
          [25, -4],
        ],
        2,
        "#80613c",
      );
      line(
        g,
        [
          [20, -5],
          [30, 0],
        ],
        3,
        "#8f9987",
      );
    }
    if (u.shattered) {
      ellipse(g, 5, 8, 5, 3, "#79202b");
      line(
        g,
        [
          [12, 18],
          [19, 22],
        ],
        3,
        "#62221d",
      );
    }
    g.restore();
  }
  function unit(g, u, time, drawAngle = null) {
    g.save();
    g.rotate(
      (drawAngle ??
        (u.type === "archer" && u.strike > 0 && Number.isFinite(u.aimAngle)
          ? u.aimAngle
          : u.angle)) +
        Math.PI / 2,
    );
    const neutral = u.team === 2,
      red =
        u.team === 3
          ? "#ad873a"
          : u.team === 1
            ? C.green
            : neutral
              ? "#b99b63"
              : C.red,
      step = u.moving ? Math.sin(u.anim) * 3 : 0;
    const civilian = u.type === "worker" || u.type === "civilian";
    const trim = (u.rank || 0) > 1 ? C.gold : "#d4d9cb";
    const cloth = u.team === 1 ? "#1b7354" : u.rank > 0 ? "#f0e5c9" : red;
    if (u.type === "knight") {
      ellipse(g, 3, 3, 12, 23, "#403d3020");
      ellipse(g, 0, 2, 10, 19, u.team === 1 ? "#7b6a4f" : "#bca681");
      ellipse(g, 0, -20, 6, 10, "#ae9c78");
      polygon(
        g,
        [
          [-5, -26],
          [-6, -34],
          [-1, -28],
        ],
        "#6b5941",
      );
      polygon(
        g,
        [
          [3, -27],
          [6, -34],
          [6, -25],
        ],
        "#6b5941",
      );
      for (const [x, y] of [
        [-9, -11],
        [9, -10],
        [-9, 15],
        [9, 14],
      ])
        ellipse(g, x, y + step * (x < 0 ? 1 : -1), 3, 5, "#69593e");
      line(
        g,
        [
          [0, 20],
          [1, 31],
        ],
        3,
        "#766246",
      );
      rect(g, -9, -6, 18, 22, cloth);
      if (u.rank > 0) {
        line(
          g,
          [
            [-8, -5],
            [-8, 15],
            [8, 15],
            [8, -5],
          ],
          1.2,
          trim,
        );
        sigil(g, 0, 5, 5, u.team, u.team === 0 ? C.red : C.gold);
      }
      sigil(g, 0, 5, 5, u.team);
      ellipse(g, -8, 0, 4, 6, "#b9b8a0");
      ellipse(g, 8, 0, 4, 6, "#b9b8a0");
      ellipse(g, 0, -5, 6, 7, "#c5c7b5");
      line(
        g,
        [
          [1, -10],
          [1, 0],
        ],
        1.2,
        "#737d75",
      );
      line(
        g,
        [
          [12, 1],
          [15, -26],
        ],
        2,
        "#dedfd0",
      );
      g.restore();
      return;
    }
    ellipse(g, -4, 8 + step, 3, 4, "#5a513c");
    ellipse(g, 4, 8 - step, 3, 4, "#5a513c");
    ellipse(
      g,
      0,
      1,
      8,
      10,
      civilian
        ? neutral
          ? "#bfb38a"
          : red
        : u.type === "chaplain" && u.team !== 1
          ? C.cream
          : red,
    );
    ellipse(g, -8, -1, 4, 6, civilian ? "#bfa37d" : "#a8ad96");
    ellipse(g, 8, -1, 4, 6, civilian ? "#bfa37d" : "#a8ad96");
    if (civilian && !neutral) {
      rect(g, -5, 0, 10, 8, red);
      sigil(g, 0, 4, 3, u.team, C.cream);
      line(
        g,
        [
          [-6, 7],
          [6, 7],
        ],
        1.5,
        "#67482d",
      );
    }
    if (!civilian) {
      for (let i = 0; i < 5; i++)
        for (const x of [-7, 7]) ellipse(g, x, -3 + i * 2, 0.7, 0.7, trim);
      line(
        g,
        [
          [-6, 7],
          [6, 7],
        ],
        1.5,
        "#65503a",
      );
      rect(g, -1, 6, 2, 3, C.gold);
      if (u.rank > 0) {
        rect(g, -5, 0, 10, 10, cloth);
        sigil(g, 0, 5, 3, u.team, u.team === 0 ? C.red : C.gold);
        line(
          g,
          [
            [-6, 0],
            [-6, 10],
            [6, 10],
            [6, 0],
          ],
          0.8,
          trim,
        );
      } else if (u.team === 0) jerusalemCross(g, 0, 4, 3, C.cream);
    }
    ellipse(
      g,
      0,
      -4,
      6,
      6,
      civilian ? "#ceb18a" : u.type === "archer" ? "#847b50" : "#bfc7b5",
    );
    if (!civilian && u.type !== "archer" && u.type !== "chaplain") {
      line(
        g,
        [
          [0, -10],
          [0, 1],
        ],
        1.5,
        "#687767",
      );
      ellipse(g, -11, 1, 5, 8, red);
      sigil(g, -11, 1, 3, u.team);
      const swing = u.strike > 0 ? Math.sin(u.strike * 15) * 7 : 0;
      line(
        g,
        [
          [11, 0],
          [15 + swing, -17],
        ],
        2,
        "#eef0d8",
      );
      line(
        g,
        [
          [11, -4],
          [17, 0],
        ],
        2,
        C.gold,
      );
    } else if (u.type === "archer") {
      const draw = u.strike > 0 ? Math.sin(u.strike * 9) * 3 : 0;
      // Quiver stays behind the shoulder; the bow and bolt face the target.
      rect(g, -7, 2, 4, 10, "#655038");
      for (let i = 0; i < 3; i++)
        line(
          g,
          [
            [-6 + i, 5],
            [-7 + i, -2],
          ],
          0.7,
          "#ead7ad",
        );
      ellipse(g, -6, -9, 2.5, 3, "#c5a680");
      ellipse(g, 5, -7 + draw, 2.5, 3, "#c5a680");
      if (u.rank > 0) {
        line(
          g,
          [
            [0, 0],
            [0, -24],
          ],
          3,
          "#835b35",
        );
        line(
          g,
          [
            [-13, -16],
            [13, -16],
          ],
          3,
          trim,
        );
        line(
          g,
          [
            [-13, -16],
            [0, -10 + draw],
            [13, -16],
          ],
          0.7,
          C.cream,
        );
      } else {
        g.strokeStyle = C.wood;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, -7, 12, Math.PI + 0.35, Math.PI * 2 - 0.35);
        g.stroke();
        line(
          g,
          [
            [-11, -11],
            [0, -8 + draw],
            [11, -11],
          ],
          0.7,
          C.cream,
        );
      }
      line(
        g,
        [
          [0, -7 + draw],
          [0, -26],
        ],
        1,
        "#d4bd8c",
      );
      polygon(
        g,
        [
          [0, -29],
          [-2, -24],
          [2, -24],
        ],
        "#dbe3dd",
      );
    } else if (u.type === "chaplain") {
      if (u.team === 1) ellipse(g, 0, -5, 6, 7, C.green);
      else
        polygon(
          g,
          [
            [-5, -7],
            [0, -13],
            [5, -7],
            [5, 1],
            [-5, 1],
          ],
          C.cream,
          "#baa26c",
        );
      sigil(g, 0, -5, 3, u.team, u.team === 1 ? C.gold : C.red);
      line(
        g,
        [
          [12, 8],
          [12, -15],
        ],
        2,
        C.gold,
      );
      sigil(g, 12, -12, 3, u.team, C.gold);
    } else if (u.job && ["gather", "clear"].includes(u.job.kind)) {
      const phase = u.workPhase || 0,
        swing = u.working ? Math.sin(phase * Math.PI * 2) * 0.65 : 0;
      if (
        u.job.resource === "wood" ||
        u.job.resource === "gold" ||
        u.job.resource === "stone"
      ) {
        g.save();
        g.translate(8, -1);
        g.rotate(u.working ? swing : 0.8);
        line(
          g,
          [
            [0, 7],
            [0, -26],
          ],
          2.5,
          "#916039",
        );
        if (u.job.resource === "wood")
          polygon(
            g,
            [
              [0, -26],
              [10, -29],
              [11, -19],
              [0, -21],
            ],
            "#dae4ea",
            "#314552",
          );
        else
          line(
            g,
            [
              [-10, -23],
              [-4, -27],
              [8, -25],
              [12, -20],
            ],
            3,
            "#c5d9e5",
          );
        ellipse(g, 0, -7, 3, 3, "#e8bc8c");
        g.restore();
        if (u.working && phase > 0.7 && phase < 0.95) {
          const k = (phase - 0.7) * 45;
          for (let i = 0; i < 4; i++)
            ellipse(
              g,
              8 + (i - 1.5) * k,
              -30 + i * 3 - k,
              1.6,
              1.1,
              u.job.resource === "wood"
                ? "#efb476"
                : u.job.resource === "gold"
                  ? "#ffd152"
                  : "#d8e9ef",
            );
        }
      } else {
        // Pick fruit by hand; reap farm crops with a curved sickle.
        const reach = u.working ? (1 - Math.cos(phase * Math.PI * 2)) * 8 : 0;
        ellipse(g, 8, -8 - reach, 3, 3, "#e8bc8c");
        ellipse(g, -9, -4 - reach * 0.5, 3, 3, "#e8bc8c");
        ellipse(g, -10, 7, 7, 5, "#c18445");
        ellipse(g, -10, 7, 5, 3, "#663d26");
        for (let i = 0; i < 3; i++)
          ellipse(
            g,
            -13 + i * 3,
            6,
            2,
            2,
            u.gatherSource === "sowing" ? "#d1b76c" : "#d9472c",
          );
        if (u.gatherSource === "sowing" && u.working)
          for (let i = 0; i < 4; i++)
            ellipse(g, 8 + i * 2, -14 - reach + i * 3, 1, 1, "#dbbd70");
        if (u.gatherSource === "farm") {
          line(
            g,
            [
              [8, -12 - reach],
              [12, -18 - reach],
            ],
            2,
            "#a87337",
          );
          g.strokeStyle = "#e4e9da";
          g.lineWidth = 2;
          g.beginPath();
          g.arc(8, -22 - reach, 6, -1.8, 1.2);
          g.stroke();
        } else if (u.working && phase > 0.45 && phase < 0.7)
          ellipse(g, 8, -8 - reach, 2.5, 2.5, "#df452c");
      }
    } else if (u.working) {
      const swing = Math.sin((u.workPhase || 0) * Math.PI * 2) * 0.8;
      g.save();
      g.translate(8, -1);
      g.rotate(swing);
      line(
        g,
        [
          [0, 5],
          [0, -15],
        ],
        2.5,
        C.wood,
      );
      rect(g, -5, -18, 12, 6, "#bbc6bc", "#637266");
      ellipse(g, 0, -4, 3, 3, "#e8bc8c");
      g.restore();
    }
    if (u.carry > 0) {
      if (u.carryType === "wood") {
        for (let i = 0; i < 3; i++) {
          rect(g, -8 + i * 5, 3, 4, 14, "#9b552e");
          ellipse(g, -6 + i * 5, 4, 2, 2, "#ecc089");
        }
        line(
          g,
          [
            [-8, 10],
            [7, 10],
          ],
          1.5,
          "#ead6a7",
        );
      } else if (u.carryType === "food") {
        ellipse(g, 0, 10, 8, 6, "#b27838");
        ellipse(g, 0, 8, 6, 4, "#654126");
        for (let i = 0; i < 4; i++)
          ellipse(g, -4 + i * 2.8, 7 + (i % 2) * 2, 2.5, 2.5, "#e3542c");
      } else {
        ellipse(g, 0, 10, 8, 6, "#86603b");
        for (let i = 0; i < 3; i++)
          polygon(
            g,
            [
              [-6 + i * 4, 9],
              [-3 + i * 4, 4],
              [i * 4, 8],
              [-3 + i * 4, 12],
            ],
            u.carryType === "gold" ? "#f3bd34" : "#b0c8d8",
            "#4e5d63",
          );
      }
    }
    g.restore();
  }
  function wallStroke(g, points, width, color) {
    g.strokeStyle = color;
    g.lineWidth = width;
    // Connected curtains share flat midpoint seams and angular corner joins.
    g.lineCap = "butt";
    g.lineJoin = "bevel";
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  function gear(g, x, y, r, angle) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    const points = [];
    for (let i = 0; i < 48; i++) {
      const a = (i * Math.PI) / 24,
        rr = i % 4 < 2 ? r : r * 0.82;
      points.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    polygon(g, points, "#5d625f", "#222c2d");
    ellipse(g, 0, 0, r * 0.7, r * 0.7, "#a69671");
    ellipse(g, 0, 0, r * 0.53, r * 0.53, "#4e514a");
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      line(
        g,
        [
          [Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22],
          [Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62],
        ],
        3,
        "#c8b88f",
      );
    }
    ellipse(g, 0, 0, 4, 4, "#e5d8ac");
    g.restore();
  }
  function beam(g, a, b, width = 10) {
    line(g, [a, b], width + 3, "#3a2d22");
    line(g, [a, b], width, "#ad8651");
    line(
      g,
      [
        [a[0] - 1, a[1] - 2],
        [b[0] - 1, b[1] - 2],
      ],
      2,
      "#dfbc80",
    );
    for (const p of [a, b]) {
      ellipse(g, p[0], p[1], width * 0.5, width * 0.5, "#52534b");
      ellipse(g, p[0] - 1, p[1] - 1, 1.4, 1.4, "#d6cba7");
    }
  }
  function greatEngine(g, b, time) {
    window.CruciataSiegeArt.greatEngine(g, b, time);
  }
  function siegeMachine(g, u, time, angle) {
    window.CruciataSiegeArt.siegeMachine(g, u, time, angle);
  }
  function caravan(g, u, time, angle) {
    g.save();
    g.rotate(angle + Math.PI / 2);
    const walk = u.moving ? Math.sin(time * 9 + (u.id || 0)) * 2 : 0;
    ellipse(g, 5, 5, 29, 48, "#27302240");
    // Hooped canvas wagon, layered timber bed, iron tyres, and rotating spokes.
    for (const x of [-23, 23])
      for (const y of [-12, 20]) {
        g.save();
        g.translate(x, y);
        rect(g, -5, -10, 10, 20, "#282b27", "#0f1615");
        ellipse(g, 0, 0, 4, 8, "#816843");
        for (let i = 0; i < 4; i++) {
          const a = (u.moving ? time * 5 : 0) + (i * Math.PI) / 2;
          line(
            g,
            [
              [Math.cos(a) * 3, Math.sin(a) * 7],
              [-Math.cos(a) * 3, -Math.sin(a) * 7],
            ],
            1,
            "#d8b782",
          );
        }
        ellipse(g, 0, 0, 2, 2, "#d7c8a1");
        g.restore();
      }
    rect(g, -20, -25, 40, 56, "#795f3e", "#3d3226");
    for (let y = -23; y < 30; y += 7)
      line(
        g,
        [
          [-19, y],
          [19, y],
        ],
        1,
        "#c39760",
      );
    for (const x of [-18, 18]) beam(g, [x, -28], [x, 32], 4);
    g.save();
    g.translate(0, walk * 0.3);
    polygon(
      g,
      [
        [-17, -27],
        [14, -30],
        [21, -21],
        [21, 24],
        [13, 30],
        [-18, 27],
        [-23, 18],
        [-23, -17],
      ],
      u.type === "pilgrim" ? "#e3d4af" : "#b79b70",
      "#695a41",
    );
    for (let y = -22; y < 27; y += 9) {
      line(
        g,
        [
          [-20, y],
          [18, y - 2],
        ],
        1,
        "#8c795954",
      );
      line(
        g,
        [
          [-14, y - 1],
          [11, y - 3],
        ],
        1,
        "#fff1c390",
      );
    }
    for (const x of [-15, 14])
      line(
        g,
        [
          [x, -28],
          [x, 27],
        ],
        1,
        "#8b7758",
      );
    for (const x of [-19, 18])
      for (let y = -21; y < 26; y += 11) {
        ellipse(g, x, y, 1.5, 1.5, "#735539");
        line(
          g,
          [
            [x, y],
            [x * 1.1, y + 5],
          ],
          1,
          "#c7ad79",
        );
      }
    if (u.type === "pilgrim") jerusalemCross(g, -2, -1, 8, "#9c4431");
    else {
      rect(g, -13, -14, 14, 23, "#976c3e", "#583f28");
      rect(g, 2, -8, 13, 21, "#c4a16a", "#6b5638");
      for (const x of [-7, 8])
        line(
          g,
          [
            [x, -14],
            [x, 16],
          ],
          2,
          "#d9c18e",
        );
    }
    g.restore();
    for (const sign of [-1, 1])
      line(
        g,
        [
          [sign * 11, -25],
          [sign * 10, -58],
        ],
        3,
        "#ad8a56",
      );
    // Draft horse: shoulder, rump, neck, ears, mane, tack and alternating legs.
    for (const sign of [-1, 1])
      for (const y of [-53, -39]) {
        line(
          g,
          [
            [sign * 6, y],
            [sign * (11 + walk * 0.6), y + walk * sign],
          ],
          3,
          "#514336",
        );
        ellipse(g, sign * 12, y + walk * sign, 2, 2, "#272825");
      }
    ellipse(g, 0, -46 + walk * 0.2, 10, 17, "#94785a");
    ellipse(g, -2, -53, 8, 11, "#b3936b");
    ellipse(g, 0, -63, 6, 10, "#9c7c56");
    ellipse(g, 0, -70, 5, 7, "#b4946e");
    for (const x of [-4, 4])
      polygon(
        g,
        [
          [x, -72],
          [x - 2, -80],
          [x + 2, -76],
        ],
        "#674c36",
      );
    line(
      g,
      [
        [0, -39],
        [3, -29 + walk],
      ],
      3,
      "#4a3c2d",
    );
    line(
      g,
      [
        [-7, -50],
        [7, -50],
      ],
      3,
      "#503d2a",
    );
    line(
      g,
      [
        [-5, -65],
        [5, -65],
      ],
      2,
      "#503d2a",
    );
    line(
      g,
      [
        [-5, -65],
        [-13, -20],
      ],
      1,
      "#dac298",
    );
    line(
      g,
      [
        [5, -65],
        [13, -20],
      ],
      1,
      "#dac298",
    );
    for (let y = -68; y < -40; y += 4)
      line(
        g,
        [
          [-2, y],
          [1, y + 4],
        ],
        2,
        "#47372c",
      );
    ellipse(g, -2, -72, 1, 1, "#27251f");
    // Rear lantern and tied provisions.
    rect(g, -18, 27, 10, 12, "#84704a", "#40382c");
    ellipse(g, -13, 32, 3, 3, "#efbd65");
    ellipse(g, 10, 30, 7, 5, "#b99b62");
    line(
      g,
      [
        [4, 30],
        [16, 30],
      ],
      1,
      "#6e5232",
    );
    g.restore();
  }
  function islamicBuilding(g, b, time) {
    const w = b.w,
      h = b.h,
      l = -w / 2,
      t = -h / 2;
    const civic = ["towncenter", "fort", "chapel"].includes(b.kind);
    const tower = ["tower", "watchtower"].includes(b.kind);
    const arch = (x, y, size) => {
      polygon(
        g,
        [
          [x - size, y + size],
          [x - size, y],
          [x, y - size * 1.4],
          [x + size, y],
          [x + size, y + size],
        ],
        "#343e34",
        "#e0caa1",
      );
      line(
        g,
        [
          [x - size * 0.6, y + size],
          [x - size * 0.6, y],
          [x, y - size * 0.9],
          [x + size * 0.6, y],
        ],
        0.8,
        "#978563",
      );
    };
    const dome = (x, y, r) => {
      ellipse(g, x + 3, y + 7, r + 3, r * 0.73, "#343e3455");
      ellipse(g, x, y, r, r * 0.72, "#566f60", "#3b5044");
      ellipse(g, x - 2, y - 4, r * 0.91, r * 0.64, "#a3b29b", "#657b65");
      for (const k of [-0.65, -0.3, 0.3, 0.65])
        line(
          g,
          [
            [x + k * r * 0.35, y - r * 0.54],
            [x + k * r, y + r * 0.35],
          ],
          1,
          "#657d68",
        );
      ellipse(g, x - 3, y - r * 0.25, r * 0.26, r * 0.17, "#d5d7b077");
      line(
        g,
        [
          [x, y - r * 0.6],
          [x, y - r * 0.9],
        ],
        1.3,
        "#c3ab67",
      );
    };
    const minaret = (x, y, height) => {
      rect(g, x - 6, y - height, 12, height + 8, "#c0b18b", "#6b7058");
      rect(g, x + 2, y - height, 4, height + 8, "#8a896b");
      for (let v = y - height + 8; v < y; v += 9)
        line(
          g,
          [
            [x - 5, v],
            [x + 5, v],
          ],
          0.7,
          "#8f8c6c",
        );
      rect(g, x - 9, y - height + 9, 18, 5, "#ddcba0", "#6c785d");
      dome(x, y - height - 2, 8);
      arch(x, y - height + 22, 2.7);
    };
    // Plaster walls, recessed courtyards and stepped flat roof parapets replace
    // the player's pitched timber roofs, rather than merely changing heraldry.
    rect(g, l + 6, t + 10, w, h, "#34433555");
    rect(g, l, t, w, h, "#a89a75", "#59644d");
    polygon(
      g,
      [
        [l, h / 2],
        [w / 2, h / 2],
        [w / 2, h / 2 + 9],
        [l, h / 2 + 9],
      ],
      "#827c5e",
      "#59644d",
    );
    rect(g, l + 4, t + 4, w - 8, h - 8, "#d2c3a0", "#9a9676");
    for (let y = t + 9; y < h / 2; y += 10)
      for (let x = l + 7 + (Math.floor(y / 10) % 2) * 7; x < w / 2 - 6; x += 18)
        line(
          g,
          [
            [x, y],
            [Math.min(x + 14, w / 2 - 5), y],
          ],
          0.6,
          "#aaa383",
        );
    if (tower) {
      const r = Math.min(w, h) * 0.46;
      const shape = Array.from({ length: 8 }, (_, i) => [
        Math.cos((i * Math.PI) / 4 + Math.PI / 8) * r,
        Math.sin((i * Math.PI) / 4 + Math.PI / 8) * r - 8,
      ]);
      polygon(g, shape, "#c8b98e", "#6c765b");
      ellipse(g, 0, -8, r * 0.63, r * 0.53, "#7f896c", "#d8c79d");
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        rect(
          g,
          Math.cos(a) * r - 3,
          Math.sin(a) * r - 11,
          6,
          7,
          "#dfcda2",
          "#737d5d",
        );
      }
      arch(0, h / 2 - 9, Math.min(5, w * 0.12));
    } else if (civic) {
      rect(g, l + 12, t + 14, w - 24, h - 28, "#938e70", "#ebe0bb");
      rect(
        g,
        l + w * 0.23,
        t + h * 0.27,
        w * 0.54,
        h * 0.44,
        "#c5b792",
        "#777f60",
      );
      dome(0, -h * 0.1, Math.min(w * 0.23, h * 0.27));
      for (let x = l + 20; x < w / 2 - 12; x += 17) arch(x, h / 2 - 15, 5);
      for (const sign of [-1, 1])
        minaret(sign * (w / 2 - 13), -h * 0.15, Math.min(58, h * 0.45));
      if (b.kind !== "chapel") {
        for (const x of [l + 7, w / 2 - 13])
          for (const y of [t + 7, h / 2 - 13])
            rect(g, x, y, 9, 10, "#d6c49a", "#69765a");
        arch(0, h / 2 - 13, Math.min(12, w * 0.12));
      }
    } else if (["barracks", "stable", "siegeworkshop"].includes(b.kind)) {
      rect(g, l + 14, t + 13, w - 28, h - 26, "#8f8968", "#e6d5a8");
      for (let x = l + 20; x < w / 2 - 15; x += 15) {
        arch(x, t + 20, 4);
        arch(x, h / 2 - 17, 4);
      }
      rect(g, l + 8, t + 7, w - 16, 10, "#b1ae86", "#636f54");
      if (b.kind === "barracks") {
        for (let x = l + 22; x < w / 2 - 15; x += 16) {
          ellipse(g, x, 1, 4, 5, "#576c51", "#d6bb7c");
          line(
            g,
            [
              [x, 6],
              [x, 13],
            ],
            1.2,
            "#57482d",
          );
        }
      }
      if (b.kind === "stable") {
        for (let x = l + 22; x < w / 2 - 15; x += 19) {
          ellipse(g, x, 0, 7, 4, "#705338");
          ellipse(g, x + 5, -4, 3, 3, "#846447");
        }
      }
      if (b.kind === "siegeworkshop") {
        beam(g, [l + 23, 10], [w / 2 - 18, -12], 6);
        gear(g, 12, 8, 9, 0);
        rect(g, -18, 4, 22, 9, "#806640", "#433f2e");
      }
      arch(0, h / 2 - 7, 7);
    } else {
      rect(g, l + 8, t + 8, w - 16, h - 16, "#b7b08b", "#717d5c");
      rect(
        g,
        l + 12,
        t + 12,
        Math.max(8, w * 0.28),
        Math.max(7, h * 0.27),
        "#807e60",
        "#ded3ab",
      );
      dome(w * 0.19, -h * 0.16, Math.min(11, w * 0.17));
      arch(-w * 0.1, h / 2 - 8, Math.min(6, w * 0.13));
      for (const x of [l + 8, w / 2 - 10])
        rect(g, x, 1, 3, 7, "#344a38", "#d5c5a0");
      if (b.kind === "mill") {
        gear(g, 0, 0, 12, time * 0.35);
        beam(g, [-17, 0], [17, 0], 4);
      }
      if (["lumbercamp", "miningcamp"].includes(b.kind))
        for (let i = 0; i < 4; i++)
          rect(
            g,
            l + 8 + i * 7,
            h / 2 - 16,
            6,
            8,
            b.kind === "miningcamp" ? "#757969" : "#80613d",
            "#4c543d",
          );
    }
    // Repeating teal-and-ochre tile frieze reads across both small and large assets.
    for (let x = l + 8; x < w / 2 - 7; x += 8) {
      polygon(
        g,
        [
          [x, t + 3],
          [x + 3, t + 6],
          [x, t + 9],
          [x - 3, t + 6],
        ],
        "#517e70",
      );
    }
    banner(g, w / 2 - 7, -h / 2 + 5, b.team, time, 0.8);
  }
  function structureDamage(g, b, time) {
    const w = b.w,
      h = b.h;
    const damage = 1 - b.hp / b.maxHp;
    if (damage > 0.12) {
      for (let i = 0; i < Math.ceil(damage * 6); i++) {
        const x = Math.sin(i * 7.1 + b.id) * w * 0.32,
          y = Math.cos(i * 3.4 + b.id) * h * 0.28;
        line(
          g,
          [
            [x - 7, y - 9],
            [x, y - 3],
            [x - 3, y + 4],
            [x + 4, y + 12],
          ],
          1 + damage,
          "#332c24",
        );
        if (damage > 0.4)
          ellipse(g, x, y, 6 + damage * 6, 4 + damage * 5, "#312c24bb");
      }
      if (damage > 0.32)
        for (let i = 0; i < 3; i++) {
          const cycle = (time * 0.4 + i * 0.33) % 1,
            x = w * 0.15 + i * 7 + Math.sin(time + i) * 4,
            y = -h * 0.18 - cycle * 40;
          ellipse(
            g,
            x,
            y,
            5 + cycle * 9,
            4 + cycle * 10,
            "#252526" +
              Math.round((1 - cycle) * 80)
                .toString(16)
                .padStart(2, "0"),
          );
        }
      if (damage > 0.62)
        for (let i = 0; i < 3; i++) {
          const x = -w * 0.25 + i * w * 0.23,
            y = h * 0.15;
          const flicker = Math.sin(time * 13 + i * 4) * 2;
          ellipse(g, x, y, 5 + flicker, 8 - flicker, "#d6541bcc");
          ellipse(g, x, y + 2, 2.5, 5 + flicker, "#ffc451");
        }
      for (let i = 0; i < Math.floor(damage * 9); i++)
        rect(
          g,
          -w / 2 + ((i * 19 + b.id) % w),
          h / 2 + 3 + (i % 3) * 3,
          5,
          4,
          "#9e8c70",
        );
    }
  }
  function structure(g, b, time) {
    if (
      (b.kind === "greatengine" || b.kind === "colossus") &&
      b.progress >= 1 &&
      b.hp > 0
    ) {
      greatEngine(g, b, time);
      return;
    }
    if (b.gateSegments && b.hp > 0 && b.progress >= 1) {
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.gateAngle || 0);
      if (b.bastionGate || b.gateSegments.some((part) => part.fortified)) {
        // Broad dark abutments frame the same two-section navigable opening.
        rect(g, -52, -27, 104, 54, "#48534b", "#2b352e");
        rect(g, -49, -24, 98, 48, "#727b6c", "#3c483f");
        rect(g, -14, -28, 28, 56, b.closed ? "#594c38" : "#2c3029", "#a7ae97");
        for (const sign of [-1, 1]) {
          rect(g, sign * 35 - 15, -31, 30, 62, "#596456", "#303c34");
          rect(g, sign * 35 - 12, -27, 24, 54, "#87907a", "#455442");
          for (let y = -23; y < 26; y += 8)
            line(
              g,
              [
                [sign * 35 - 11, y],
                [sign * 35 + 11, y],
              ],
              0.8,
              "#54634f",
            );
          for (let x = sign * 35 - 12; x < sign * 35 + 13; x += 9)
            rect(g, x, -34, 6, 8, "#9ea78e", "#4b5848");
          rect(g, sign * 35 - 3, -10, 6, 19, "#2d392f", "#afaf91");
        }
        line(
          g,
          [
            [-15, -25],
            [0, -34],
            [15, -25],
          ],
          4,
          "#a2ab91",
        );
        if (b.closed)
          for (let x = -10; x <= 10; x += 5)
            line(
              g,
              [
                [x, -23],
                [x, 25],
              ],
              2,
              "#b6a36d",
            );
        rect(g, -17, -27, 34, 6, "#939d83", "#3b4b3b");
        banner(g, 35, -30, b.team, time, 0.8);
        g.restore();
        return;
      }
      structure(
        g,
        { ...b, x: 0, y: 0, w: 74, h: 42, rotation: 0, gateSegments: null },
        time,
      );
      g.restore();
      return;
    }
    if (b.progress >= 1) {
      if (
        b.kind === "watchtower" &&
        b.team !== 1 &&
        b.architecture !== "islamic" &&
        b.hp > 0
      ) {
        g.save();
        g.translate(b.x, b.y);
        for (const dx of [-12, 12])
          for (const dy of [-12, 12]) {
            rect(g, dx - 2, dy - 2, 4, 4, "#a7916a", "#493c29");
          }
        rect(g, -14, -14, 28, 28, "#8c7752", "#493c29");
        for (const y of [-10, -4, 2, 8])
          line(
            g,
            [
              [-13, y],
              [13, y],
            ],
            0.7,
            "#c7b89466",
          );
        line(
          g,
          [
            [-8, 17],
            [-8, 28],
          ],
          2,
          "#8e7953",
        );
        line(
          g,
          [
            [0, 17],
            [0, 28],
          ],
          2,
          "#8e7953",
        );
        for (const y of [18, 22, 26])
          line(
            g,
            [
              [-8, y],
              [0, y],
            ],
            1,
            "#b5a179",
          );
        banner(g, 9, -13, b.team, time);
        g.restore();
        return;
      }
    }
    if (b.wallAttachment && b.hp > 0 && b.progress >= 1)
      structure(
        g,
        {
          ...b,
          ...b.wallAttachment,
          kind: "wall",
          wallAttachment: null,
          fortified: !!(b.fortified || b.wallAttachment.fortified),
        },
        time,
      );
    g.save();
    g.translate(b.x, b.y);
    let w = b.w,
      h = b.h;
    if (b.kind === "gate" && b.rotation === 90) {
      g.rotate(Math.PI / 2);
      [w, h] = [h, w];
    }
    if (b.hp > 0 && b.kind !== "wall") {
      rect(g, -w / 2 + 6, -h / 2 + 8, w, h, "#29362528");
      rect(g, -w / 2, -h / 2, w, h, "#b9aa7e", "#74674d");
    }
    const team = b.team;
    if (b.progress < 1 && b.hp > 0) {
      const p = b.progress,
        left = -w / 2,
        top = -h / 2;
      rect(g, left - 5, top - 5, w + 10, h + 10, "#463b2b", "#b69255");
      for (let y = top + 5; y < h / 2; y += 12)
        for (let x = left + 5; x < w / 2; x += 16)
          rect(g, x, y, 12, 6, "#93836a", "#4a4437");
      // The actual structure rises from the foundation: never a placeholder bar.
      if (p > 0.16) {
        g.save();
        g.beginPath();
        g.rect(
          left - 8,
          h / 2 - (h + 16) * Math.min(1, (p - 0.16) / 0.68),
          w + 16,
          (h + 16) * Math.min(1, (p - 0.16) / 0.68),
        );
        g.clip();
        structure(
          g,
          {
            ...b,
            x: 0,
            y: 0,
            w,
            h,
            rotation: 0,
            progress: 1,
            hp: b.maxHp,
            maxHp: b.maxHp,
          },
          time,
        );
        g.restore();
      }
      const scaffold = p > 0.12 && p < 0.94;
      if (scaffold) {
        for (const x of [left - 7, w / 2 + 7]) {
          line(
            g,
            [
              [x, top - 6],
              [x, h / 2 + 6],
            ],
            4,
            "#826037",
          );
          for (let y = top; y < h / 2; y += 18) {
            line(
              g,
              [
                [x - 5, y],
                [x + 5, y + 16],
              ],
              2,
              "#c59a5f",
            );
            line(
              g,
              [
                [left - 9, y],
                [w / 2 + 9, y],
              ],
              3,
              "#b78a4f",
            );
          }
        }
        for (let i = 0; i < 5; i++)
          line(
            g,
            [
              [left - 12 + i * 3, top],
              [left - 12 + i * 3, top + 35],
            ],
            1,
            "#dab878",
          );
        line(
          g,
          [
            [left - 13, top + 12],
            [left + 2, top + 12],
            [left + 2, top + 25],
            [left - 13, top + 25],
          ],
          2,
          "#967040",
        );
      }
      // Distinct material piles and a working crane establish construction direction.
      for (let i = 0; i < 4; i++) {
        rect(g, left + 8 + i * 7, h / 2 + 7, 6, 5, "#cbb98f", "#655941");
        line(
          g,
          [
            [w / 2 - 24 + i * 5, h / 2 + 7],
            [w / 2 - 18 + i * 5, h / 2 + 17],
          ],
          3,
          "#986539",
        );
      }
      if (p > 0.4 && p < 0.9) {
        const a = Math.sin(time * 1.6) * 0.08;
        line(
          g,
          [
            [w / 2 + 8, top - 15],
            [w / 2 + 8, h / 2],
          ],
          4,
          "#5b432a",
        );
        line(
          g,
          [
            [w / 2 + 8, top - 15],
            [w / 2 - 20, top - 15 + a * 20],
          ],
          4,
          "#a57d48",
        );
        line(
          g,
          [
            [w / 2 - 20, top - 15 + a * 20],
            [w / 2 - 20, top + 15 + Math.sin(time * 1.8) * 6],
          ],
          1,
          "#dec99a",
        );
        rect(
          g,
          w / 2 - 27,
          top + 14 + Math.sin(time * 1.8) * 6,
          14,
          9,
          "#b7a68b",
        );
      }
      g.restore();
      return;
    }
    if (b.hp <= 0) {
      ellipse(g, 4, 6, w * 0.54, h * 0.5, "#282b2544");
      ellipse(g, -3, 1, w * 0.4, h * 0.38, "#655c4933");
      // Broken perimeter masonry, charred beams and roof fragments retain the building's identity.
      for (let i = 0; i < 18; i++) {
        const side = i % 4,
          t = ((i * 7) % 17) / 17;
        const x = side < 2 ? (side === 0 ? -w / 2 : w / 2) : -w / 2 + t * w,
          y = side >= 2 ? (side === 2 ? -h / 2 : h / 2) : -h / 2 + t * h;
        g.save();
        g.translate(x, y);
        g.rotate(Math.sin(i + b.id) * 0.25);
        rect(g, -5, -3, 9 + Math.sin(i) * 2, 6, "#8f8067", "#4f4e42");
        rect(g, -4, -4, 7, 3, "#c4b18c");
        g.restore();
      }
      for (let i = 0; i < 24; i++) {
        const a = i * 2.399 + b.id,
          r = Math.sqrt((i + 1) / 25),
          x = Math.cos(a) * w * 0.42 * r,
          y = Math.sin(a) * h * 0.4 * r;
        polygon(
          g,
          [
            [x - 4, y],
            [x - 1, y - 4],
            [x + 5, y - 2],
            [x + 4, y + 4],
            [x - 3, y + 3],
          ],
          i % 3 ? "#ae9c7b" : "#625e50",
          "#655f50",
        );
        line(
          g,
          [
            [x - 2, y - 2],
            [x + 3, y - 1],
          ],
          0.7,
          "#ddc9a0",
        );
        if (i % 3 === 0) {
          g.save();
          g.translate(x, y);
          g.rotate(a);
          rect(g, -2, -9, 4, 18, "#443c2e");
          line(
            g,
            [
              [-1, -8],
              [-1, 6],
            ],
            0.7,
            "#8d6c42",
          );
          g.restore();
        }
      }
      if (!["wall", "tower", "fort", "gate", "farm"].includes(b.kind)) {
        for (let i = 0; i < 8; i++) {
          const x = Math.sin(i * 4 + b.id) * w * 0.33,
            y = Math.cos(i * 7 + b.id) * h * 0.3;
          polygon(
            g,
            [
              [x - 5, y - 2],
              [x + 3, y - 5],
              [x + 7, y + 2],
              [x - 2, y + 4],
            ],
            b.kind === "siegeworkshop" ? "#5e4c3c" : "#945139",
            "#c18e66",
          );
        }
      }
      if (b.kind === "siegeworkshop") {
        for (const x of [-15, 19]) {
          ellipse(g, x, 12, 5, 6, "#42392b");
          ellipse(g, x, 12, 3, 4, "#9d8259");
        }
        line(
          g,
          [
            [-24, -19],
            [9, 26],
          ],
          4,
          "#6e4d2e",
        );
        line(
          g,
          [
            [4, -22],
            [-7, 17],
          ],
          3,
          "#ae8c58",
        );
      }
      if (["chapel", "towncenter", "fort"].includes(b.kind)) {
        rect(g, 4, -3, 18, 6, "#524530");
        sigil(g, 13, 0, 4, b.team, "#b89863");
      }
      if (b.kind === "farm")
        for (let x = -w / 2 + 8; x < w / 2; x += 10)
          line(
            g,
            [
              [x, -h / 2 + 8],
              [x, h / 2 - 8],
            ],
            3,
            "#554b3066",
          );
      g.restore();
      return;
    }
    if (b.kind === "wall") {
      const links = Object.values(b.links || {}),
        angle = b.wallAngle || 0,
        width = b.fortified ? 48 : 30;
      if (links.length === 1) links.push({ x: -links[0].x, y: -links[0].y });
      if (!links.length) {
        const r =
          Math.abs(Math.sin(angle) * Math.cos(angle)) > 0.1
            ? Math.sqrt(2) * 16
            : 16;
        links.push(
          { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
          { x: -Math.cos(angle) * r, y: -Math.sin(angle) * r },
        );
      }
      const spans =
        links.length === 2
          ? [
              [
                [links[0].x, links[0].y],
                [0, 0],
                [links[1].x, links[1].y],
              ],
            ]
          : links.map((arm) => [
              [0, 0],
              [arm.x, arm.y],
            ]);
      for (const [band, color, ox, oy] of [
        [width + 4, "#292d2844", 4, 8],
        [width, b.fortified ? "#37443a" : "#504c3f", 0, 0],
        [width - 4, b.fortified ? "#727c6b" : "#d1bd92", 0, 0],
        [width - 14, b.fortified ? "#4d594c" : "#8a846e", 0, 0],
      ]) {
        for (const span of spans)
          wallStroke(
            g,
            span.map(([x, y]) => [x + ox, y + oy]),
            band,
            color,
          );
        if (links.some((arm) => Math.hypot(arm.x, arm.y) < 1)) {
          g.save();
          g.translate(ox, oy);
          g.rotate(angle);
          rect(g, -16, -band / 2, 32, band, color);
          g.restore();
        }
      }
      for (const arm of links) {
        g.save();
        g.rotate(Math.atan2(arm.y, arm.x));
        const d = Math.hypot(arm.x, arm.y);
        for (const sign of [-1, 1])
          line(
            g,
            [
              [0, sign * (width / 2 - 9)],
              [d, sign * (width / 2 - 9)],
            ],
            2,
            "#5f5e4e",
          );
        for (let x = 3; x < d; x += 9) {
          for (const sign of [-1, 1])
            rect(
              g,
              x - 3,
              sign * (width / 2 - 5) - 3,
              6,
              6,
              b.fortified ? "#9ba38b" : "#e0d1ac",
              "#766f59",
            );
          for (let y = -width / 2 + 7; y < width / 2 - 6; y += 8)
            line(
              g,
              [
                [x - 4, y],
                [x + 3, y],
              ],
              0.7,
              "#625e4b",
            );
        }
        if (b.fortified) {
          for (let x = 7; x < d; x += 15)
            rect(g, x - 2, -5, 4, 10, "#6b7369", "#d0bd89");
        }
        g.restore();
      }
      if (b.hp < b.maxHp * 0.8)
        line(
          g,
          [
            [-6, -9],
            [0, -2],
            [-3, 5],
            [7, 10],
          ],
          2,
          "#51483a",
        );
      g.restore();
      return;
    }
    if (
      (team === 1 || b.architecture === "islamic") &&
      [
        "towncenter",
        "fort",
        "chapel",
        "house",
        "barracks",
        "stable",
        "siegeworkshop",
        "mill",
        "lumbercamp",
        "miningcamp",
        "tower",
        "watchtower",
      ].includes(b.kind)
    ) {
      islamicBuilding(g, b, time);
      structureDamage(g, b, time);
      g.restore();
      return;
    } else if (b.kind === "wall" || b.kind === "gate") {
      rect(g, -w / 2, -h / 2, w, h, "#c4b28b", "#62553e");
      for (let y = -h / 2 + 3; y < h / 2; y += 8)
        for (let x = -w / 2 + (y % 2) * 4; x < w / 2; x += 12) {
          line(
            g,
            [
              [x, y],
              [Math.min(w / 2, x + 11), y],
            ],
            1,
            "#80765d",
          );
          line(
            g,
            [
              [x, y],
              [x, y + 7],
            ],
            1,
            "#80765d",
          );
        }
      if (b.kind === "wall") {
        const links = b.links || {};
        for (const side of ["n", "e", "s", "w"])
          if (!links[side]) {
            for (let v = -12; v < 16; v += 12) {
              const x = side === "w" ? -w / 2 : side === "e" ? w / 2 - 6 : v;
              const y = side === "n" ? -h / 2 : side === "s" ? h / 2 - 6 : v;
              rect(g, x, y, 6, 6, "#ead7b0", "#8b7756");
            }
          }
        rect(g, -8, -8, 16, 16, "#b1a181");
        for (const side of ["n", "e", "s", "w"])
          if (links[side]) {
            const x = side === "w" ? -w / 2 : side === "e" ? 8 : -8;
            const y = side === "n" ? -h / 2 : side === "s" ? 8 : -8;
            rect(
              g,
              x,
              y,
              side === "n" || side === "s" ? 16 : 8,
              side === "e" || side === "w" ? 16 : 8,
              "#b1a181",
            );
          }
      } else
        for (let x = -w / 2; x < w / 2; x += 12)
          rect(g, x, -h / 2 - 4, 7, 7, "#e4d2ac", "#948061");
      if (b.kind === "gate") {
        rect(
          g,
          -14,
          -h / 2 - 1,
          28,
          h + 2,
          b.closed ? "#735034" : "#342e26",
          "#ddc398",
        );
        if (b.closed)
          for (let x = -10; x <= 10; x += 5)
            line(
              g,
              [
                [x, -h / 2],
                [x, h / 2],
              ],
              2,
              "#ac8950",
            );
        banner(g, -w / 2 + 4, 0, team, time);
      }
    } else if (b.kind === "farm") {
      rect(g, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, "#82714a");
      for (let x = -w / 2 + 11; x < w / 2 - 8; x += 11) {
        line(
          g,
          [
            [x, -h / 2 + 10],
            [x, h / 2 - 10],
          ],
          5,
          b.remaining > 0 ? "#b3a24f" : "#695837",
        );
        for (let y = -h / 2 + 14; b.remaining > 0 && y < h / 2 - 10; y += 12) {
          line(
            g,
            [
              [x - 2, y + 2],
              [x, y - 3],
              [x + 3, y + 1],
            ],
            1.5,
            "#d5bc61",
          );
        }
      }
      for (const y of [-h / 2, h / 2])
        line(
          g,
          [
            [-w / 2, y],
            [w / 2, y],
          ],
          2,
          "#d0ba86",
        );
      for (const x of [-w / 2, w / 2])
        line(
          g,
          [
            [x, -h / 2],
            [x, h / 2],
          ],
          2,
          "#d0ba86",
        );
      g.restore();
      return;
    }
    if (b.kind === "fort" || b.kind === "tower") {
      rect(g, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, "#b5a77b");
      g.strokeStyle = C.wall;
      g.lineWidth = 10;
      g.strokeRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
      for (let x = -w / 2 + 1; x < w / 2; x += 14) {
        rect(g, x, -h / 2 - 3, 8, 9, "#e0ceaa");
        rect(g, x, h / 2 - 6, 8, 9, "#e0ceaa");
      }
      for (let y = -h / 2 + 8; y < h / 2; y += 14) {
        rect(g, -w / 2 - 3, y, 9, 8, "#e0ceaa");
        rect(g, w / 2 - 6, y, 9, 8, "#e0ceaa");
      }
      if (b.kind === "fort") {
        for (const [x, y] of [
          [-w / 2, -h / 2],
          [w / 2, -h / 2],
          [-w / 2, h / 2],
          [w / 2, h / 2],
        ]) {
          ellipse(g, x, y, 17, 17, "#92876a");
          ellipse(g, x, y, 13, 13, C.wall);
          ellipse(g, x, y, 8, 8, "#aaa078");
        }
        roof(
          g,
          -28,
          -25,
          56,
          48,
          team === 2 ? "#8e8977" : team === 1 ? "#6b7960" : C.red,
        );
        if (team === 1) {
          ellipse(g, 0, -2, 21, 21, "#4f7155");
          ellipse(g, -5, -6, 15, 15, "#73916a");
          ellipse(g, -8, -10, 7, 7, "#98ac79");
          ellipse(g, 0, -2, 3, 3, C.gold);
        } else if (team === 0) cross(g, 0, -2, 10, C.cream);
        rect(g, -16, h / 2 - 6, 32, 12, "#76593d");
      } else {
        ellipse(g, 0, 0, 12, 12, "#8c8467");
        if (team !== 2) sigil(g, 0, 0, 7, team);
      }
      banner(g, 5, -8, team, time);
    } else if (b.kind === "towncenter") {
      rect(g, -w / 2 + 8, -h / 2 + 8, w - 16, h - 16, "#cbb98c");
      roof(g, -w / 2 + 7, -h / 2 + 7, w - 14, 38);
      roof(g, -w / 2 + 7, -h / 2 + 46, 32, h - 53);
      roof(g, w / 2 - 37, -h / 2 + 46, 30, h - 53);
      ellipse(g, 0, 19, 14, 14, "#a1936c");
      ellipse(g, 0, 19, 10, 10, "#7c9690");
      banner(g, -7, 15, team, time);
      sigil(g, 0, -h / 2 + 24, 8, team, C.cream);
    } else if (b.kind === "chapel") {
      roof(g, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, "#978465");
      roof(g, (-w * 0.7) / 2, -15, w * 0.7, 30, "#a58e6c");
      if (team === 1) {
        ellipse(g, 0, 0, w * 0.28, w * 0.28, "#345e4c");
        ellipse(g, -4, -4, w * 0.21, w * 0.21, "#4f8564");
      }
      sigil(g, 0, 0, 13, team, C.cream);
      ellipse(g, 0, -h / 2 + 14, 9, 9, "#d0bd91");
      sigil(g, 0, -h / 2 + 14, 5, team, team === 1 ? C.gold : C.red);
    } else if (b.kind === "stable") {
      rect(g, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, "#6e7950");
      roof(g, -w / 2 + 7, -h / 2 + 7, w - 14, h * 0.37, "#86593b");
      for (let x = -w / 2 + 7; x < w / 2 - 4; x += 12) {
        rect(g, x, h / 2 - 9, 3, 7, "#b5a077");
        line(
          g,
          [
            [x, h / 2 - 6],
            [Math.min(x + 12, w / 2 - 4), h / 2 - 6],
          ],
          2,
          "#88704c",
        );
      }
      for (const x of [-w / 2 + 6, w / 2 - 6])
        line(
          g,
          [
            [x, 0],
            [x, h / 2 - 7],
          ],
          3,
          "#b39b6b",
        );
      rect(g, -w / 2 + 12, 0, 11, 23, "#66543b", "#baa178");
      rect(g, -w / 2 + 14, 2, 7, 19, "#668f99");
      for (let i = 0; i < 3; i++) {
        g.save();
        g.translate(-w / 2 + 38 + i * 21, 13 + (i % 2) * 11);
        g.rotate(-0.5 + i * 0.8);
        const coat = ["#b48958", "#684332", "#d6bc94"][i],
          dark = ["#654a30", "#372d29", "#8e7351"][i];
        // Overhead shoulders, tapered neck, ears, hooves and mane make a recognizable horse.
        for (const x of [-5, 5])
          for (const y of [-4, 7]) {
            ellipse(g, x, y, 1.7, 3.5, dark);
            ellipse(g, x, y - 1, 1.4, 2.5, coat);
          }
        ellipse(g, 0, 3, 5.8, 7.5, coat);
        ellipse(g, 0, -3, 5.3, 6.5, coat);
        ellipse(g, 0, -9, 3.1, 5.5, coat);
        g.save();
        g.translate(0, -12);
        g.rotate(Math.sin(time * 0.6 + i) * 0.1);
        ellipse(g, 0, -2, 3.2, 4.5, coat);
        ellipse(g, 0, -5, 2.7, 2.2, dark);
        polygon(
          g,
          [
            [-2, -3],
            [-3.3, -7],
            [-0.7, -4],
          ],
          coat,
        );
        polygon(
          g,
          [
            [2, -3],
            [3.3, -7],
            [0.7, -4],
          ],
          coat,
        );
        ellipse(g, -2, -2, 0.5, 0.5, "#241f1a");
        ellipse(g, 2, -2, 0.5, 0.5, "#241f1a");
        g.restore();
        line(
          g,
          [
            [0, -10],
            [0, -4],
            [1, 2],
          ],
          1.7,
          dark,
        );
        line(
          g,
          [
            [-2, 0],
            [-2, 6],
          ],
          0.8,
          "#e2c69b66",
        );
        line(
          g,
          [
            [0, 10],
            [1, 15],
            [-1 + Math.sin(time * 0.4 + i), 19],
          ],
          2.5,
          dark,
        );
        g.restore();
      }
      for (let i = 0; i < 3; i++)
        ellipse(g, w / 2 - 16, -h / 2 + 12 + i * 7, 6, 3, "#d1b65d");
      banner(g, w / 2 - 8, -h / 2 + 8, team, time);
    } else if (b.kind === "lumbercamp" || b.kind === "miningcamp") {
      roof(g, -w / 2 + 6, -h / 2 + 6, w * 0.55, h - 12, "#987e53");
      for (let i = 0; i < 5; i++)
        if (b.kind === "lumbercamp") {
          line(
            g,
            [
              [w * 0.12, -h / 2 + 13 + i * 9],
              [w * 0.28, -h / 2 + 13 + i * 9],
            ],
            6,
            "#785b39",
          );
          ellipse(g, w * 0.28, -h / 2 + 13 + i * 9, 3, 3, "#b79d64");
        } else
          polygon(
            g,
            [
              [w * 0.12, i * 10 - 20],
              [w * 0.3, i * 10 - 27],
              [w * 0.44, i * 10 - 15],
            ],
            "#939a86",
            "#6e765f",
          );
    } else if (b.kind === "mill") {
      roof(g, -w / 2 + 6, -h / 2 + 6, w * 0.58, h - 12, "#95734f");
      ellipse(g, w * 0.25, 0, 18, 18, "#938b70");
      ellipse(g, w * 0.25, 0, 13, 13, "#c6bb98");
      g.save();
      g.translate(w * 0.25, 0);
      g.rotate(time * 0.5);
      line(
        g,
        [
          [-10, 0],
          [10, 0],
        ],
        3,
        "#86795c",
      );
      g.restore();
      for (let i = 0; i < 3; i++)
        ellipse(g, w * 0.25, -h * 0.3 + i * 20, 5, 4, "#c5a66c");
    } else if (b.kind === "siegeworkshop") {
      rect(g, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, "#9c875d");
      roof(g, -w / 2 + 7, -h / 2 + 7, w - 14, h * 0.3, "#5f4b3b");
      // Two exposed assembly bays: a trebuchet frame and a wheeled ram.
      for (const x of [-23, 24]) {
        rect(g, x - 11, -2, 22, 32, "#735235", "#c9a273");
        for (const xx of [x - 13, x + 13])
          for (const y of [3, 25]) {
            ellipse(g, xx, y, 3, 5, "#453b2c");
            line(
              g,
              [
                [xx, y - 3],
                [xx, y + 3],
              ],
              1,
              "#ad8e5a",
            );
          }
        if (x < 0) {
          line(
            g,
            [
              [x - 9, 25],
              [x, -9],
              [x + 9, 25],
            ],
            4,
            "#b99864",
          );
          line(
            g,
            [
              [x, 19],
              [x + 6, -14],
            ],
            3,
            "#d2b27a",
          );
          rect(g, x + 2, -13, 9, 9, "#6c665b", "#aea58e");
          line(
            g,
            [
              [x + 6, -14],
              [x - 4, 30],
            ],
            0.7,
            "#e4cf98",
          );
        } else {
          roof(g, x - 9, 2, 18, 20, "#766345");
          line(
            g,
            [
              [x, 28],
              [x, -8],
            ],
            5,
            "#b2915f",
          );
          ellipse(g, x, -8, 4, 4, "#788080");
        }
      }
      for (let i = 0; i < 4; i++)
        line(
          g,
          [
            [-w / 2 + 8, 2 + i * 8],
            [-w / 2 + 18, 2 + i * 8],
          ],
          4,
          "#67462d",
        );
      ellipse(g, w / 2 - 10, 28, 6, 6, "#4c4940");
      ellipse(g, w / 2 - 10, 28, 3, 3, "#958d76");
      // Carpenter at a bench, restrained hammer motion.
      rect(g, -5, 24, 12, 6, "#735037");
      ellipse(g, 0, 18, 3.5, 4, team === 1 ? C.green : C.red);
      ellipse(g, 0, 15, 2.5, 2.5, "#d0aa7d");
      line(
        g,
        [
          [3, 19],
          [8, 22 + Math.sin(time * 5) * 2],
        ],
        1.5,
        "#d2b888",
      );
      banner(g, 2, -h / 2 + 8, team, time);
    } else if (b.kind === "barracks") {
      roof(g, -w / 2 + 7, -h / 2 + 7, w - 14, h * 0.55, C.red);
      rect(g, -w / 2 + 10, 12, w - 20, h / 2 - 20, "#bba579");
      for (let i = 0; i < 4; i++) {
        line(
          g,
          [
            [-w / 2 + 22 + i * 20, 15],
            [-w / 2 + 22 + i * 20, 32],
          ],
          2,
          "#717660",
        );
        line(
          g,
          [
            [-w / 2 + 16 + i * 20, 18],
            [-w / 2 + 27 + i * 20, 18],
          ],
          2,
          "#d1ceb3",
        );
      }
      banner(g, 0, -9, team, time);
    } else {
      roof(
        g,
        -w / 2 + 6,
        -h / 2 + 6,
        w - 12,
        h - 12,
        team === 2 ? "#9b805b" : "#a7704e",
      );
      rect(g, w / 2 - 18, -h / 2 + 10, 9, 10, "#d6c4a0");
      rect(g, w / 2 - 16, -h / 2 + 12, 5, 6, "#6f634e");
    }
    // A consistent masonry grid adds small-scale detail to every completed building.
    if (!["farm", "wall", "gate"].includes(b.kind)) {
      for (let y = -h / 2 + 4; y < h / 2; y += 9) {
        line(
          g,
          [
            [-w / 2 + 2, y],
            [-w / 2 + 6, y],
          ],
          0.8,
          "#625948",
        );
        line(
          g,
          [
            [w / 2 - 6, y],
            [w / 2 - 2, y],
          ],
          0.8,
          "#625948",
        );
      }
      for (const x of [-w / 2 + 10, w / 2 - 10])
        rect(g, x - 2, h / 2 - 15, 4, 7, "#3c3f37", "#d7bd8d");
    }
    structureDamage(g, b, time);
    g.restore();
  }
  function terrain(width, height, level, coast, river, seed, bridge = 1150) {
    const c = document.createElement("canvas");
    const scale = Math.min(0.5, 2560 / width, 1800 / height);
    c.width = Math.ceil(width * scale);
    c.height = Math.ceil(height * scale);
    const g = c.getContext("2d"),
      rand = seed;
    const colors =
      level === 2
        ? ["#cba766", "#d9ba7c", "#b89759"]
        : level === 3
          ? ["#aabbb4", "#c9d2c7", "#83958b"]
          : ["#628444", "#74984f", "#537337"];
    g.scale(scale, scale);
    rect(g, 0, 0, width, height, colors[0]);
    for (let i = 0; i < 1600; i++)
      ellipse(
        g,
        rand() * width,
        rand() * height,
        60 + rand() * 200,
        40 + rand() * 140,
        colors[1 + (i % 2)] + "18",
      );
    for (let i = 0; i < 16000; i++) {
      const x = rand() * width,
        y = rand() * height;
      line(
        g,
        [
          [x, y],
          [x + 1, y - 2],
          [x + 3, y],
        ],
        0.6,
        level === 2 ? "#ae9e6c55" : "#758c5650",
      );
    }
    if (level === 0) {
      const points = [
        [0, 0],
        [coast(0), 0],
      ];
      for (let y = 0; y <= height; y += 10) points.push([coast(y), y]);
      points.push([0, height]);
      const sea = g.createLinearGradient(0, 0, 420, 0);
      sea.addColorStop(0, "#174a5d");
      sea.addColorStop(0.75, "#247584");
      sea.addColorStop(1, "#47958d");
      polygon(g, points, sea);
      const shore = [];
      for (let y = 0; y <= height; y += 10) shore.push([coast(y), y]);
      line(g, shore, 22, "#d4c592");
      line(
        g,
        shore.map(([x, y]) => [x - 15, y]),
        3,
        "#bdd2b7",
      );
      for (let i = 0; i < 600; i++) {
        const y = rand() * height,
          x = rand() * coast(y);
        line(
          g,
          [
            [x, y],
            [x + 8 + rand() * 15, y],
          ],
          1,
          "#81c1c266",
        );
      }
    }
    if (level === 1) {
      const points = [];
      for (let y = 0; y < height; y += 10) points.push([river(y), y]);
      line(g, points, 110, "#6c9690");
      line(g, points, 78, "#7aa39a");
      line(
        g,
        points.map(([x, y]) => [x + 38, y]),
        2,
        "#b2c7a5",
      );
      rect(g, river(bridge) - 85, bridge - 47, 170, 94, "#a3946c", "#726345");
      for (let x = river(bridge) - 82; x < river(bridge) + 82; x += 12)
        line(
          g,
          [
            [x, bridge - 42],
            [x, bridge + 42],
          ],
          2,
          "#cfbb8e",
        );
      line(
        g,
        [
          [river(bridge) - 87, bridge - 50],
          [river(bridge) + 87, bridge - 50],
        ],
        6,
        "#a99a77",
      );
      line(
        g,
        [
          [river(bridge) - 87, bridge + 50],
          [river(bridge) + 87, bridge + 50],
        ],
        6,
        "#a99a77",
      );
    }
    return c;
  }
  const textureCache = new Map();
  function groundTexture(level) {
    if (textureCache.has(level)) return textureCache.get(level);
    const tile = document.createElement("canvas");
    tile.width = tile.height = 512;
    const g = tile.getContext("2d");
    let seed = 9381 + level * 71;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 38; i++) {
      const x = rand() * 512,
        y = rand() * 512,
        r = 15 + rand() * 48;
      const shade =
        level === 3
          ? "#354f5b15"
          : level === 2
            ? "#66432113"
            : i % 3
              ? "#345c2e19"
              : "#b6945930";
      const fade = g.createRadialGradient(x, y, 0, x, y, r);
      fade.addColorStop(0, shade);
      fade.addColorStop(1, "#00000000");
      g.fillStyle = fade;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      for (let j = 0; j < 18; j++) {
        const a = rand() * Math.PI * 2,
          d = rand() * r;
        ellipse(
          g,
          x + Math.cos(a) * d,
          y + Math.sin(a) * d,
          rand() * 2 + 0.4,
          rand() + 0.4,
          level === 3 ? "#eeeede35" : "#d7bf8d29",
        );
      }
    }
    for (let i = 0; i < 6500; i++) {
      const x = rand() * 512,
        y = rand() * 512;
      if (level === 2) {
        ellipse(
          g,
          x,
          y,
          0.5 + rand() * 1.6,
          0.4 + rand(),
          i % 3 ? "#59432424" : "#fff1b329",
        );
        if (i % 20 === 0)
          line(
            g,
            [
              [x, y],
              [x + 5, y + 1],
              [x + 9, y - 1],
            ],
            0.6,
            "#715b3523",
          );
      } else if (level === 3) {
        ellipse(
          g,
          x,
          y,
          1 + rand() * 3,
          0.5 + rand() * 1.5,
          i % 3 ? "#405b6b18" : "#f5f5e333",
        );
      } else {
        line(
          g,
          [
            [x, y],
            [x + rand() * 3 - 1.5, y - 2 - rand() * 4],
          ],
          0.7,
          i % 3 ? "#233c232e" : "#c8d78c39",
        );
        if (i % 24 === 0) ellipse(g, x, y, 1.3, 0.8, "#e5cdad44");
      }
    }
    textureCache.set(level, tile);
    return tile;
  }
  function ship(g, x, y, time, variant = 0) {
    g.save();
    g.translate(x + Math.sin(time * 0.35 + variant) * 1.5, y);
    g.rotate(-0.06 + Math.sin(time * 0.25 + variant) * 0.015);
    ellipse(g, 4, 5, 30, 77, "#143e4d55");
    polygon(
      g,
      [
        [0, -76],
        [19, -53],
        [26, -29],
        [26, 43],
        [15, 64],
        [0, 77],
        [-15, 64],
        [-26, 43],
        [-26, -29],
        [-19, -53],
      ],
      "#65452e",
      "#d2b584",
    );
    polygon(
      g,
      [
        [0, -66],
        [19, -38],
        [19, 42],
        [0, 64],
        [-19, 42],
        [-19, -38],
      ],
      "#b08855",
      "#4e3829",
    );
    for (let yy = -38; yy < 49; yy += 6)
      line(
        g,
        [
          [-18, yy],
          [18, yy],
        ],
        0.8,
        "#7a5638",
      );
    for (const xx of [-21, 21]) {
      line(
        g,
        [
          [xx, -39],
          [xx, 40],
        ],
        2,
        "#e1bd7e",
      );
      for (let yy = -30; yy < 40; yy += 13)
        rect(g, xx - 2, yy, 4, 4, "#453527");
    }
    rect(g, -12, -51, 24, 16, "#6d4930", "#d3ad74");
    rect(g, -11, 40, 22, 15, "#785035", "#d0ad7a");
    for (let yy = -45; yy < 56; yy += 25)
      line(
        g,
        [
          [0, yy],
          [-19, yy + 12],
          [19, yy + 12],
          [0, yy],
        ],
        0.7,
        "#e1ce9c",
      );
    line(
      g,
      [
        [0, -57],
        [0, 60],
      ],
      3,
      "#5e402b",
    );
    line(
      g,
      [
        [-19, -8],
        [24, -8],
      ],
      2.5,
      "#8a5d37",
    );
    polygon(
      g,
      [
        [1, -35],
        [27, -10],
        [1, 30],
      ],
      "#f5e3b7",
      "#b0a17f",
    );
    line(
      g,
      [
        [4, -26],
        [21, -9],
        [4, 23],
      ],
      0.7,
      "#c6b891",
    );
    jerusalemCross(g, 11, -3, 6, C.red);
    ellipse(g, 0, 63, 5, 4, "#2e302c");
    line(
      g,
      [
        [0, 66],
        [4, 87],
        [13, 95],
      ],
      1,
      "#a39470",
    );
    g.restore();
  }
  function terrainDetails(
    g,
    view,
    level,
    coast,
    river,
    time,
    bridge,
    ships = true,
  ) {
    g.save();
    g.beginPath();
    g.rect(view.x, view.y, view.w, view.h);
    if (ships) {
      g.moveTo(view.x, view.y);
      g.lineTo(coast(view.y) + 12, view.y);
      for (let y = view.y; y <= view.y + view.h + 16; y += 16)
        g.lineTo(coast(y) + 12, y);
      g.lineTo(view.x, view.y + view.h);
      g.closePath();
    }
    if (level === 1) {
      g.moveTo(river(view.y) - 53, view.y);
      for (let y = view.y; y <= view.y + view.h + 16; y += 16)
        g.lineTo(river(y) - 53, y);
      for (let y = view.y + view.h + 16; y >= view.y; y -= 16)
        g.lineTo(river(y) + 53, y);
      g.closePath();
    }
    g.clip("evenodd");
    g.fillStyle = g.createPattern(groundTexture(level), "repeat");
    g.fillRect(view.x, view.y, view.w, view.h);
    g.restore();
    if (ships) {
      const shore = [];
      for (let y = view.y - 16; y < view.y + view.h + 16; y += 8)
        shore.push([coast(y), y]);
      line(g, shore, 24, "#d5c28c");
      line(
        g,
        shore.map(([x, y]) => [x - 11, y]),
        3,
        "#82bbb0",
      );
      line(
        g,
        shore.map(([x, y]) => [x + 8, y]),
        2,
        "#b9a77c",
      );
      g.save();
      g.beginPath();
      g.moveTo(view.x, view.y);
      g.lineTo(coast(view.y) - 8, view.y);
      for (let y = view.y; y <= view.y + view.h + 12; y += 12)
        g.lineTo(coast(y) - 8, y);
      g.lineTo(view.x, view.y + view.h);
      g.closePath();
      g.clip();
      for (let band = 0; band < 5; band++) {
        const phase = (time * 9 + band * 38) % 190,
          points = [];
        for (
          let y = Math.floor(view.y / 12) * 12;
          y < view.y + view.h + 12;
          y += 12
        )
          points.push([coast(y) + lappingWave(time, band, y).offset, y]);
        line(
          g,
          points,
          0.7 + phase / 150,
          `rgba(220,244,226,${Math.sin((phase / 190) * Math.PI) * 0.28})`,
        );
      }
      for (
        let yy = Math.floor(view.y / 75) * 75;
        yy < view.y + view.h;
        yy += 75
      )
        for (
          let xx = Math.floor(view.x / 100) * 100;
          xx < Math.min(view.x + view.w, coast(yy) - 50);
          xx += 100
        )
          line(
            g,
            [
              [xx, yy + Math.sin(xx * 0.03 + time) * 3],
              [xx + 20, yy + Math.sin(xx * 0.03 + time) * 3],
            ],
            0.8,
            "#72b8bc44",
          );
      g.restore();
      for (const [i, y] of [1580, 1780, 2000].entries())
        if (y > view.y - 100 && y < view.y + view.h + 100)
          window.CruciataArt.ship(g, coast(y) - 95, y, time, i);
    }
    if (level === 1) {
      g.save();
      g.beginPath();
      g.moveTo(river(view.y) - 37, view.y);
      for (let y = view.y; y <= view.y + view.h + 12; y += 12)
        g.lineTo(river(y) - 37, y);
      for (let y = view.y + view.h + 12; y >= view.y; y -= 12)
        g.lineTo(river(y) + 37, y);
      g.closePath();
      g.clip();
      for (let band = 0; band < 5; band++)
        for (
          let y = Math.floor(view.y / 90) * 90 - 90;
          y < view.y + view.h + 90;
          y += 90
        ) {
          const yy = y + ((time * 22 + band * 17) % 90),
            x = river(yy) + (band - 2) * 13;
          line(
            g,
            [
              [x, yy],
              [x + Math.sin(yy * 0.04 + time) * 3, yy + 17],
              [x + 3, yy + 25],
            ],
            1,
            "#d3ede544",
          );
        }
      g.restore();
      for (const side of [-1, 1]) {
        const points = [];
        for (
          let y = Math.floor(view.y / 12) * 12;
          y < view.y + view.h + 12;
          y += 12
        ) {
          if (Math.abs(y - bridge) < 53) {
            if (points.length) line(g, points, 2, "#d8dfbaaa");
            points.length = 0;
            continue;
          }
          points.push([
            river(y) + side * 49 + Math.sin(y * 0.04 + time * 1.2) * 1.8,
            y,
          ]);
        }
        if (points.length) line(g, points, 2, "#d8dfbaaa");
      }
      if (bridge > view.y - 90 && bridge < view.y + view.h + 90) {
        window.CruciataArt.bridge(g, river(bridge), bridge);
      }
    }
  }
  function groundCover(g, patch, actors, time) {
    g.save();
    if (patch.type === "snow") {
      ellipse(g, patch.x, patch.y, patch.rx, patch.ry, "#d9e8e633");
      for (const u of actors) {
        const a = u.angle ?? 0;
        for (let i = 0; i < 5; i++) {
          const x = u.x - Math.cos(a) * i * 8 + Math.sin(a) * (i % 2 ? 3 : -3),
            y = u.y - Math.sin(a) * i * 8 - Math.cos(a) * (i % 2 ? 3 : -3);
          ellipse(g, x, y, 2.5, 4, "#788e9770");
        }
        ellipse(
          g,
          u.x + Math.sin(time * 8 + u.id) * 7,
          u.y + 7,
          10,
          4,
          "#eff8f5aa",
        );
      }
      g.restore();
      return;
    }
    if (patch.type === "golden") {
      g.save();
      g.translate(patch.x, patch.y);
      g.scale(patch.rx, patch.ry);
      const wash = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      wash.addColorStop(0, "#baa14a55");
      wash.addColorStop(0.7, "#baa14a28");
      wash.addColorStop(1, "#baa14a00");
      ellipse(g, 0, 0, 1, 1, wash);
      g.restore();
    }
    const colors =
      patch.type === "golden"
        ? ["#c6a84e", "#e3c46a", "#a38b43"]
        : patch.type === "reeds"
          ? ["#6c8e50", "#92a562", "#b4ac67"]
          : ["#a08a58", "#b9a06b", "#857650"];
    for (let shade = 0; shade < 3; shade++) {
      g.beginPath();
      g.strokeStyle = colors[shade];
      g.lineWidth = patch.type === "golden" ? 1.2 : 1;
      for (const stem of patch.stems) {
        if (stem.shade !== shade) continue;
        let bend = Math.sin(time * 1.2 + stem.phase) * 1.4;
        for (const u of actors) {
          const dx = u.x - stem.x,
            dy = u.y - stem.y;
          if (Math.abs(dx) >= 36 || Math.abs(dy) >= 36) continue;
          const d = Math.hypot(dx, dy);
          if (d < 36)
            bend +=
              (1 - d / 36) *
              ((stem.x - u.x) * 0.5 + Math.cos(u.angle ?? 0) * 8);
        }
        g.moveTo(stem.x, stem.y);
        g.quadraticCurveTo(
          stem.x + bend * 0.5,
          stem.y - stem.height * 0.6,
          stem.x + bend,
          stem.y - stem.height,
        );
        if (patch.type === "golden" || patch.type === "reeds") {
          g.moveTo(stem.x + bend - 1.8, stem.y - stem.height + 4);
          g.lineTo(stem.x + bend, stem.y - stem.height - 2);
        }
        if (patch.type === "brush") {
          g.moveTo(stem.x, stem.y - 2);
          g.lineTo(stem.x - 4 + bend, stem.y - stem.height * 0.6);
        }
      }
      g.stroke();
    }
    if (patch.type === "brush")
      for (const u of actors)
        ellipse(
          g,
          u.x + Math.sin(time * 5 + u.id) * 9,
          u.y + 6,
          12,
          5,
          "#d7b87935",
        );
    g.restore();
  }
  const rockMassPaths = new WeakMap();
  const rockRimPaths = new WeakMap();
  function rockMass(g, d) {
    let path = rockMassPaths.get(d);
    if (!path) {
      path = new Path2D();
      for (const contour of d.contours) {
        for (let i = 0; i < contour.length; i++) {
          const previous = contour[(i + contour.length - 1) % contour.length],
            p = contour[i],
            next = contour[(i + 1) % contour.length];
          const incoming = Math.hypot(p.x - previous.x, p.y - previous.y),
            outgoing = Math.hypot(next.x - p.x, next.y - p.y),
            round = 12;
          const a = {
            x: p.x + (previous.x - p.x) * Math.min(0.3, round / incoming),
            y: p.y + (previous.y - p.y) * Math.min(0.3, round / incoming),
          };
          const b = {
            x: p.x + (next.x - p.x) * Math.min(0.3, round / outgoing),
            y: p.y + (next.y - p.y) * Math.min(0.3, round / outgoing),
          };
          if (i === 0) path.moveTo(a.x, a.y);
          else path.lineTo(a.x, a.y);
          path.quadraticCurveTo(p.x, p.y, b.x, b.y);
        }
        path.closePath();
      }
      rockMassPaths.set(d, path);
    }
    const rim = [
      ["#6d7162", "#a2a38d", "#c1bea5"],
      ["#627465", "#93a48e", "#b7c4a9"],
      ["#644321", "#c3a06b", "#f0d7a3"],
      ["#718184", "#a8b9b8", "#d5dfd6"],
    ][d.biome || 0];
    g.save();
    g.lineJoin = "round";
    g.translate(4, 6);
    g.fillStyle = "#19201955";
    g.fill(path, "evenodd");
    g.strokeStyle = "#19201940";
    g.lineWidth = 34;
    g.stroke(path);
    g.translate(-4, -6);
    g.fillStyle = "#080b0a";
    g.fill(path, "evenodd");
    g.strokeStyle = rim[0];
    g.lineWidth = 28;
    g.stroke(path);
    g.strokeStyle = rim[1];
    g.lineWidth = 18;
    g.stroke(path);
    g.strokeStyle = rim[2];
    g.lineWidth = 1;
    g.stroke(path);
    let detail = rockRimPaths.get(d);
    if (!detail) {
      const chips = [new Path2D(), new Path2D()],
        highlights = new Path2D(),
        walls = [new Path2D(), new Path2D(), new Path2D()],
        fractures = new Path2D();
      // Shared edges disappear entirely.
      for (const contour of d.contours)
        for (let i = 0; i < contour.length; i++) {
          const a = contour[i],
            b = contour[(i + 1) % contour.length],
            length = Math.hypot(b.x - a.x, b.y - a.y),
            dx = (b.x - a.x) / length,
            dy = (b.y - a.y) / length;
          for (let band = 0; band < 3; band++) {
            const near = band * 10 + 3,
              far = near + 11,
              path = walls[band],
              nx = -dy,
              ny = dx;
            path.moveTo(a.x + nx * near, a.y + ny * near);
            path.lineTo(b.x + nx * near, b.y + ny * near);
            path.lineTo(b.x + nx * far, b.y + ny * far);
            path.lineTo(a.x + nx * far, a.y + ny * far);
            path.closePath();
          }
          for (let t = 12; t < length; t += 27) {
            const x = a.x + dx * t,
              y = a.y + dy * t;
            fractures.moveTo(x - dy * 6, y + dx * 6);
            fractures.lineTo(x - dy * 17 + dx * 2, y + dx * 17 + dy * 2);
            fractures.lineTo(x - dy * 32, y + dx * 32);
          }
          for (let t = 7; t < length - 3; t += 15) {
            const jitter = Math.sin(a.x * 0.31 + a.y * 0.17 + t) * 5,
              x = a.x + dx * t - dy * jitter,
              y = a.y + dy * t + dx * jitter;
            const radius = 5 + (Math.sin(x * 0.9 + y * 0.7) + 1) * 2.5;
            const points = [];
            for (let k = 0; k < 6; k++) {
              const angle = (k * Math.PI) / 3 + 0.3,
                rr = radius * (0.75 + 0.2 * Math.sin(x + y + k * 9));
              points.push([x + Math.cos(angle) * rr, y + Math.sin(angle) * rr]);
            }
            const path = chips[Math.sin(x + y) > 0 ? 0 : 1];
            path.moveTo(...points[0]);
            for (let j = 1; j < points.length; j++) path.lineTo(...points[j]);
            path.closePath();
            highlights.moveTo(...points[3]);
            highlights.lineTo(...points[4]);
            highlights.lineTo(...points[5]);
          }
        }

      detail = { chips, highlights, walls, fractures };
      rockRimPaths.set(d, detail);
    }
    g.save();
    g.clip(path, "evenodd");
    const faces =
      d.biome === 2
        ? ["#a47a43", "#664422", "#302016"]
        : [rim[0], "#44483d", "#202820"];
    for (let i = 0; i < 3; i++) {
      g.fillStyle = faces[i];
      g.fill(detail.walls[i]);
    }
    g.strokeStyle = d.biome === 2 ? "#1e120cc0" : "#111b14aa";
    g.lineWidth = 1.2;
    g.stroke(detail.fractures);
    g.restore();
    for (let i = 0; i < 2; i++) {
      g.fillStyle = rim[i];
      g.fill(detail.chips[i]);
      g.strokeStyle = "#383e3480";
      g.lineWidth = 1;
      g.stroke(detail.chips[i]);
    }
    g.strokeStyle = rim[2];
    g.lineWidth = 0.8;
    g.stroke(detail.highlights);

    g.restore();
  }
  function clipLand(g, view, level, coast, river, bridge, sea) {
    g.beginPath();
    g.rect(view.x, view.y, view.w, view.h);
    if (sea) {
      g.moveTo(view.x - 100, view.y - 100);
      g.lineTo(coast(view.y - 100), view.y - 100);
      for (let y = view.y - 100; y <= view.y + view.h + 100; y += 12)
        g.lineTo(coast(y), y);
      g.lineTo(view.x - 100, view.y + view.h + 100);
      g.closePath();
    }
    if (level === 1) {
      for (const [start, end] of [
        [view.y - 100, Math.min(view.y + view.h + 100, bridge - 47)],
        [Math.max(view.y - 100, bridge + 47), view.y + view.h + 100],
      ]) {
        if (end <= start) continue;
        g.moveTo(river(start) - 60, start);
        for (let y = start; y < end; y += 10) g.lineTo(river(y) - 60, y);
        g.lineTo(river(end) - 60, end);
        g.lineTo(river(end) + 60, end);
        for (let y = end; y > start; y -= 10) g.lineTo(river(y) + 60, y);
        g.lineTo(river(start) + 60, start);
        g.closePath();
      }
    }
    g.clip("evenodd");
  }
  function cliff(g, d) {
    g.save();
    g.translate(d.x, d.y);
    const r = d.r;
    ellipse(g, 8, 13, r + 9, r * 0.8, "#29382b45");
    const outline = [];
    for (let i = 0; i < 14; i++) {
      const a = (i * Math.PI) / 7;
      outline.push([
        Math.cos(a) * r * (0.91 + Math.sin(i * 4 + d.x) * 0.08),
        Math.sin(a) * r * 0.82,
      ]);
    }
    polygon(
      g,
      outline.map(([x, y]) => [x, y + 15]),
      "#6b6354",
      "#504f43",
    );
    for (let i = 0; i < 14; i++) {
      const [x, y] = outline[i];
      line(
        g,
        [
          [x, y],
          [x + 2, y + 15],
        ],
        2,
        "#8d806a",
      );
    }
    polygon(g, outline, "#b0a68a", "#e0ceb0");
    for (let i = 0; i < 6; i++)
      line(
        g,
        [
          [Math.sin(i * 7) * r * 0.7, Math.cos(i * 4) * r * 0.5],
          [Math.sin(i * 7) * r * 0.7 + 12, Math.cos(i * 4) * r * 0.5 - 7],
        ],
        1,
        "#7b796654",
      );
    g.restore();
  }
  window.CruciataArt = {
    ellipse,
    line,
    polygon,
    rect,
    cross,
    jerusalemCross,
    roof,
    banner,
    updateStandard,
    suspendStandard(u) {
      const cloth = standardCloths.get(u);
      if (cloth) cloth.suspended = true;
    },
    standardCloth,
    armyStandard,
    particle,
    lappingWave,
    tree,
    resource,
    unit,
    caravan,
    greatEngine,
    siegeMachine,
    corpse,
    structure,
    terrain,
    terrainDetails,
    groundCover,
    cliff,
    rockMass,
    clipLand,
    ship,
    palette: C,
  };
})();
