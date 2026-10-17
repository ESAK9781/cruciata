/* Crusader orders: livery colours and real heraldic insignia drawn in the shared art.
   Art slots 4-6 are liveries of the Christian side (slot 0); they exist for the native
   LAN client, where each player chooses a faction. Slot numbers are only art keys. */
(() => {
  "use strict";
  const ORDERS = {
    // Knights Templar: white mantle, red cross pattee.
    4: {
      id: "templar",
      name: "Knights Templar",
      field: "#ece5d0",
      mark: "#b3241f",
      edge: "#6f1612",
      roof: "#a9382a",
      emblem: "pattee",
    },
    // Knights Hospitaller: black mantle, white eight-pointed cross.
    5: {
      id: "hospitaller",
      name: "Knights Hospitaller",
      field: "#25262c",
      mark: "#f4efe0",
      edge: "#9d988a",
      roof: "#434856",
      emblem: "maltese",
    },
    // Teutonic Knights: white mantle, black Balkenkreuz.
    6: {
      id: "teutonic",
      name: "Teutonic Knights",
      field: "#dedbcd",
      mark: "#17181a",
      edge: "#000000",
      roof: "#5d6b57",
      emblem: "teutonic",
    },
  };
  // One arm of each cross, pointing up (y up); four rotated copies make the emblem.
  const ARMS = {
    pattee: [
      [-0.2, 0.2],
      [-0.2, 0.5],
      [-0.56, 1],
      [0.56, 1],
      [0.2, 0.5],
      [0.2, 0.2],
    ],
    maltese: [
      [-0.16, 0.16],
      [-0.46, 0.98],
      [0, 0.74],
      [0.46, 0.98],
      [0.16, 0.16],
    ],
    teutonic: [
      [-0.2, 0.2],
      [-0.2, 0.7],
      [-0.31, 1],
      [0.31, 1],
      [0.2, 0.7],
      [0.2, 0.2],
    ],
  };
  const turn = ([x, y], k) =>
    k === 0 ? [x, y] : k === 1 ? [y, -x] : k === 2 ? [-x, -y] : [-y, x];
  const shapes = new Map();
  /** Emblem outline with y up, scaled to `size` (half the cross width). */
  function outline(team, size) {
    const o = ORDERS[team];
    if (!shapes.has(o.emblem)) {
      const pts = [];
      for (let k = 0; k < 4; k++)
        for (const p of ARMS[o.emblem]) pts.push(turn(p, k));
      shapes.set(o.emblem, pts);
    }
    return shapes.get(o.emblem).map(([x, y]) => [x * size, y * size]);
  }
  function emblem(g, x, y, size, team) {
    const o = ORDERS[team];
    if (!o) return;
    g.save();
    g.beginPath();
    outline(team, size).forEach(([px, py], i) =>
      i ? g.lineTo(x + px, y - py) : g.moveTo(x + px, y - py),
    );
    g.closePath();
    g.fillStyle = o.mark;
    g.fill();
    g.strokeStyle = o.edge;
    g.lineWidth = Math.max(0.35, size * 0.09);
    g.lineJoin = "round";
    g.stroke();
    g.restore();
  }
  /** The emblem as a vertical face of a projected model, facing the viewer. */
  function emblemFace(m, cx, y, cz, size, team) {
    const o = ORDERS[team];
    m.face(
      outline(team, size).map(([px, py]) => [cx + px, y, cz + py]),
      o.mark,
      false,
    );
  }
  /** A pennant on a pole standing at ground position (x, y). */
  function pennant(m, x, y, team, height = 46, k = 1.7) {
    const o = ORDERS[team],
      top = height,
      bottom = height - 17 * k,
      half = 6.5 * k;
    m.beam([x, y, 0], [x, y, height + 3], 1.5, "#5d4a33");
    m.face(
      [
        [x - half, y + 0.3, top],
        [x + half, y + 0.3, top],
        [x + half, y + 0.3, bottom],
        [x, y + 0.3, bottom + 3.4 * k],
        [x - half, y + 0.3, bottom],
      ],
      o.field,
      false,
    );
    m.face(
      [
        [x - half, y + 0.35, top],
        [x + half, y + 0.35, top],
        [x + half, y + 0.35, top - 2 * k],
        [x - half, y + 0.35, top - 2 * k],
      ],
      o.mark,
      false,
    );
    emblemFace(m, x, y + 0.4, bottom + 8 * k, 4.3 * k, team);
  }
  window.CruciataOrders = {
    ORDERS,
    isOrder: (team) => !!ORDERS[team],
    christian: (team) => team === 0 || !!ORDERS[team],
    style: (team) => ORDERS[team] || null,
    field: (team, fallback) => ORDERS[team]?.field ?? fallback,
    emblem,
    outline,
    pennant,
  };
})();
