/* cruciāta — settlement economy, role-based combat, siege, and a six-chapter chronicle. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    canvas = $("game"),
    ctx = canvas.getContext("2d"),
    mini = $("minimap"),
    mc = mini.getContext("2d"),
    Art = window.CruciataArt;
  let W = 12800,
    H = 8800;
  const STEP = 1 / 30,
    DEBUG_MODE = true,
    TEST = new URLSearchParams(location.search).has("test"),
    SAVE = "cruciata-empire-v2",
    PROGRESS = "cruciata-campaign-v1",
    CHECKPOINT = "cruciata-checkpoint-v3";
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n)),
    distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    alive = (o) => o.hp > 0;
  const TYPES = {
    worker: {
      name: "Villager",
      cost: { food: 50 },
      hp: 65,
      speed: 76,
      range: 0,
      damage: 0,
      cooldown: 1,
      producer: "towncenter",
      train: 10,
      rank: 4,
    },
    sword: {
      name: "Swordsman",
      cost: { food: 55, gold: 35 },
      hp: 130,
      speed: 85,
      range: 28,
      damage: 18,
      cooldown: 1,
      producer: "barracks",
      train: 12,
      rank: 0,
    },
    archer: {
      name: "Archer",
      cost: { wood: 45, gold: 40, food: 30 },
      hp: 75,
      speed: 88,
      range: 225,
      damage: 13,
      cooldown: 1.4,
      producer: "barracks",
      train: 14,
      rank: 2,
    },
    knight: {
      name: "Knight",
      cost: { food: 90, gold: 100 },
      hp: 230,
      speed: 125,
      range: 34,
      damage: 29,
      cooldown: 1.2,
      producer: "stable",
      train: 22,
      rank: 1,
    },
    chaplain: {
      name: "Chaplain",
      cost: { food: 45, gold: 90 },
      hp: 85,
      speed: 80,
      range: 175,
      damage: 0,
      cooldown: 1.5,
      producer: "chapel",
      train: 18,
      rank: 3,
    },
    standard: {
      name: "Standard bearer",
      short: "Standard",
      cost: { food: 65, gold: 75, wood: 30 },
      hp: 150,
      speed: 86,
      range: 24,
      damage: 9,
      cooldown: 1.3,
      producer: "barracks",
      train: 18,
      rank: 1,
    },
    trebuchet: {
      name: "Trebuchet",
      cost: { wood: 240, gold: 180, stone: 100, food: 45 },
      hp: 260,
      speed: 43,
      range: 690,
      minRange: 180,
      damage: 135,
      cooldown: 8,
      producer: "siegeworkshop",
      train: 35,
      rank: 5,
    },
    civilian: {
      name: "Townsfolk",
      hp: 50,
      speed: 65,
      range: 0,
      damage: 0,
      cooldown: 1,
      rank: 4,
    },
    pilgrim: {
      name: "Pilgrim caravan",
      hp: 180,
      speed: 55,
      range: 0,
      damage: 0,
      cooldown: 1,
      rank: 4,
    },
  };
  const BUILDINGS = {
    towncenter: {
      name: "Town centre",
      w: 140,
      h: 120,
      hp: 1800,
      pop: 16,
      drop: ["food", "wood", "gold", "stone"],
    },
    house: {
      name: "House",
      cost: { wood: 65, stone: 15 },
      w: 64,
      h: 62,
      hp: 450,
      time: 18,
      pop: 6,
    },
    farm: {
      name: "Farm",
      cost: { wood: 75 },
      w: 110,
      h: 95,
      hp: 400,
      time: 18,
      passable: true,
    },
    mill: {
      name: "Mill",
      cost: { wood: 110, stone: 20 },
      w: 80,
      h: 76,
      hp: 650,
      time: 24,
      drop: ["food"],
    },
    lumbercamp: {
      name: "Lumber camp",
      cost: { wood: 90 },
      w: 76,
      h: 70,
      hp: 600,
      time: 20,
      drop: ["wood"],
    },
    miningcamp: {
      name: "Mining camp",
      cost: { wood: 100, stone: 30 },
      w: 78,
      h: 74,
      hp: 650,
      time: 23,
      drop: ["gold", "stone"],
    },
    barracks: {
      name: "Barracks",
      cost: { wood: 180, stone: 70 },
      w: 110,
      h: 95,
      hp: 1000,
      time: 32,
    },
    stable: {
      name: "Stables",
      cost: { wood: 210, stone: 90 },
      w: 106,
      h: 96,
      hp: 950,
      time: 32,
    },
    chapel: {
      name: "Chapel",
      cost: { wood: 170, stone: 100, gold: 70 },
      w: 86,
      h: 116,
      hp: 950,
      time: 35,
    },
    tower: {
      name: "Watchtower",
      cost: { wood: 140, stone: 120 },
      w: 54,
      h: 54,
      hp: 1050,
      time: 30,
      range: 340,
      damage: 24,
    },
    siegeworkshop: {
      name: "Siege workshop",
      cost: { wood: 230, stone: 150, gold: 80 },
      w: 125,
      h: 100,
      hp: 1100,
      time: 38,
    },
    fort: {
      name: "Enemy citadel",
      w: 175,
      h: 165,
      hp: 2500,
      range: 360,
      damage: 26,
    },
  };
  BUILDINGS.wall = {
    name: "Curtain wall",
    cost: { stone: 12, wood: 3 },
    w: 32,
    h: 32,
    hp: 3200,
    time: 4,
  };
  BUILDINGS.gate = {
    name: "Gatehouse",
    cost: { stone: 110, wood: 55 },
    w: 74,
    h: 42,
    hp: 4200,
    time: 25,
    passable: true,
  };
  for (const [key, b] of Object.entries(BUILDINGS)) {
    if (!["wall", "gate"].includes(key)) {
      b.w = Math.round(b.w * 0.8);
      b.h = Math.round(b.h * 0.8);
    }
  }
  BUILDINGS.house.pop = 12;
  BUILDINGS.towncenter.pop = 32;
  for (const key of ["sword", "archer", "knight", "standard"]) {
    TYPES[key].train *= 0.6;
    for (const r in TYPES[key].cost)
      TYPES[key].cost[r] = Math.round(TYPES[key].cost[r] * 0.72);
    TYPES[key].damage *= 0.8;
  }
  const VARIANTS = {
    sword: ["Swordsman", "Templar", "Veteran Templar"],
    archer: ["Archer", "Crossbowman", "Royal Arbalester"],
    knight: ["Knight", "Order Cavalier", "Marshal's Guard"],
    chaplain: ["Chaplain", "Hospitaller", "Prior"],
    standard: ["Standard bearer", "Gonfalonier", "Sacred Standard"],
    trebuchet: ["Trebuchet", "Counterweight Engine", "Grand Trebuchet"],
  };
  const TECHS = Object.fromEntries(
    Object.entries(VARIANTS).flatMap(([type, names]) =>
      names.slice(1).map((name, rank) => [
        type + (rank + 1),
        {
          name,
          type,
          rank: rank + 1,
          producer: TYPES[type].producer,
          cost: { gold: 120 + rank * 170, wood: 80 + rank * 90 },
          time: 28 + rank * 20,
          desc:
            "Upgrade every existing and future " +
            names[0].toLowerCase() +
            ". +25% health and damage per rank.",
        },
      ]),
    ),
  );
  function rankFor(type, team = 0) {
    return (team === 0 ? state.upgrades : state.enemy?.upgrades)?.[type] || 0;
  }
  const ENEMY_VARIANTS = {
    sword: ["Infantry", "Citadel Guard", "Veteran Guard"],
    archer: ["Archer", "Crossbowman", "Veteran Crossbowman"],
    knight: ["Rider", "Heavy Cavalry", "Veteran Cavalry"],
    chaplain: ["Physician", "Scholar", "Court Physician"],
    standard: ["Standard Bearer", "Company Standard", "Royal Standard"],
    trebuchet: VARIANTS.trebuchet,
  };
  function unitName(u) {
    return (
      (u.team === 1 ? ENEMY_VARIANTS : VARIANTS)[u.type]?.[u.rank || 0] ||
      TYPES[u.type].name
    );
  }
  function applyRank(u, rank) {
    const ratio = u.hp / u.maxHp;
    u.rank = rank;
    u.maxHp = TYPES[u.type].hp * (1 + rank * 0.25);
    u.hp = u.maxHp * ratio;
  }
  const LEVELS = [
    {
      name: "The Landing",
      roman: "I",
      sub: "THE LEVANTINE COAST",
      title: "A foothold on the coast",
      date: "SUMMER · 1097",
      terrain: 0,
      kind: "settlement",
      camp: { x: 500, y: 1690 },
      fort: { x: 2690, y: 580 },
      hp: 1900,
      wave: 95,
      objective: "Establish a pilgrim settlement",
      desc: "Complete two farms, gather 200 food, and take the coastal outpost.",
      story:
        "The cross standards rise on the Levantine shore. Your Christian host needs more than courage: send villagers to the orchards and forests, build two farms, and supply the army before securing the neutral coastal outpost with at least three soldiers.",
      win: "The fields are planted and the coast is secured. A living settlement now supplies the pilgrimage.",
    },
    {
      name: "The River",
      roman: "II",
      sub: "THE ORONTES CROSSING",
      title: "A crossing under watchful eyes",
      date: "AUTUMN · 1097",
      terrain: 1,
      kind: "escort",
      camp: { x: 480, y: 1710 },
      fort: { x: 2730, y: 480 },
      hp: 2400,
      wave: 80,
      objective: "Escort the pilgrim caravan",
      desc: "Build a watchtower by the bridge. Escort at least two caravans to the northeast refuge.",
      story:
        "The Orontes cuts the road in two. Muslim patrols watch its only bridge. Establish a watchtower near the crossing and escort your three pilgrim caravans; they march only while soldiers are close and the way is safe.",
      win: "The pilgrims have crossed beneath the protection of your standards. The road to Antioch remains open.",
    },
    {
      name: "The Winter Siege",
      roman: "III",
      sub: "THE OUTSKIRTS OF ANTIOCH",
      title: "Endure the winter at Antioch",
      date: "WINTER · 1097",
      terrain: 2,
      kind: "survival",
      camp: { x: 1430, y: 1420 },
      fort: { x: 2710, y: 420 },
      hp: 3200,
      wave: 55,
      objective: "Hold through the winter siege",
      desc: "Keep the town centre standing for six minutes and complete a chapel. Winter slows food gathering.",
      story:
        "Winter closes around Antioch. Attacks will come from several directions, and the harvest is meagre. Fortify your settlement, keep food stores healthy, and build a chapel to sustain the defenders through six minutes of siege.",
      win: "The settlement has endured. The bells of the chapel answer the departing winter, and your host is ready to march.",
    },
    {
      name: "The Pilgrim Road",
      roman: "IV",
      sub: "THE COASTAL ROAD",
      title: "The price of a safe passage",
      date: "SPRING · 1098",
      terrain: 3,
      kind: "liberation",
      camp: { x: 470, y: 1720 },
      fort: { x: 2800, y: 350 },
      hp: 3200,
      wave: 70,
      objective: "Secure the pilgrim road",
      desc: "Hold both road villages. Secure the road and deliver three escorted supply caravans.",
      story:
        "The road south runs through two abandoned villages. Secure both settlements and hold them for ninety seconds. Keep the villagers alive and protect the supply road while the opposing host scouts for a weakness.",
      win: "The route is secure. Merchants and pilgrims carry provisions south beneath your banners.",
    },
    {
      name: "The Walls",
      roman: "V",
      sub: "THE APPROACH TO JERUSALEM",
      title: "Let the walls answer the stones",
      date: "SUMMER · 1099",
      terrain: 4,
      kind: "siege",
      camp: { x: 550, y: 1750 },
      fort: { x: 2770, y: 540 },
      hp: 3800,
      wave: 65,
      objective: "Breach the outer walls",
      desc: "Destroy two of the three gatehouses. Use deployed trebuchets to strike the fortifications.",
      story:
        "Jerusalem rises behind its outer walls. Build a siege workshop, bring timber and stone to the engines, and break two gatehouses. Trebuchets must set up before firing; their stones spare neither friend nor foe near the impact.",
      win: "The outer defenses are breached. The engines have opened the path to the Holy City.",
    },
    {
      name: "The Holy City",
      roman: "VI",
      sub: "JERUSALEM",
      title: "Beneath the standards of Jerusalem",
      date: "HIGH SUMMER · 1099",
      terrain: 5,
      kind: "occupation",
      camp: { x: 490, y: 1790 },
      fort: { x: 2520, y: 910 },
      hp: 4500,
      wave: 55,
      objective: "Take and hold the Holy City",
      desc: "Take the citadel, secure both holy sites, and withstand a final 90-second counterattack.",
      story:
        "Cross and crescent standards face one another before Jerusalem. Take the citadel and secure both holy sites, then prepare for the counterattack. Your settlement must still survive: an overextended host can lose the road behind it.",
      win: "Your standards fly over Jerusalem. The campaign is complete. The chronicle remembers the pilgrims, villagers, and soldiers who paid for each mile of this road.",
    },
  ];
  let prefs = {};
  try {
    prefs = JSON.parse(
      localStorage.getItem(SAVE) ||
        localStorage.getItem("cruciata-save") ||
        "{}",
    );
  } catch {}
  let savedProgress = {};
  try {
    savedProgress = JSON.parse(localStorage.getItem(PROGRESS) || "{}");
  } catch {}
  const recordedChapters = [
    ...(Array.isArray(prefs.completed) ? prefs.completed : []),
    ...(Array.isArray(savedProgress.completed) ? savedProgress.completed : []),
  ].filter((i) => Number.isInteger(i) && i >= 0 && i < 6);
  let unlocked = clamp(
      Math.max(
        prefs.unlocked || 0,
        savedProgress.unlocked || 0,
        ...recordedChapters.map((i) => i + 1),
      ),
      0,
      5,
    ),
    completed = new Set(recordedChapters),
    settings = {
      sound: prefs.sound !== false,
      gore: prefs.gore !== false,
      effectsVolume: Number.isFinite(prefs.effectsVolume)
        ? clamp(prefs.effectsVolume, 0, 1)
        : 0.65,
      musicVolume: Number.isFinite(prefs.musicVolume)
        ? clamp(prefs.musicVolume, 0, 1)
        : 0.2,
    };
  let sessionActive = false;
  let state,
    uid = 0,
    selected = new Set(),
    selectedBuilding = null,
    selectedBuildings = new Set(),
    mode = "move",
    wallDrag = null,
    wallAnchor = null,
    placement = null,
    placementRotation = 0,
    tab = "army",
    drag = null,
    mouse = { x: 0, y: 0 },
    pointerOnMap = false,
    middleDrag = null,
    lastTime = 0,
    accumulator = 0,
    uiClock = 0,
    fog,
    enemyFog,
    selectedNode = null,
    quickConfig = null,
    quickSlot = null,
    visionTimer = 0,
    minimapDrag = null,
    toastTimer,
    modalState,
    wasPaused;
  let camera = { x: 700, y: 1620, zoom: 1 },
    view = { x: 0, y: 0, w: 1200, h: 760, scale: 1 },
    panKeys = new Set(),
    terrain,
    decorations = [],
    nav = new window.CruciataNavigation(W, H),
    spatial = new Map(),
    obstacleIndex = null,
    objectIndex = new Map();
  function seeded(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function toast(text) {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3400);
  }
  function playerSees(p) {
    return (DEBUG_MODE && state.cheats?.reveal) || fog.sees(p);
  }
  function playerRemembers(p) {
    return (DEBUG_MODE && state.cheats?.reveal) || fog.remembers(p);
  }
  function sound(kind, point = null) {
    window.CruciataAudio.setEnabled(settings.sound);
    if (!settings.sound) return;
    if (point && point.team !== 0 && !fog?.sees(point)) return;
    const volume = point ? clamp(1 - distance(point, camera) / 1000, 0, 1) : 1;
    window.CruciataAudio.play(kind, volume);
  }
  const ROLES = {
    worker: {
      label: "Gather & build",
      description:
        "Gather resources, build structures, and repair damage. Flee danger; cannot fight.",
    },
    sword: {
      label: "Frontline infantry",
      description:
        "Holds the front and protects ranged troops. Prioritizes threatening cavalry; vulnerable to focused arrows.",
    },
    archer: {
      label: "Ranged support",
      description:
        "Shoots from behind infantry and retreats from nearby melee attackers. Fragile in close combat.",
    },
    knight: {
      label: "Fast flanking cavalry",
      description:
        "Fast, armored cavalry. Flanks archers, healers, and siege engines. Avoid getting surrounded by infantry.",
    },
    chaplain: {
      label: "Rear-line healer",
      description:
        "Heals wounded allies, generates faith, and retreats from danger. Keep behind infantry; cannot attack.",
    },
    standard: {
      label: "Company support",
      description:
        "Raises nearby allied damage by 12% within 180 paces. Keep the banner protected among your troops.",
    },
    trebuchet: {
      label: "Area siege damage",
      description:
        "Deploys in 6 seconds; packs in 4. Range 180-690; devastating area damage can hurt allies.",
    },
    pilgrim: {
      label: "Protected convoy",
      description:
        "Needs nearby soldiers to travel. Right-click with troops selected to escort.",
    },
  };
  function persistPrefs() {
    try {
      localStorage.setItem(
        PROGRESS,
        JSON.stringify({ version: 1, unlocked, completed: [...completed] }),
      );
    } catch {}
    try {
      localStorage.setItem(
        SAVE,
        JSON.stringify({ unlocked, completed: [...completed], ...settings }),
      );
    } catch {}
  }
  function saveGame(manual = false) {
    persistPrefs();
    if (!sessionActive) return;
    if (state.result) return;
    try {
      const copy = JSON.parse(
        JSON.stringify(state, (key, value) =>
          key === "groundCover" ? undefined : value,
        ),
      );
      copy.fog = fog?.save();
      copy.enemyFog = enemyFog?.save();
      for (const u of copy.units) {
        u.path = [];
        u.pathGoal = null;
        u.pathTimer = 0;
      }
      localStorage.setItem(
        state.mode === "quickmatch"
          ? "cruciata-quickmatch-" + state.slot
          : CHECKPOINT,
        JSON.stringify({ version: 3, world: [W, H], camera, state: copy, uid }),
      );
      $("save-status").textContent = "CHRONICLE SAVED";
      if (manual) toast("Your settlement and company have been recorded.");
    } catch {
      if (manual)
        toast(
          "Browser storage is unavailable. This session can still be played.",
        );
    }
  }
  function updateView() {
    const r = canvas.getBoundingClientRect();
    const scale = camera.zoom;
    view = {
      w: Math.min(W, r.width / scale),
      h: Math.min(H, r.height / scale),
      scale,
      x: 0,
      y: 0,
    };
    camera.x = clamp(camera.x, view.w / 2, W - view.w / 2);
    camera.y = clamp(camera.y, view.h / 2, H - view.h / 2);
    view.x = camera.x - view.w / 2;
    view.y = camera.y - view.h / 2;
  }
  function pan(dx, dy) {
    camera.x += dx;
    camera.y += dy;
    updateView();
  }
  function zoom(delta, cursor = null) {
    const before = cursor ? point(cursor) : null;
    const r = canvas.getBoundingClientRect();
    camera.zoom = clamp(
      camera.zoom + delta,
      Math.max(canvas.clientWidth / W, canvas.clientHeight / H),
      2.4,
    );
    updateView();
    if (cursor) {
      camera.x =
        before.x - (cursor.clientX - r.left - r.width / 2) / camera.zoom;
      camera.y =
        before.y - (cursor.clientY - r.top - r.height / 2) / camera.zoom;
      updateView();
      mouse = point(cursor);
    }
  }
  function point(e) {
    updateView();
    const r = canvas.getBoundingClientRect();
    return {
      x: view.x + (e.clientX - r.left) / view.scale,
      y: view.y + (e.clientY - r.top) / view.scale,
    };
  }
  function home() {
    const b = state.buildings.find(
      (b) => b.kind === "towncenter" && b.team === 0,
    );
    if (b) {
      camera.x = b.x + 150;
      camera.y = b.y - 100;
      updateView();
    }
  }
  function playable() {
    return !state.paused && !state.result;
  }
  function friendUnits() {
    return state.units.filter((u) => u.team === 0 && u.hp > 0);
  }
  function fighters(team = 0) {
    return state.units.filter(
      (u) =>
        u.team === team &&
        u.hp > 0 &&
        !["worker", "civilian", "pilgrim", "merchant"].includes(u.type),
    );
  }
  function workers(team = 0) {
    return state.units.filter(
      (u) => u.team === team && u.type === "worker" && u.hp > 0,
    );
  }
  function completeBuildings(kind, team = 0) {
    return state.buildings.filter(
      (b) =>
        b.team === team &&
        b.hp > 0 &&
        b.progress >= 1 &&
        (!kind || b.kind === kind),
    );
  }
  function population(team = 0) {
    const total = state.units
        .filter((u) => u.team === team && u.hp > 0)
        .filter((u) => !["pilgrim", "merchant"].includes(u.type)).length,
      queued = completeBuildings(null, team).reduce(
        (n, b) => n + b.queue.filter((q) => q.kind === "unit").length,
        0,
      ),
      cap = Math.min(
        260,
        completeBuildings(null, team).reduce(
          (n, b) => n + (BUILDINGS[b.kind].pop || 0),
          0,
        ),
      );
    return { used: total, queued, cap };
  }
  function stock(team = 0) {
    return team === 0 ? state.resources : state.enemy.resources;
  }
  function afford(cost, team = 0) {
    return Object.entries(cost || {}).every(([r, n]) => stock(team)[r] >= n);
  }
  function pay(cost, mult = 1, team = 0) {
    for (const [r, n] of Object.entries(cost || {})) {
      stock(team)[r] -= n * mult;
      if (team === 1) state.enemy.paid[r] += n * mult;
    }
  }
  function costText(cost) {
    return Object.entries(cost || {})
      .map(([r, n]) => `${n} ${r}`)
      .join(" · ");
  }
  function makeUnit(type, team, x, y, extra = {}) {
    const t = TYPES[type];
    return {
      id: ++uid,
      type,
      team,
      x,
      y,
      hp: t.hp,
      maxHp: t.hp,
      angle: team === 1 ? 2.4 : -0.5,
      order: null,
      target: null,
      manualTarget: false,
      path: [],
      pathGoal: null,
      pathTimer: 0,
      pathRevision: 0,
      cooldown: (uid % 9) * 0.11,
      anim: 0,
      strike: 0,
      moving: false,
      working: false,
      hold: false,
      blessed: 0,
      job: null,
      carry: 0,
      carryType: null,
      fleeUntil: 0,
      formation: null,
      stuck: 0,
      deployment: "packed",
      deployTimer: 0,
      pendingOrder: null,
      ...extra,
    };
  }
  function makeBuilding(kind, team, x, y, progress = 1, extra = {}) {
    const base = BUILDINGS[kind];
    const t =
      kind === "gate" && extra.rotation === 90
        ? { ...base, w: base.h, h: base.w }
        : base;
    return {
      id: ++uid,
      kind,
      team,
      x,
      y,
      w: t.w,
      h: t.h,
      r: Math.max(t.w, t.h) / 2,
      hp: t.hp * (progress === 1 ? 1 : 0.2),
      maxHp: t.hp,
      progress,
      queue: [],
      remaining: kind === "farm" ? 2400 : undefined,
      max: kind === "farm" ? 2400 : undefined,
      rally: null,
      closed: kind === "gate" ? true : undefined,
      guardCooldown: 1,
      spent: { ...(t.cost || {}) },
      ...extra,
    };
  }
  function coastX(y) {
    return 175 + Math.sin(y / 170) * 34 + Math.cos(y / 67) * 12;
  }
  function bridgeY() {
    return state.config?.biome === 1 ? H * 0.5 : 1150;
  }
  function riverX(y) {
    return (
      (state.config?.biome === 1 ? W * 0.5 : 1610) + Math.sin(y / 330) * 165
    );
  }
  function groundFree(x, y, margin = 10, ignore = null, adjacentWalls = false) {
    if (x < 24 || y < 24 || x > W - 24 || y > H - 24) return false;
    const l = LEVELS[state.level];
    if (l.terrain === 0 && x < coastX(y) + 25 + margin) return false;
    if (
      (state.config ? state.config.biome === 1 : l.terrain === 1) &&
      Math.abs(x - riverX(y)) < 60 + margin &&
      Math.abs(y - bridgeY()) > 56 - margin
    )
      return false;
    const bucket = Math.floor(x / 128) + "," + Math.floor(y / 128),
      index =
        obstacleIndex && !state.navDirty && margin <= 64 ? obstacleIndex : null;
    for (const b of index
      ? index.buildings.get(bucket) || []
      : state.buildings) {
      if (
        b.id === ignore ||
        adjacentWalls === "all" ||
        (adjacentWalls && ["wall", "gate"].includes(b.kind)) ||
        b.hp <= 0 ||
        (BUILDINGS[b.kind].passable && !b.closed)
      )
        continue;
      if (b.kind === "wall" && Number.isFinite(b.wallAngle)) {
        const arms = Object.values(b.links || {});
        if (arms.length === 1) arms.push({ x: -arms[0].x, y: -arms[0].y });
        if (!arms.length) {
          const length =
            Math.abs(Math.sin(b.wallAngle) * Math.cos(b.wallAngle)) > 0.1
              ? Math.sqrt(2) * 16
              : 16;
          arms.push(
            {
              x: Math.cos(b.wallAngle) * length,
              y: Math.sin(b.wallAngle) * length,
            },
            {
              x: -Math.cos(b.wallAngle) * length,
              y: -Math.sin(b.wallAngle) * length,
            },
          );
        }
        for (const arm of arms) {
          const dx = x - b.x,
            dy = y - b.y,
            t = clamp(
              (dx * arm.x + dy * arm.y) / (arm.x * arm.x + arm.y * arm.y),
              0,
              1,
            );
          if (Math.hypot(dx - arm.x * t, dy - arm.y * t) < 11 + margin)
            return false;
        }
        continue;
      }
      if (
        Math.abs(x - b.x) < b.w / 2 + margin &&
        Math.abs(y - b.y) < b.h / 2 + margin
      )
        return false;
    }
    for (const d of index ? index.decorations.get(bucket) || [] : decorations) {
      if (!d.block) continue;
      if (d.kind === "ridge") {
        for (const segment of d.segments)
          if (
            segmentDistance({ x, y }, segment[0], segment[1]) <
            d.width / 2 + margin
          )
            return false;
      } else if (Math.hypot(x - d.x, y - d.y) < d.r + margin) return false;
    }
    for (const n of index ? index.nodes.get(bucket) || [] : state.nodes)
      if (
        n.remaining > 0 &&
        n.kind !== "food" &&
        Math.hypot(x - n.x, y - n.y) < (n.kind === "wood" ? 14 : 23) + margin
      )
        return false;
    return true;
  }
  function segmentDistance(p, a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      t = clamp(
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
        0,
        1,
      );
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  }
  function rebuildNavigation() {
    objectIndex.clear();
    obstacleIndex = {
      buildings: new Map(),
      decorations: new Map(),
      nodes: new Map(),
    };
    function insert(map, o, rx, ry) {
      for (
        let y = Math.floor((o.y - ry - 64) / 128);
        y <= Math.floor((o.y + ry + 64) / 128);
        y++
      )
        for (
          let x = Math.floor((o.x - rx - 64) / 128);
          x <= Math.floor((o.x + rx + 64) / 128);
          x++
        ) {
          const key = x + "," + y;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(o);
        }
    }
    for (const b of state.buildings)
      if (b.hp > 0)
        insert(
          obstacleIndex.buildings,
          b,
          Math.max(32, b.w / 2),
          Math.max(32, b.h / 2),
        );
    for (const d of decorations)
      if (d.block)
        insert(
          obstacleIndex.decorations,
          d,
          d.kind === "ridge" ? d.rx : d.r,
          d.kind === "ridge" ? d.ry : d.r,
        );
    for (const n of state.nodes)
      if (n.remaining > 0)
        insert(
          obstacleIndex.nodes,
          n,
          n.kind === "wood" ? 14 : 23,
          n.kind === "wood" ? 14 : 23,
        );
    for (const b of state.buildings)
      if (b.kind === "wall" && b.hp > 0) b.links = wallConnections(b);
    const waypoints = [];
    for (const b of state.buildings)
      if (b.hp > 0 && !(BUILDINGS[b.kind].passable && !b.closed))
        for (const dx of [-b.w / 2 - 6.25, b.w / 2 + 6.25])
          for (const dy of [-b.h / 2 - 6.25, b.h / 2 + 6.25])
            waypoints.push({ x: b.x + dx, y: b.y + dy });
    for (const obstacle of [
      ...state.nodes.filter((n) => n.remaining > 0 && n.kind !== "food"),
      ...decorations.filter((d) => d.block && d.kind !== "ridge"),
    ]) {
      const radius =
        (obstacle.kind === "wood"
          ? 14
          : obstacle.kind === "gold" || obstacle.kind === "stone"
            ? 23
            : obstacle.r) + 7;
      for (let i = 0; i < 16; i++)
        waypoints.push({
          x: obstacle.x + Math.cos((i * Math.PI) / 8) * radius,
          y: obstacle.y + Math.sin((i * Math.PI) / 8) * radius,
        });
    }
    nav.rebuild((x, y) => groundFree(x, y, 6), waypoints);
    for (const u of state.units) {
      u.path = [];
      u.pathTimer = 0;
    }
  }
  function findFree(p) {
    if (groundFree(p.x, p.y, 6)) return { ...p };
    const n = nav.nearest(p.x, p.y);
    return n
      ? { x: (n.x + 0.5) * nav.cell, y: (n.y + 0.5) * nav.cell }
      : { x: state.buildings[0].x + 120, y: state.buildings[0].y + 120 };
  }
  function spawnPoint(b) {
    const origin = findFree({ x: b.x + b.w / 2 + 36, y: b.y + b.h / 2 + 34 });
    const start = nav.nearest(origin.x, origin.y);
    for (let radius = 0; radius <= 320; radius += 32) {
      for (let i = 0; i < 16; i++) {
        const candidate = findFree({
          x: origin.x + Math.cos((i * Math.PI) / 8) * radius,
          y: origin.y + Math.sin((i * Math.PI) / 8) * radius,
        });
        const cell = nav.nearest(candidate.x, candidate.y);
        if (
          start &&
          cell &&
          nav.components[start.y * nav.cols + start.x] !==
            nav.components[cell.y * nav.cols + cell.x]
        )
          continue;
        if (state.units.every((u) => u.hp <= 0 || distance(u, candidate) >= 28))
          return candidate;
      }
    }
    return origin;
  }
  function edgePoint(u, target, extra = 27) {
    if (
      u.approach?.id === target.id &&
      u.approach.extra === extra &&
      u.approach.revision === nav.revision &&
      u.approach.expires > state.time
    )
      return u.approach.point;
    const start = nav.nearest(u.x, u.y),
      region = start ? nav.components[start.y * nav.cols + start.x] : null;
    const heading = Math.atan2(u.y - target.y, u.x - target.x);
    let best = null,
      score = Infinity;
    for (let i = 0; i < 16; i++) {
      const angle =
          heading + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 8,
        cx = Math.cos(angle),
        cy = Math.sin(angle);
      const radius = target.w
        ? Math.min(
            target.w / 2 / Math.max(0.01, Math.abs(cx)),
            target.h / 2 / Math.max(0.01, Math.abs(cy)),
          ) + extra
        : (target.r || 18) + extra;
      const n = nav.nearest(
        target.x + cx * radius,
        target.y + cy * radius,
        null,
      );
      if (!n) continue;
      const point = { x: (n.x + 0.5) * nav.cell, y: (n.y + 0.5) * nav.cell };
      if (surfaceDistance(point, target) > Math.max(65, extra + 32)) continue;
      if (
        region !== null &&
        nav.components[n.y * nav.cols + n.x] !== region &&
        !nav.find(u, point).length
      )
        continue;
      const value = distance(u, point) + i * 2;
      if (value < score) {
        best = point;
        score = value;
      }
    }
    const point = best || { ...findFree(u), unreachable: true };
    u.approach = {
      id: target.id,
      extra,
      revision: nav.revision,
      expires: state.time + 1.2,
      point,
    };
    return point;
  }
  function ensureGroundCover() {
    if (state.groundCover?.length) return;
    const random = seeded(state.seed ^ 0x47a51),
      biome =
        state.config?.biome ??
        (LEVELS[state.level].terrain === 2
          ? 3
          : LEVELS[state.level].terrain >= 3
            ? 2
            : LEVELS[state.level].terrain);
    state.groundCover = [];
    const count = Math.min(170, Math.ceil((W * H) / 1400000));
    for (let i = 0; i < count; i++) {
      const type =
        biome === 3
          ? "snow"
          : biome === 2
            ? "brush"
            : biome === 1 && i % 3 === 0
              ? "reeds"
              : "golden";
      const y =
        i === 0 ? state.buildings[0].y + 260 : 180 + random() * (H - 360);
      const x =
        i === 0
          ? state.buildings[0].x + 340
          : type === "reeds"
            ? riverX(y) + (i % 2 ? 1 : -1) * (85 + random() * 35)
            : 350 + random() * (W - 700);
      const rx = 90 + random() * 110,
        ry = 60 + random() * 90;
      const patch = {
        id: i,
        x,
        y,
        rx,
        ry,
        r: Math.max(rx, ry),
        type,
        stems: [],
      };
      for (let j = 0; j < 320; j++) {
        const angle = random() * Math.PI * 2,
          r = Math.sqrt(random()),
          px = x + Math.cos(angle) * rx * r,
          py = y + Math.sin(angle) * ry * r;
        if (
          !groundFree(px, py, 6) ||
          (state.roads || []).some((road) =>
            road.some(
              (b, k) =>
                k && segmentDistance({ x: px, y: py }, road[k - 1], b) < 23,
            ),
          )
        )
          continue;
        patch.stems.push({
          x: px,
          y: py,
          height: 6 + random() * (type === "reeds" ? 20 : 13),
          shade: j % 3,
          phase: random() * 6.28,
        });
      }
      if (patch.stems.length > 30) state.groundCover.push(patch);
    }
  }
  function planRoads() {
    const hubs = [
      state.buildings[0],
      state.buildings[1],
      ...state.buildings.filter((b) => b.team === 1 && b.kind === "towncenter"),
      ...state.sites,
    ].map((p) => findFree(p));
    const reached = [hubs.shift()],
      roads = [];
    while (hubs.length) {
      let best = { d: Infinity };
      for (let i = 0; i < hubs.length; i++)
        for (const a of reached) {
          const d = distance(a, hubs[i]);
          if (d < best.d) best = { d, i, a };
        }
      const b = hubs.splice(best.i, 1)[0],
        route = nav.find(best.a, b);
      if (route.length) roads.push([best.a, ...route]);
      reached.push(b);
    }
    return roads;
  }
  function makeWorld(generate = true) {
    obstacleIndex = null;
    objectIndex.clear();
    const l = LEVELS[state.level],
      random = seeded(state.seed);
    decorations = [];
    terrain = Art.terrain(
      W,
      H,
      state.config
        ? state.config.biome
        : l.terrain === 0
          ? 0
          : l.terrain === 1
            ? 1
            : l.terrain === 2
              ? 3
              : l.terrain >= 3
                ? 2
                : 0,
      state.mode === "quickmatch" ? () => -1000 : coastX,
      riverX,
      random,
      bridgeY(),
    );
    if (l.kind === "survival") {
      const g = terrain.getContext("2d");
      g.fillStyle = "#dce2cc33";
      g.fillRect(0, 0, W, H);
    }
    const road = [
      l.camp,
      { x: 1050, y: 1440 },
      { x: riverX(1150), y: 1150 },
      { x: 2010, y: 1030 },
      l.fort,
    ];
    for (let cluster = 0; cluster < 22; cluster++) {
      const cx = 350 + random() * (W - 700),
        cy = 200 + random() * (H - 400);
      if (state.buildings.some((b) => distance(b, { x: cx, y: cy }) < 450))
        continue;
      for (let i = 0; i < 4 + Math.floor(random() * 6); i++) {
        const a = i * 2.399,
          r = 25 + Math.sqrt(i) * 35;
        const d = {
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          kind: "rock",
          r: 17 + random() * 12,
          block: true,
          scale: 1,
        };
        if (groundFree(d.x, d.y, 12) && !road.some((p) => distance(d, p) < 180))
          decorations.push(d);
      }
    }
    for (let i = 0; i < 45; i++) {
      const d = {
        x: 250 + random() * (W - 500),
        y: 100 + random() * (H - 200),
        kind: "shrub",
        r: 0,
        block: false,
        scale: 0.4 + random() * 0.4,
      };
      if (groundFree(d.x, d.y, 0)) decorations.push(d);
    }
    state.terrainFeatures = [];
    for (let ridge = 0; ridge < 3; ridge++) {
      const points = [],
        start = W * (0.25 + ridge * 0.14),
        span = W * 0.4,
        phase = random() * Math.PI * 2;
      for (let i = 0; i < 19; i++) {
        const t = i / 18;
        points.push({
          x: start + span * t,
          y:
            H * (0.48 + ridge * 0.13) +
            Math.sin(t * Math.PI * 2 + phase) * (240 + ridge * 80) +
            t * 180,
        });
      }
      const segments = [];
      for (let i = 0; i < points.length - 1; i++) {
        if (
          ((state.config ? state.config.biome === 1 : l.terrain === 1) &&
            segmentDistance(
              { x: riverX(bridgeY()), y: bridgeY() },
              points[i],
              points[i + 1],
            ) < 300) ||
          [4, 12].includes(i) ||
          state.buildings.some(
            (b) => segmentDistance(b, points[i], points[i + 1]) < 340,
          )
        )
          continue;
        segments.push([points[i], points[i + 1]]);
      }
      const xs = points.map((p) => p.x),
        ys = points.map((p) => p.y),
        minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys);
      const d = {
        kind: "ridge",
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        rx: (maxX - minX) / 2 + 180,
        ry: (maxY - minY) / 2 + 180,
        r: 0,
        width: 180 + ridge * 25,
        biome:
          state.config?.biome ?? (l.terrain === 2 ? 3 : l.terrain >= 3 ? 2 : 0),
        segments,
        block: true,
      };
      decorations.push(d);
      state.terrainFeatures.push(d);
    }
    if (generate) {
      state.nodes = [];
      const clusters = [
        { kind: "wood", x: l.camp.x + 270, y: l.camp.y - 220, count: 20 },
        { kind: "wood", x: l.camp.x - 220, y: l.camp.y - 280, count: 16 },
        { kind: "food", x: l.camp.x + 270, y: l.camp.y + 170, count: 7 },
        { kind: "gold", x: l.camp.x + 500, y: l.camp.y + 60, count: 5 },
        { kind: "stone", x: l.camp.x + 400, y: l.camp.y - 450, count: 6 },
        { kind: "wood", x: 2080, y: 1300, count: 24 },
        { kind: "gold", x: 2150, y: 700, count: 6 },
        { kind: "stone", x: 1180, y: 680, count: 8 },
        { kind: "food", x: 1780, y: 870, count: 9 },
        { kind: "wood", x: 700, y: 580, count: 26 },
        { kind: "wood", x: 3340, y: 2370, count: 34 },
        { kind: "wood", x: 3900, y: 470, count: 32 },
        { kind: "gold", x: 3820, y: 2650, count: 10 },
        { kind: "stone", x: 4350, y: 1100, count: 12 },
        { kind: "food", x: 3620, y: 2720, count: 12 },
        { kind: "food", x: 4240, y: 560, count: 10 },
        { kind: "wood", x: 2450, y: 2900, count: 30 },
        { kind: "gold", x: 2820, y: 2750, count: 9 },
      ];
      const eh = state.buildings.find(
        (b) => b.kind === "towncenter" && b.team === 1,
      );
      for (const [i, kind] of ["food", "wood", "gold", "stone"].entries())
        clusters.push({
          kind,
          x: eh.x + (i % 2 ? 270 : -230),
          y: eh.y + (i < 2 ? -250 : 360),
          count: kind === "wood" ? 18 : 5,
        });
      for (const c of clusters.slice(5, -4)) {
        c.x = 450 + random() * (W - 900);
        c.y = 350 + random() * (H - 700);
      }
      const frequency = state.config?.frequency || 0.55;
      for (let i = 0; i < Math.floor(((W * H) / 1200000) * frequency); i++)
        clusters.push({
          kind: ["wood", "food", "gold", "stone"][i % 4],
          x: 450 + random() * (W - 900),
          y: 350 + random() * (H - 700),
          count: i % 4 === 0 ? 15 : 4,
        });
      for (const c of clusters)
        for (
          let i = 0;
          i <
          Math.max(
            c.kind === "wood" ? 8 : 3,
            Math.floor(c.count * (state.config?.frequency || 0.55)),
          );
          i++
        ) {
          const a = i * 2.4,
            r = 30 + Math.sqrt(i) * 34;
          const n = {
            id: ++uid,
            kind: c.kind,
            x: clamp(c.x + Math.cos(a) * r, 270, W - 180),
            y: clamp(c.y + Math.sin(a) * r, 130, H - 150),
            r: c.kind === "wood" ? 23 : 28,
            remaining: c.kind === "wood" ? 220 : c.kind === "food" ? 500 : 1300,
            max: c.kind === "wood" ? 220 : c.kind === "food" ? 500 : 1300,
            palm: state.config ? state.config.biome === 2 : l.terrain >= 3,
            snow: state.config ? state.config.biome === 3 : l.terrain === 2,
            scale: 0.9 + random() * 0.3,
          };
          if (
            (state.config ? state.config.biome === 1 : l.terrain === 1) &&
            Math.abs(n.x - riverX(n.y)) < 150
          )
            continue;
          if (state.buildings.some((b) => distance(b, n) < b.r + 45)) continue;
          if (!groundFree(n.x, n.y, 28)) continue;
          if (
            n.kind === "wood" &&
            state.units.some((u) => u.team !== 2 && distance(u, n) < 50)
          )
            continue;
          state.nodes.push(n);
        }
    }
  }
  function addVillage(x, y, site = false) {
    const id = ++uid;
    state.sites.push({
      id,
      x,
      y,
      r: 145,
      progress: 0,
      captured: false,
      name: site ? "Holy site" : "Road village",
    });
    for (let i = 0; i < 3; i++)
      state.buildings.push(
        makeBuilding(
          site && i === 0 ? "chapel" : "house",
          2,
          x + (i - 1) * 96,
          y + (i % 2) * 82,
          1,
          { site: id },
        ),
      );
    for (let i = 0; i < 5; i++)
      state.units.push(
        makeUnit("civilian", 2, x - 120 + i * 42, y + 125, {
          home: { x, y: y + 130 },
          wander: uid % 8,
          site: id,
        }),
      );
    return id;
  }
  function arrangeStartingBuildings() {
    obstacleIndex = null;
    decorations = [];
    const placed = [];
    const priority = (b) =>
      isCapital(b) ? 0 : ["wall", "gate"].includes(b.kind) ? 1 : 2;
    for (const b of [...state.buildings].sort(
      (a, b) => priority(a) - priority(b),
    )) {
      const valid = (p) => {
        if (
          p.x - b.w / 2 < 32 ||
          p.y - b.h / 2 < 32 ||
          p.x + b.w / 2 > W - 32 ||
          p.y + b.h / 2 > H - 32
        )
          return false;
        for (const dx of [-b.w / 2, 0, b.w / 2])
          for (const dy of [-b.h / 2, 0, b.h / 2])
            if (!groundFree(p.x + dx, p.y + dy, 6, null, "all")) return false;
        return !placed.some(
          (other) =>
            Math.abs(other.x - p.x) < (other.w + b.w) / 2 &&
            Math.abs(other.y - p.y) < (other.h + b.h) / 2,
        );
      };
      const origin = { x: b.x, y: b.y };
      if (!valid(origin)) {
        let found = false;
        for (let radius = 24; radius <= 1800 && !found; radius += 24)
          for (let i = 0; i < Math.ceil((radius * Math.PI * 2) / 24); i++) {
            const angle = (i * 24) / radius,
              p = {
                x: origin.x + Math.cos(angle) * radius,
                y: origin.y + Math.sin(angle) * radius,
              };
            if (valid(p)) {
              b.x = p.x;
              b.y = p.y;
              found = true;
              break;
            }
          }
      }
      placed.push(b);
      if (b.outpost) {
        const site = state.sites.find((site) => site.id === b.site);
        if (site) {
          site.x = b.x;
          site.y = b.y;
        }
      }
    }
  }
  function musterStartingUnits() {
    const occupied = [];
    const valid = (p) =>
      groundFree(p.x, p.y, 6) &&
      !state.buildings.some(
        (b) =>
          Math.abs(b.x - p.x) < b.w / 2 + 18 &&
          Math.abs(b.y - p.y) < b.h / 2 + 18,
      ) &&
      !occupied.some((u) => distance(u, p) < 24);
    for (const team of [0, 1, 2]) {
      const capital = state.buildings.find(
        (b) =>
          b.id === (team === 0 ? state.capitals.player : state.capitals.enemy),
      );
      const base =
        team === 2
          ? []
          : state.buildings.filter(
              (b) => b.team === team && distance(b, capital) < 850,
            );
      const front =
        team === 0
          ? Math.max(...base.map((b) => b.x + b.w / 2)) + 80
          : Math.min(...base.map((b) => b.x - b.w / 2)) - 80;
      const soldiers = state.units.filter(
        (u) => u.team === team && !["worker", "civilian"].includes(u.type),
      );
      for (const u of state.units.filter((u) => u.team === team)) {
        const index = soldiers.indexOf(u);
        const origin =
          index >= 0 && team !== 2
            ? {
                x: front + (team === 0 ? 1 : -1) * Math.floor(index / 10) * 30,
                y:
                  capital.y +
                  ((index % 10) - Math.min(9, soldiers.length - 1) / 2) * 30,
              }
            : { x: u.x, y: u.y };
        let p = origin;
        if (!valid(p)) {
          let found = false;
          for (let radius = 18; radius <= 1200 && !found; radius += 18)
            for (let i = 0; i < Math.ceil((radius * Math.PI * 2) / 18); i++) {
              const angle = (i * 18) / radius,
                candidate = {
                  x: origin.x + Math.cos(angle) * radius,
                  y: origin.y + Math.sin(angle) * radius,
                };
              if (valid(candidate)) {
                p = candidate;
                found = true;
                break;
              }
            }
        }
        u.x = p.x;
        u.y = p.y;
        occupied.push(p);
        if (team === 1 && u.home) u.home = { ...p };
      }
    }
  }
  function startLevel(index, intro = true) {
    sessionActive = true;
    const l = LEVELS[index];
    W = quickConfig?.width || 12800;
    H = quickConfig?.height || 8800;
    nav = new window.CruciataNavigation(W, H);
    uid = 0;
    selected.clear();
    selectedBuilding = null;
    selectedBuildings.clear();
    selectedNode = null;
    placement = null;
    mode = "move";
    drag = null;
    camera = { x: l.camp.x + 150, y: l.camp.y - 130, zoom: 1 };
    state = {
      version: 3,
      mode: quickConfig ? "quickmatch" : "campaign",
      config: quickConfig,
      slot: quickSlot,
      seed: quickConfig?.seed || 1888 + index * 331,
      upgrades: {},
      enemy: {
        faith: 25,
        gathered: { food: 0, wood: 0, gold: 0, stone: 0 },
        paid: { food: 0, wood: 0, gold: 0, stone: 0 },
        consumed: 0,
        resources: {
          food: 420 + index * 35,
          wood: 420 + index * 35,
          gold: 380 + index * 55,
          stone: 280 + index * 25,
        },
        upgrades: {},
        think: 0,
        scout: 0,
        attack: 0,
        discovered: false,
        spent: 0,
      },
      difficulty:
        quickConfig?.difficulty || $("campaign-difficulty")?.value || "normal",
      level: index,
      time: 0,
      paused: intro,
      result: null,
      resources: {
        food: 420 + index * 35,
        wood: 420 + index * 35,
        gold: 380 + index * 55,
        stone: 280 + index * 25,
      },
      faith: 25,
      units: [],
      buildings: [],
      nodes: [],
      sites: [],
      squads: [],
      formations: [],
      techs: {},
      controlGroups: {},
      particles: [],
      arrows: [],
      boulders: [],
      corpses: [],
      marks: [],
      rings: [],
      waveTimer: l.wave,
      saveTimer: 20,
      losses: 0,
      kills: 0,
      healed: 0,
      stats: {
        gathered: { food: 0, wood: 0, gold: 0, stone: 0 },
        built: 0,
        rescued: 0,
        siegeHits: 0,
      },
      citadelTaken: false,
      occupation: 0,
      navDirty: false,
    };
    state.buildings.push(
      makeBuilding("towncenter", 0, l.camp.x, l.camp.y),
      makeBuilding("fort", 1, l.fort.x, l.fort.y, 1, { hp: l.hp, maxHp: l.hp }),
      makeBuilding("barracks", 0, l.camp.x - 155, l.camp.y + 80),
      makeBuilding("house", 0, l.camp.x - 130, l.camp.y - 155),
      makeBuilding("house", 0, l.camp.x + 85, l.camp.y - 165),
    );
    if (!quickConfig)
      state.buildings.push(
        makeBuilding("tower", 0, l.camp.x + 230, l.camp.y - 35),
        makeBuilding("tower", 0, l.camp.x - 40, l.camp.y - 300),
      );
    const troopTypes = [
      "sword",
      "sword",
      "sword",
      "sword",
      "archer",
      "archer",
      "chaplain",
      "standard",
    ];
    if (index >= 2) troopTypes.push("sword", "archer", "knight");
    troopTypes.forEach((type, i) =>
      state.units.push(
        makeUnit(
          type,
          0,
          l.camp.x + 140 + (i % 4) * 30,
          l.camp.y - 115 - Math.floor(i / 4) * 32,
        ),
      ),
    );
    for (let i = 0; i < 6; i++)
      state.units.push(
        makeUnit(
          "worker",
          0,
          l.camp.x + 110 + (i % 3) * 26,
          l.camp.y + 90 + Math.floor(i / 3) * 28,
        ),
      );
    const garrison = [];
    for (let i = 0; i < 8 + index * 2; i++) {
      const u = makeUnit(
        i % 5 === 0 ? "archer" : i % 7 === 0 ? "knight" : "sword",
        1,
        l.fort.x - 210 + (i % 4) * 38,
        l.fort.y + 150 + Math.floor(i / 4) * 35,
        { squad: "garrison", home: { x: l.fort.x - 120, y: l.fort.y + 160 } },
      );
      state.units.push(u);
      garrison.push(u.id);
    }
    state.squads.push({
      id: "garrison",
      role: "guard",
      members: garrison,
      origin: { x: l.fort.x, y: l.fort.y },
      phase: "guard",
      timer: 0,
    });
    if (l.kind === "escort") {
      state.buildings.push(makeBuilding("tower", 1, riverX(1150) + 170, 1000));
      for (let i = 0; i < 3; i++)
        state.units.push(
          makeUnit("pilgrim", 0, l.camp.x + 230 + i * 45, l.camp.y + 150, {
            route: [
              { x: 1100, y: 1420 },
              { x: riverX(1150) - 110, y: 1150 },
              { x: riverX(1150) + 160, y: 1150 },
              { x: 2290, y: 840 },
              { x: 2930, y: 420 },
            ],
            routeIndex: 0,
          }),
        );
      state.sites.push({
        id: ++uid,
        x: 2930,
        y: 420,
        r: 90,
        name: "Pilgrim refuge",
        captured: true,
        progress: 1,
      });
    }
    if (l.kind === "liberation") {
      addVillage(1370, 680);
      addVillage(2350, 1500);
    } else if (l.kind === "occupation") {
      addVillage(2180, 620, true);
      addVillage(2780, 1380, true);
    } else addVillage(1910, 1000);
    if (l.kind === "siege") {
      for (const p of [
        { x: 2270, y: 790 },
        { x: 2680, y: 1080 },
        { x: 2420, y: 1420 },
      ])
        state.buildings.push(
          makeBuilding("fort", 1, p.x, p.y, 1, {
            gate: true,
            hp: 4200,
            maxHp: 4200,
            w: 135,
            h: 115,
            r: 70,
          }),
        );
      for (let i = 0; i < 19; i++)
        if (i < 8 || i > 10)
          state.buildings.push(makeBuilding("wall", 1, 2400 + i * 32, 1210));
      state.buildings.push(
        makeBuilding("gate", 1, 2688, 1210, 1, { closed: true }),
      );
      state.resources.wood += 220;
      state.resources.stone += 180;
    }
    if (l.terrain >= 4) {
      for (let i = 0; i < 17; i++)
        state.buildings.push(
          makeBuilding(
            "house",
            2,
            2700 + (i % 4) * 95,
            1520 + Math.floor(i / 4) * 93,
          ),
        );
    }
    for (const p of [
      { x: 3650, y: 2480 },
      { x: 4090, y: 760 },
    ]) {
      const id = addVillage(p.x, p.y);
      state.sites.find((site) => site.id === id).optional = true;
      state.sites.find((site) => site.id === id).name = "Frontier settlement";
    }
    if (quickConfig) {
      const count = quickConfig.units;
      state.units = [];
      state.squads = [];
      for (let i = 0; i < (quickConfig.workers || 6); i++)
        state.units.push(
          makeUnit(
            "worker",
            0,
            l.camp.x + 110 + (i % 5) * 22,
            l.camp.y + 90 + Math.floor(i / 5) * 24,
          ),
        );
      state.sites = [];
      state.buildings = state.buildings.slice(0, 5);
      state.buildings[1] = makeBuilding("house", 1, W - 850, 800);
      state.buildings[1].x = W - 850;
      state.buildings[1].y = 800;
      state.resources = {
        food: quickConfig.resources,
        wood: quickConfig.resources,
        gold: quickConfig.resources,
        stone: quickConfig.resources,
      };
      state.enemy.resources = { ...state.resources };
      for (const team of [0, 1])
        for (let i = 0; i < count; i++) {
          const home = team === 0 ? l.camp : state.buildings[1];
          state.units.push(
            makeUnit(
              quickConfig.composition === "vanguard"
                ? "sword"
                : quickConfig.composition === "cavalry"
                  ? i % 3
                    ? "knight"
                    : "archer"
                  : quickConfig.composition === "siege"
                    ? i % 8 === 0
                      ? "trebuchet"
                      : i % 3
                        ? "sword"
                        : "archer"
                    : i % 3 === 0
                      ? "archer"
                      : "sword",
              team,
              home.x + 140 + (i % 6) * 22,
              home.y - 115 - Math.floor(i / 6) * 24,
            ),
          );
        }
      if (quickConfig.structures === "developed")
        for (const team of [0, 1]) {
          const home = team === 0 ? l.camp : state.buildings[1];
          for (const [i, kind] of [
            "stable",
            "chapel",
            "siegeworkshop",
            "farm",
            "farm",
          ].entries())
            state.buildings.push(
              makeBuilding(
                kind,
                team,
                home.x - 200 + (i % 3) * 150,
                home.y + 260 + Math.floor(i / 3) * 145,
              ),
            );
        }
    }
    const enemyHome = quickConfig
      ? state.buildings[1]
      : { x: W - 2000, y: Math.floor(H * 0.34) };
    if (!quickConfig) {
      // Forward capturable posts have no owner, troops or faction vision.
      for (const b of state.buildings) {
        if (
          (b === state.buildings[1] && l.kind === "settlement") ||
          (b.kind === "tower" && b.team === 1)
        ) {
          const site = {
            id: ++uid,
            x: b.x,
            y: b.y,
            r: 145,
            progress: 0,
            captured: false,
            team: 2,
            name: b.kind === "tower" ? "Bridge outpost" : "Coastal outpost",
            optional: l.kind !== "settlement",
            outpost: true,
          };
          state.sites.push(site);
          b.team = 2;
          b.site = site.id;
          b.outpost = true;
        }
      }
      const dx = enemyHome.x - l.fort.x,
        dy = enemyHome.y - l.fort.y;
      for (const b of state.buildings)
        if (b.team === 1) {
          b.x += dx;
          b.y += dy;
        }
      for (const u of state.units)
        if (u.team === 1) {
          u.x += dx;
          u.y += dy;
          if (u.home) {
            u.home.x += dx;
            u.home.y += dy;
          }
        }
      for (const squad of state.squads)
        if (squad.origin) {
          squad.origin.x += dx;
          squad.origin.y += dy;
        }
    }
    state.buildings.push(
      makeBuilding("towncenter", 1, enemyHome.x + 240, enemyHome.y + 20),
      makeBuilding("barracks", 1, enemyHome.x + 240, enemyHome.y + 200),
      makeBuilding("house", 1, enemyHome.x + 90, enemyHome.y + 300),
    );
    for (let i = 0; i < (quickConfig?.workers || 6); i++)
      state.units.push(
        makeUnit(
          "worker",
          1,
          enemyHome.x + 360 + (i % 3) * 24,
          enemyHome.y + 80 + Math.floor(i / 3) * 26,
        ),
      );
    if (quickConfig && quickConfig.units + (quickConfig.workers || 6) > 56) {
      for (const team of [0, 1]) {
        const home = team === 0 ? l.camp : enemyHome;
        for (
          let i = 0;
          i <
          Math.ceil((quickConfig.units + (quickConfig.workers || 6) - 56) / 12);
          i++
        )
          state.buildings.push(
            makeBuilding(
              "house",
              team,
              home.x - 250 + (i % 3) * 100,
              home.y + 430 + Math.floor(i / 3) * 100,
            ),
          );
      }
    }
    if (!quickConfig)
      for (let i = 0; i < 3; i++) {
        const id = addVillage(W * (0.34 + i * 0.19), H * (0.39 + i * 0.13));
        state.sites.find((s) => s.id === id).optional = true;
      }
    state.capitals = {
      player: state.buildings[0].id,
      enemy: state.buildings.find(
        (b) => b.kind === "towncenter" && b.team === 1,
      ).id,
    };
    arrangeStartingBuildings();
    makeWorld();
    rebuildNavigation();
    musterStartingUnits();
    state.roads = planRoads();
    ensureGroundCover();
    for (const u of state.units)
      if (!groundFree(u.x, u.y, 6)) {
        const p = findFree(u);
        u.x = p.x;
        u.y = p.y;
      }
    fog = new window.CruciataFog(W, H);
    enemyFog = new window.CruciataFog(W, H, null, 1);
    fog.update(state.units, state.buildings);
    enemyFog.update(state.units, state.buildings);
    for (const team of [0, 1])
      workers(team).forEach((u, i) =>
        assignGather(
          u,
          ["food", "wood", "wood", "gold", "stone", "food"][i % 6],
        ),
      );
    visionTimer = 0;
    setTab("army");
    setMissionUI();
    renderLevelNav();
    updateView();
    if (intro)
      showOverlay(
        state.mode === "quickmatch" ? "QUICKMATCH" : "CHAPTER " + l.roman,
        state.mode === "quickmatch" ? "Standards over the frontier" : l.name,
        state.mode === "quickmatch"
          ? `A ${W} by ${H} battlefield. ${state.difficulty} enemy command. Both armies must build, gather and explore. Destroy the opposing town center to win.`
          : l.story,
        "Begin the march",
        () => {
          state.paused = false;
          hideOverlay();
          updateUI();
          sound("horn");
          if (!TEST) saveGame();
          toast(
            "Right-click resources with villagers to gather. Build farms and storehouses to sustain the host.",
          );
        },
      );
    else hideOverlay();
    updateUI();
  }
  function setMissionUI() {
    const l = LEVELS[state.level];
    $("chapter-label").textContent = `CHAPTER ${l.roman} · ${l.sub}`;
    $("mission-title").textContent = l.title;
    $("map-name").textContent = l.sub;
    $("weather-label").textContent = l.date;
    $("objective-text").textContent = l.objective;
    $("objective-sub").textContent =
      l.desc +
      " Destroy the opposing capital for immediate victory; losing your capital is defeat.";
    if (state.mode === "quickmatch") {
      $("chapter-label").textContent = "QUICKMATCH";
      $("mission-title").textContent = "Standards over the frontier";
      $("objective-text").textContent = "Defeat the opposing settlement";
      $("objective-sub").textContent =
        "Destroy its town center. Both armies must gather, build and explore.";
      $("map-name").textContent = "SEED " + state.seed;
    }
  }
  function migrateChronicle(saved) {
    if (saved?.version !== 2 || !saved.state || !LEVELS[saved.state.level])
      return saved;
    const old = saved.state,
      index = old.level;
    uid = Math.max(
      saved.uid || 0,
      ...[...old.units, ...old.buildings, ...old.nodes].map((o) => o.id),
    );
    old.version = 3;
    old.mode = "campaign";
    old.config = null;
    old.slot = null;
    old.seed = 1888 + index * 331;
    old.difficulty = "normal";
    old.upgrades = {};
    old.techs = {};
    old.formations ||= [];
    old.enemy = {
      resources: {
        food: 420 + index * 35,
        wood: 420 + index * 35,
        gold: 380 + index * 55,
        stone: 280 + index * 25,
      },
      upgrades: {},
      faith: 25,
      gathered: { food: 0, wood: 0, gold: 0, stone: 0 },
      paid: { food: 0, wood: 0, gold: 0, stone: 0 },
      consumed: 0,
      think: 0,
      scout: 0,
      attack: 0,
      discovered: false,
      spent: 0,
    };
    old.units = old.units.filter((u) => !!TYPES[u.type]);
    for (const b of old.buildings) {
      if (b.kind === "market") b.kind = "house";
      const spec = BUILDINGS[b.kind];
      if (!spec) continue;
      b.w = spec.w;
      b.h = spec.h;
      b.r = Math.max(b.w, b.h) / 2;
      b.queue = b.queue.filter((q) => {
        if (q.kind === "research") {
          if (b.team === 0)
            for (const [r, n] of Object.entries(q.cost || {}))
              old.resources[r] += n;
          return false;
        }
        return !!TYPES[q.type];
      });
      if (b.kind === "farm") {
        b.remaining = 2400;
        b.max = 2400;
      }
    }
    if (
      !old.buildings.some(
        (b) => b.team === 1 && b.kind === "towncenter" && b.hp > 0,
      )
    ) {
      const fort = old.buildings.find(
          (b) => b.team === 1 && b.kind === "fort" && b.hp > 0,
        ),
        home = fort ? { x: fort.x + 240, y: fort.y + 20 } : { x: 5300, y: 700 };
      old.buildings.push(
        makeBuilding("towncenter", 1, home.x, home.y),
        makeBuilding("barracks", 1, home.x, home.y + 180),
        makeBuilding("house", 1, home.x - 170, home.y + 220),
      );
      for (let i = 0; i < 6; i++)
        old.units.push(
          makeUnit(
            "worker",
            1,
            home.x + 130 + (i % 3) * 24,
            home.y + 90 + Math.floor(i / 3) * 24,
          ),
        );
      for (const [j, kind] of ["food", "wood", "gold", "stone"].entries())
        for (let i = 0; i < (kind === "wood" ? 10 : 4); i++) {
          const max = kind === "wood" ? 220 : kind === "food" ? 500 : 1300;
          old.nodes.push({
            id: ++uid,
            kind,
            x:
              home.x +
              (j % 2 ? 270 : -230) +
              Math.cos(i * 2.4) * Math.sqrt(i + 1) * 35,
            y:
              home.y +
              (j < 2 ? -220 : 350) +
              Math.sin(i * 2.4) * Math.sqrt(i + 1) * 35,
            r: kind === "wood" ? 23 : 28,
            remaining: max,
            max,
            palm: index >= 3,
            scale: 1,
          });
        }
    }
    // Keep the old checkpoint as a backup; all subsequent saves use the new format.
    return { ...saved, version: 3, world: [6400, 4400], uid, state: old };
  }
  function restoreGame(slot = null) {
    let saved,
      legacyFallback = false;
    try {
      const current = localStorage.getItem(
        slot === null ? CHECKPOINT : "cruciata-quickmatch-" + slot,
      );
      const legacy =
        slot === null && !current
          ? localStorage.getItem("cruciata-checkpoint-v2")
          : null;
      legacyFallback = !!legacy;
      saved = JSON.parse(current || legacy || "null");
    } catch {}
    // Retain the legacy backup, but never resume an already completed chapter from it.
    if (legacyFallback && completed.has(saved?.state?.level)) return false;
    saved = migrateChronicle(saved);
    if (
      !saved ||
      saved.version !== 3 ||
      !saved.state ||
      !LEVELS[saved.state.level] ||
      saved.state.result ||
      !saved.world?.[0]
    )
      return false;
    W = saved.world[0];
    H = saved.world[1];
    nav = new window.CruciataNavigation(W, H);
    state = saved.state;
    for (const b of state.buildings) {
      if (!["wall", "gate"].includes(b.kind) && !b.gate) continue;
      const reinforcedHp =
        b.kind === "wall" ? BUILDINGS.wall.hp : BUILDINGS.gate.hp;
      if (b.maxHp < reinforcedHp) {
        b.hp *= reinforcedHp / b.maxHp;
        b.maxHp = reinforcedHp;
      }
    }
    sessionActive = true;
    quickConfig = state.config;
    quickSlot = state.slot;
    state.controlGroups ||= {};
    uid = saved.uid || 0;
    camera = saved.camera || {
      x: state.buildings[0].x,
      y: state.buildings[0].y,
      zoom: 1,
    };
    state.paused = true;
    selected.clear();
    selectedBuilding = null;
    makeWorld(false);
    fog = new window.CruciataFog(W, H, state.fog);
    enemyFog = new window.CruciataFog(W, H, state.enemyFog, 1);
    enemyFog.update(state.units, state.buildings);
    fog.update(state.units, state.buildings);
    rebuildNavigation();
    ensureGroundCover();
    setMissionUI();
    renderLevelNav();
    setTab("army");
    updateView();
    showOverlay(
      "THE CHRONICLE CONTINUES",
      state.mode === "quickmatch"
        ? "Standards over the frontier"
        : LEVELS[state.level].name,
      "Your settlement, stores, buildings, and company have been restored. The battle waits for your command.",
      "Resume the march",
      () => {
        state.paused = false;
        hideOverlay();
        updateUI();
      },
    );
    updateUI();
    return true;
  }
  function renderLevelNav() {
    $("level-list").replaceChildren();
    LEVELS.forEach((l, i) => {
      const b = document.createElement("button");
      b.className = "level" + (i === state.level ? " active" : "");
      b.disabled = i > unlocked;
      b.innerHTML = `<span class="level-number">${l.roman}</span><span><span class="level-name">${l.name}</span><span class="level-sub">${l.sub}</span></span><span class="level-marker">${completed.has(i) ? "✓" : i > unlocked ? "⌑" : "◦"}</span>`;
      b.addEventListener("click", () => {
        if (i !== state.level) startLevel(i);
      });
      $("level-list").append(b);
    });
  }
  function showOverlay(label, title, body, button, action) {
    const o = $("overlay");
    o.replaceChildren();
    o.classList.remove("hidden");
    for (const [tag, className, text] of [
      ["span", "result-cross", "✠"],
      ["div", "eyebrow", label],
      ["h2", "", title],
      ["p", "", body],
    ]) {
      const e = document.createElement(tag);
      e.className = className;
      e.textContent = text;
      o.append(e);
    }
    const b = document.createElement("button");
    b.textContent = button;
    b.addEventListener("click", action);
    o.append(b);
  }
  function hideOverlay() {
    $("overlay").classList.add("hidden");
    $("pause-button").textContent = "Ⅱ Pause";
  }
  function togglePause() {
    if (state.result) return;
    if (!state.time && !$("overlay").classList.contains("hidden")) return;
    state.paused = !state.paused;
    if (state.paused) {
      showOverlay(
        "A MOMENT OF RESPITE",
        "Make camp.",
        "The battle and the settlement are paused.",
        "Resume the march",
        () => {
          state.paused = false;
          hideOverlay();
          updateUI();
        },
      );
      $("pause-button").textContent = "▶ Resume";
      saveGame();
    } else hideOverlay();
    updateUI();
  }
  function finish(won) {
    if (state.result) return;
    state.result = won ? "victory" : "defeat";
    state.paused = true;
    const l = LEVELS[state.level];
    if (won && state.mode !== "quickmatch") {
      completed.add(state.level);
      unlocked = Math.max(unlocked, Math.min(5, state.level + 1));
      persistPrefs();
      sound("bell");
      renderLevelNav();
    }
    try {
      localStorage.removeItem(
        state.mode === "quickmatch"
          ? "cruciata-quickmatch-" + state.slot
          : CHECKPOINT,
      );
    } catch {}
    if (won && state.mode !== "quickmatch") {
      hideOverlay();
      $("debug-menu")?.close();
      updateUI();
      window.CruciataMenus.campaign();
      return;
    }
    showOverlay(
      state.mode === "quickmatch"
        ? "BATTLE COMPLETE"
        : won
          ? "CHAPTER COMPLETE"
          : "THE CHRONICLE REMEMBERS",
      state.mode === "quickmatch"
        ? won
          ? "Quickmatch won."
          : "Your settlement has fallen."
        : won
          ? state.level === 5
            ? "Jerusalem is taken."
            : "The standard still flies."
          : "The settlement has fallen.",
      (state.mode === "quickmatch"
        ? won
          ? "The opposing town center is destroyed. Your host holds the battlefield."
          : "Your town center has fallen. Return to the session menu to prepare another host."
        : won
          ? l.win
          : "Your town centre or your entrusted pilgrims have been lost. Gather the company, protect your workers, and try a different plan.") +
        ` ${state.losses} of your people fell.`,
      state.mode === "quickmatch"
        ? "Return to sessions"
        : won && state.level < 5
          ? "Continue to " + LEVELS[state.level + 1].name
          : "March again",
      () => {
        if (state.mode === "quickmatch") window.CruciataMenus.slots();
        else startLevel(won && state.level < 5 ? state.level + 1 : state.level);
      },
    );
    updateUI();
  }
  function getObject(id) {
    const cached = objectIndex.get(id);
    if (cached && (cached.hp === undefined || cached.hp > 0)) return cached;
    return (
      state.units.find((o) => o.id === id && o.hp > 0) ||
      state.buildings.find((o) => o.id === id && o.hp > 0) ||
      state.nodes.find((o) => o.id === id)
    );
  }
  function rebuildSpatial() {
    spatial = new Map();
    objectIndex.clear();
    for (const o of [...state.units, ...state.buildings, ...state.nodes])
      objectIndex.set(o.id, o);
    for (const u of state.units)
      if (u.hp > 0) {
        const key = Math.floor(u.x / 200) + "," + Math.floor(u.y / 200);
        if (!spatial.has(key)) spatial.set(key, []);
        spatial.get(key).push(u);
      }
  }
  function nearby(u, r) {
    const out = [],
      sx = Math.floor((u.x - r) / 200),
      ex = Math.floor((u.x + r) / 200),
      sy = Math.floor((u.y - r) / 200),
      ey = Math.floor((u.y + r) / 200);
    for (let y = sy; y <= ey; y++)
      for (let x = sx; x <= ex; x++)
        for (const other of spatial.get(x + "," + y) || [])
          if (other.hp > 0 && distance(u, other) < r) out.push(other);
    return out;
  }
  function resourceCluster(target) {
    if (target.kind === "farm") return [target.id];
    const members = [target],
      ids = new Set([target.id]);
    for (let i = 0; i < members.length; i++)
      for (const n of state.nodes)
        if (
          n.kind === target.kind &&
          !ids.has(n.id) &&
          distance(n, members[i]) <= 180
        ) {
          ids.add(n.id);
          members.push(n);
        }
    return [...ids];
  }
  function assignGather(u, resource, node = null, cluster = null) {
    const choices = state.nodes
      .filter(
        (n) =>
          n.kind === resource &&
          (!cluster || cluster.includes(n.id)) &&
          n.remaining > 0 &&
          (u.team === 0 ? fog : enemyFog)?.remembers(n),
      )
      .concat(
        resource === "food"
          ? completeBuildings("farm", u.team)
              .filter(
                (b) =>
                  (!cluster || cluster.includes(b.id)) &&
                  state.units.filter(
                    (w) => w.id !== u.id && w.job?.target === b.id,
                  ).length < 5,
              )
              .map((b) => ({
                ...b,
                resource: "food",
                remaining: b.remaining,
              }))
          : [],
      );
    const target =
      node ||
      choices
        .sort((a, b) => distance(u, a) - distance(u, b))
        .find((n) => !edgePoint(u, n, 16).unreachable);
    if (
      !target ||
      (target.kind === "farm" &&
        state.units.filter((w) => w.id !== u.id && w.job?.target === target.id)
          .length >= 5)
    ) {
      u.job = null;
      u.moving = false;
      u.path = [];
      u.exhaustedCluster = !!cluster;
      return false;
    }
    u.exhaustedCluster = false;
    u.job = {
      kind: "gather",
      cluster: cluster || resourceCluster(target),
      resource,
      target: target.id,
      phase: u.carry > 0 ? "deliver" : "approach",
    };
    u.order = null;
    u.hold = false;
    u.pathTimer = 0;
    return true;
  }
  function resourceAt(p) {
    const n = state.nodes
      .filter((n) => n.remaining > 0 && distance(n, p) < n.r + 15)
      .sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (n) return n;
    return state.buildings.find(
      (b) =>
        b.kind === "farm" &&
        b.team === 0 &&
        b.progress >= 1 &&
        b.hp > 0 &&
        Math.abs(b.x - p.x) < b.w / 2 &&
        Math.abs(b.y - p.y) < b.h / 2,
    );
  }
  function autoScout() {
    if (!playable()) return;
    const members = fighters().filter(
      (u) =>
        selected.has(u.id) &&
        (u.type !== "trebuchet" || u.deployment === "packed"),
    );
    if (!members.length) {
      toast("Select a company to explore together.");
      return;
    }
    const id = ++uid;
    for (const u of members) {
      u.autoScout = id;
      u.target = null;
      u.manualTarget = false;
      u.hold = false;
      u.order = null;
      u.pathTimer = 0;
    }
    state.scoutingGroups ||= [];
    state.scoutingGroups.push({
      id,
      members: members.map((u) => u.id),
      think: 0,
      retreatUntil: 0,
      status: "exploring",
      goal: null,
    });
    toast(
      "The company will explore unseen land together and withdraw from attacks. Move, attack or hold ends scouting.",
    );
    updateUI();
  }
  function scoutCompany(group, members, destination) {
    const id = ++uid,
      center = members.reduce(
        (p, u) => ({
          x: p.x + u.x / members.length,
          y: p.y + u.y / members.length,
        }),
        { x: 0, y: 0 },
      );
    const a = Math.atan2(destination.y - center.y, destination.x - center.x),
      slots = [],
      cols = Math.max(3, Math.ceil(Math.sqrt(members.length)));
    [...members]
      .sort((a, b) => TYPES[a.type].rank - TYPES[b.type].rank)
      .forEach((u, i) => {
        const rear =
            Math.floor(i / cols) * 32 + (u.type === "chaplain" ? 90 : 0),
          side = ((i % cols) - (cols - 1) / 2) * 32;
        const goal = reserveSlot(
          marchPoint({
            x: destination.x - Math.cos(a) * rear - Math.sin(a) * side,
            y: destination.y - Math.sin(a) * rear + Math.cos(a) * side,
          }),
          slots,
        );
        const order = { ...goal, attack: false, formation: id };
        u.marchOffset = {
          x: goal.x - destination.x,
          y: goal.y - destination.y,
        };
        u.pathTimer = 0;
        u.target = null;
        if (u.type === "trebuchet" && u.deployment !== "packed") {
          u.deployment = "packing";
          u.deployTimer = 4;
          u.pendingOrder = order;
          u.order = null;
        } else u.order = order;
      });
    state.formations.push({
      id,
      members: members.map((u) => u.id),
      anchor: center,
      destination,
      path: nav.find(center, destination),
      revision: nav.revision,
      speed: Math.min(...members.map((u) => TYPES[u.type].speed)),
      arrived: false,
      wait: 0,
    });
    group.goal = destination;
    group.formation = id;
  }
  function updateScouting(dt) {
    state.scoutingGroups ||= [];
    state.scoutingGroups = state.scoutingGroups.filter((g) =>
      g.members.some((id) =>
        state.units.some(
          (u) => u.id === id && u.hp > 0 && u.autoScout === g.id,
        ),
      ),
    );
    for (const group of state.scoutingGroups) {
      const members = state.units.filter(
        (u) => u.hp > 0 && u.autoScout === group.id,
      );
      group.think -= dt;
      if (group.think > 0) continue;
      group.think = 0.6;
      const center = members.reduce(
        (p, u) => ({
          x: p.x + u.x / members.length,
          y: p.y + u.y / members.length,
        }),
        { x: 0, y: 0 },
      );
      const threat = state.units
        .filter(
          (u) =>
            u.team === 1 &&
            u.hp > 0 &&
            TYPES[u.type].damage > 0 &&
            fog.sees(u) &&
            members.some((m) => distance(m, u) < 240),
        )
        .sort((a, b) => distance(a, center) - distance(b, center))[0];
      const attacked = members.some((u) => u.lastHit > state.time - 4);
      if ((threat || attacked) && state.time >= group.retreatUntil) {
        const attacker =
          threat ||
          getObject(
            members.find((u) => u.lastHit > state.time - 4)?.lastAttacker,
          );
        const a = attacker
          ? Math.atan2(center.y - attacker.y, center.x - attacker.x)
          : Math.atan2(
              state.buildings[0].y - center.y,
              state.buildings[0].x - center.x,
            );
        const goal = findFree({
          x: center.x + Math.cos(a) * 600,
          y: center.y + Math.sin(a) * 600,
        });
        scoutCompany(group, members, goal);
        group.retreatUntil = state.time + 10;
        group.status = "withdrawing";
        continue;
      }
      if (state.time < group.retreatUntil) continue;
      const formation = state.formations.find((f) => f.id === group.formation);
      if (
        formation &&
        !formation.arrived &&
        members.some((u) => u.order || u.pendingOrder)
      )
        continue;
      // Sample exploration cells only; never use undiscovered enemy locations.
      let best = null,
        score = Infinity;
      const origin = nav.nearest(center.x, center.y),
        region = origin ? nav.components[origin.y * nav.cols + origin.x] : null;
      for (let y = 240; y < H - 120; y += 240)
        for (let x = 240; x < W - 120; x += 240) {
          const p = { x, y };
          if (
            fog.remembers(p) ||
            distance(center, p) < 180 ||
            !groundFree(x, y, 24)
          )
            continue;
          const cell = nav.nearest(x, y);
          if (!cell || nav.components[cell.y * nav.cols + cell.x] !== region)
            continue;
          const value = distance(center, p);
          if (value < score) {
            best = p;
            score = value;
          }
        }
      if (best) {
        group.status = "exploring";
        scoutCompany(group, members, findFree(best));
      } else {
        group.status = "survey complete";
        group.goal = null;
      }
    }
  }
  function updateFormations() {
    state.formations ||= [];
    state.formations = state.formations.filter((f) =>
      f.members.some((id) =>
        state.units.some(
          (u) =>
            u.id === id &&
            u.hp > 0 &&
            (u.order?.formation === f.id || u.pendingOrder?.formation === f.id),
        ),
      ),
    );
    for (const f of state.formations) {
      const members = state.units.filter(
        (u) =>
          f.members.includes(u.id) &&
          u.hp > 0 &&
          (u.order?.formation === f.id || u.pendingOrder?.formation === f.id),
      );
      if (!members.length) continue;
      if (f.escortId) {
        const wagon = getObject(f.escortId);
        if (wagon)
          for (const u of members)
            if (u.order) {
              const next = wagon.route[wagon.routeIndex] || wagon,
                a = Math.atan2(next.y - wagon.y, next.x - wagon.x);
              u.order.x = wagon.x + Math.cos(a) * 90 + (u.marchOffset?.x || 0);
              u.order.y = wagon.y + Math.sin(a) * 90 + (u.marchOffset?.y || 0);
              const goal = marchPoint(u.order);
              u.order.x = goal.x;
              u.order.y = goal.y;
            }
      }
      // Arrival slots are stable goals. There is no moving anchor, waiting or slot chasing.
      f.anchor = members.reduce(
        (p, u) => ({
          x: p.x + u.x / members.length,
          y: p.y + u.y / members.length,
        }),
        { x: 0, y: 0 },
      );
      f.arrived = members.every(
        (u) => distance(u, u.order || u.pendingOrder) < 40,
      );
    }
  }
  function reserveSlot(p, slots) {
    if (slots.some((q) => distance(p, q) < 24)) {
      let found = null;
      for (let radius = 32; radius <= 192 && !found; radius += 32)
        for (let i = 0; i < 16; i++) {
          const q = marchPoint({
            x: p.x + Math.cos((i * Math.PI) / 8) * radius,
            y: p.y + Math.sin((i * Math.PI) / 8) * radius,
          });
          if (!slots.some((s) => distance(s, q) < 24)) {
            found = q;
            break;
          }
        }
      if (found) p = found;
    }
    slots.push(p);
    return p;
  }
  function marchPoint(p) {
    return groundFree(p.x, p.y, 6) ? p : findFree(p);
  }
  function rallyPosition(u, origin) {
    const occupied = state.units.filter(
      (v) => v.id !== u.id && v.hp > 0 && v.team === u.team,
    );
    const available = (p) =>
      groundFree(p.x, p.y, 6) &&
      !occupied.some(
        (v) => distance(v, p) < 32 || (v.order && distance(v.order, p) < 32),
      );
    if (available(origin)) return { ...origin };
    for (let radius = 40; radius <= 640; radius += 40) {
      const count = Math.ceil((2 * Math.PI * radius) / 40);
      for (let i = 0; i < count; i++) {
        const angle = (i * 2 * Math.PI) / count;
        const p = {
          x: origin.x + Math.cos(angle) * radius,
          y: origin.y + Math.sin(angle) * radius,
        };
        if (available(p) && nav.find(u, p).length) return p;
      }
    }
    return marchPoint(origin);
  }
  function marchUnit(u, dt) {
    if (
      u.order?.rally &&
      distance(u, u.order) < 90 &&
      state.units.some(
        (v) =>
          v.id !== u.id &&
          v.hp > 0 &&
          v.team === u.team &&
          !v.moving &&
          distance(v, u.order) < 32,
      )
    ) {
      const goal = rallyPosition(u, u.order.rally);
      u.order = { ...u.order, ...goal };
      u.pathTimer = 0;
    }
    if (u.order && moveUnit(u, u.order, dt)) {
      u.order = null;
      u.hold = false;
      u.marchGoal = null;
    }
  }
  function moveUnit(u, destination, dt, stop = 6) {
    if (!groundFree(u.x, u.y, 6)) {
      const exit = findFree(u);
      u.x = exit.x;
      u.y = exit.y;
      u.pathTimer = 0;
    }
    let p = {
      x: clamp(destination.x, 25, W - 25),
      y: clamp(destination.y, 25, H - 25),
    };
    if (distance(u, p) < stop) {
      u.moving = false;
      return true;
    }
    u.pathTimer -= dt;
    if (
      !u.pathGoal ||
      distance(p, u.pathGoal) > 24 ||
      u.pathTimer <= 0 ||
      u.pathRevision !== nav.revision ||
      u.stuck > 1.2
    ) {
      u.path = nav.find(u, p);
      u.pathGoal = p;
      u.pathTimer = 2 + (u.id % 5) * 0.13;
      u.pathRevision = nav.revision;
      u.stuck = 0;
    }
    // Finish at the exact order instead of repeatedly revisiting its nav cell.
    if (
      distance(u, p) < 60 &&
      Array.from({ length: 9 }, (_, i) => i / 8).every((t) =>
        groundFree(u.x + (p.x - u.x) * t, u.y + (p.y - u.y) * t, 6),
      )
    )
      u.path = [p];
    if (!u.path.length) {
      u.stuck += dt;
      u.moving = false;
      return false;
    }
    let next = u.path[0];
    if (distance(u, next) < 0.1) {
      u.path.shift();
      if (!u.path.length) {
        u.pathTimer = 0;
        if (distance(u, p) < stop) {
          u.moving = false;
          return true;
        }
        // The final nav cell is only a route hint; finish at the actual destination.
        next = groundFree(p.x, p.y, 6) && distance(u, p) < 60 ? p : null;
        if (!next) {
          u.moving = false;
          return false;
        }
      } else next = u.path[0];
    }
    const d = distance(u, next),
      speed =
        (u.autoScout || u.team === 1) && u.order?.formation
          ? Math.min(
              TYPES[u.type].speed,
              state.formations.find((f) => f.id === u.order.formation)?.speed ||
                TYPES[u.type].speed,
            )
          : TYPES[u.type].speed,
      amount = Math.min(d, speed * dt);
    let nx = u.x + ((next.x - u.x) / d) * amount,
      ny = u.y + ((next.y - u.y) / d) * amount;
    if (!groundFree(nx, ny, 6)) {
      const heading = Math.atan2(next.y - u.y, next.x - u.x);
      for (const turn of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6]) {
        const tx = u.x + Math.cos(heading + turn) * amount;
        const ty = u.y + Math.sin(heading + turn) * amount;
        if (groundFree(tx, ty, 6)) {
          nx = tx;
          ny = ty;
          break;
        }
      }
    }
    if (groundFree(nx, ny, 6)) {
      u.angle = Math.atan2(ny - u.y, nx - u.x);
      u.x = nx;
      u.y = ny;
      u.moving = true;
      u.anim += dt * 10;
      u.stuck = 0;
      if (u.path[0] && distance(u, u.path[0]) < 0.1) u.path.shift();
      if (distance(u, p) < stop) {
        u.moving = false;
        return true;
      }
    } else {
      u.stuck += dt;
      u.pathTimer = Math.min(u.pathTimer, 0.8);
    }
    return false;
  }
  function producerFor(type) {
    const kind = TYPES[type].producer;
    const selectedProducer = state.buildings
      .filter(
        (b) =>
          (b.id === selectedBuilding || selectedBuildings.has(b.id)) &&
          b.kind === kind &&
          b.progress >= 1 &&
          b.hp > 0 &&
          b.team === 0,
      )
      .sort((a, b) => a.queue.length - b.queue.length)[0];
    return (
      selectedProducer ||
      completeBuildings(kind).sort((a, b) => a.queue.length - b.queue.length)[0]
    );
  }
  function recruit(type, assignedProducer = null) {
    if (!playable()) return false;
    if (!assignedProducer) {
      const producers = completeBuildings(TYPES[type].producer).filter((b) =>
        selectedBuildings.has(b.id),
      );
      if (producers.length > 1) {
        let queued = 0;
        for (const b of producers) if (recruit(type, b)) queued++;
        toast(
          `${queued} selected buildings queued ${TYPES[type].name.toLowerCase()} training.`,
        );
        return queued > 0;
      }
    }
    const t = TYPES[type],
      b = assignedProducer || producerFor(type),
      pop = population();
    if (!b) {
      toast(
        `Build a ${BUILDINGS[t.producer].name.toLowerCase()} to train ${t.name.toLowerCase()}s.`,
      );
      return false;
    }
    if (!afford(t.cost)) {
      toast("Your storehouses do not have enough resources.");
      return false;
    }
    if (pop.used + pop.queued >= pop.cap) {
      toast("Build a house to expand your population capacity.");
      return false;
    }
    if (b.queue.length >= 8) {
      toast("This structure already has a full training queue.");
      return false;
    }
    pay(t.cost);
    b.queue.push({
      kind: "unit",
      type,
      time: 0,
      duration: t.train,
      cost: { ...t.cost },
    });
    sound("recruit");
    toast(`${t.name} training at the ${BUILDINGS[b.kind].name.toLowerCase()}.`);
    updateUI();
    return true;
  }
  function research(key) {
    if (
      !playable() ||
      state.techs[key] ||
      rankFor(TECHS[key].type) !== TECHS[key].rank - 1 ||
      state.buildings.some((b) => b.queue.some((q) => q.tech === key))
    )
      return false;
    const t = TECHS[key],
      b = completeBuildings(t.producer)
        .filter((b) => b.id === selectedBuilding || selectedBuildings.has(b.id))
        .sort((a, b) => a.queue.length - b.queue.length)[0];
    if (!b || !afford(t.cost)) {
      toast("Research needs its completed structure and the listed resources.");
      return false;
    }
    pay(t.cost);
    b.queue.push({
      kind: "research",
      tech: key,
      time: 0,
      duration: t.time,
      cost: { ...t.cost },
    });
    updateUI();
    return true;
  }
  function beginBuild(kind) {
    if (!playable()) return;
    const builders = workers().filter((u) => selected.has(u.id));

    if (!afford(BUILDINGS[kind].cost)) {
      toast("Not enough resources for this structure.");
      return;
    }
    wallAnchor = null;
    placement = kind;
    placementRotation = 0;
    mode = "build";
    toast(
      `Place ${BUILDINGS[kind].name.toLowerCase()} on clear, explored ground. Unfinished foundations provide no vision. ${kind === "wall" ? "Drag to lay a continuous wall; bends join automatically. " : ""}Right-click or Escape cancels.`,
    );
    updateUI();
  }
  function placementSpec(kind, team = 0) {
    const spec = BUILDINGS[kind];
    return kind === "gate" && team === 0 && placementRotation === 90
      ? { ...spec, w: spec.h, h: spec.w }
      : spec;
  }
  function rotatePlacement() {
    if (!playable() || placement !== "gate") return;
    placementRotation = placementRotation === 90 ? 0 : 90;
    toast("Gate rotated. Press R or Rotate gate to turn it again.");
    updateUI();
  }
  function validSite(kind, p, team = 0) {
    if (team === 0 ? !playerRemembers(p) : !enemyFog.remembers(p)) return false;
    const t = placementSpec(kind, team);
    if (
      state.units.some(
        (u) =>
          u.hp > 0 &&
          Math.abs(u.x - p.x) < t.w / 2 + 10 &&
          Math.abs(u.y - p.y) < t.h / 2 + 10,
      )
    )
      return false;
    if (
      p.x - t.w / 2 < 32 ||
      p.y - t.h / 2 < 32 ||
      p.x + t.w / 2 > W - 32 ||
      p.y + t.h / 2 > H - 32
    )
      return false;
    for (const dx of [-t.w / 2, 0, t.w / 2])
      for (const dy of [-t.h / 2, 0, t.h / 2])
        if (!groundFree(p.x + dx, p.y + dy, 13, null, "all")) return false;
    if (
      state.nodes.some(
        (n) =>
          n.remaining > 0 &&
          Math.abs(n.x - p.x) < t.w / 2 + n.r + 12 &&
          Math.abs(n.y - p.y) < t.h / 2 + n.r + 12,
      )
    )
      return false;
    if (
      state.buildings.some(
        (b) =>
          b.hp > 0 &&
          Math.abs(b.x - p.x) < (b.w + t.w) / 2 &&
          Math.abs(b.y - p.y) < (b.h + t.h) / 2,
      )
    )
      return false;
    return true;
  }
  function wallLine(a, b) {
    const snap = (p) => ({
      x: Math.round(p.x / 32) * 32,
      y: Math.round(p.y / 32) * 32,
    });
    a = snap(a);
    b = snap(b);
    const points = [a];
    let p = { ...a };
    // Eight-direction segments follow the pointer, including true diagonal runs.
    while ((p.x !== b.x || p.y !== b.y) && points.length < 150) {
      p = {
        x: p.x + Math.sign(b.x - p.x) * 32,
        y: p.y + Math.sign(b.y - p.y) * 32,
      };
      points.push(p);
    }
    return points;
  }
  function placeWallLine(a, b, append = false) {
    const builders = workers().filter((u) => selected.has(u.id)),
      projects = [];
    const points = wallLine(a, b);
    for (const [i, p] of points.entries()) {
      if (
        state.buildings.some(
          (b) => b.hp > 0 && b.kind === "wall" && distance(b, p) < 12,
        )
      )
        continue;
      if (!validSite("wall", p) || !afford(BUILDINGS.wall.cost)) continue;
      pay(BUILDINGS.wall.cost);
      const next = points[i + 1] || points[i - 1] || { x: p.x + 32, y: p.y };
      const wall = makeBuilding("wall", 0, p.x, p.y, 0, {
        wallAngle: Math.atan2(next.y - p.y, next.x - p.x),
      });
      state.buildings.push(wall);
      projects.push(wall.id);
    }
    if (projects.length) {
      rebuildNavigation();
      queueConstruction(builders, projects, append);
    }
    wallDrag = null;
    wallAnchor = append ? points.at(-1) : null;
    placement = append ? "wall" : null;
    mode = append ? "build" : "move";
    updateUI();
    toast(
      projects.length
        ? `${projects.length} wall sections planned. Villagers build along the line automatically.`
        : "No clear ground or insufficient stone for this wall.",
    );
  }
  function wallConnections(b) {
    const links = {};
    for (const other of state.buildings)
      if (
        other.id !== b.id &&
        other.team === b.team &&
        other.hp > 0 &&
        ["wall", "gate"].includes(other.kind)
      ) {
        const dx = other.x - b.x,
          dy = other.y - b.y;
        if (
          Math.abs(dx) > 12 &&
          Math.abs(dy) > 12 &&
          state.buildings.some(
            (c) =>
              c.hp > 0 &&
              c.team === b.team &&
              c.kind === "wall" &&
              ((Math.abs(c.x - other.x) < 12 && Math.abs(c.y - b.y) < 12) ||
                (Math.abs(c.x - b.x) < 12 && Math.abs(c.y - other.y) < 12)),
          )
        )
          continue;
        if (
          Math.abs(dx) <= Math.max(32, (b.w + other.w) / 2) + 8 &&
          Math.abs(dy) <= Math.max(32, (b.h + other.h) / 2) + 8
        ) {
          const key =
            (dy < -12 ? "n" : dy > 12 ? "s" : "") +
            (dx < -12 ? "w" : dx > 12 ? "e" : "");
          if (key) links[key] = { x: dx / 2, y: dy / 2 };
        }
      }
    return links;
  }
  function queueConstruction(builders, ids, append) {
    for (const u of builders) {
      if (
        append &&
        u.job?.kind === "build" &&
        getObject(u.job.target)?.progress < 1
      )
        u.buildQueue = [...(u.buildQueue || []), ...ids];
      else {
        u.buildQueue = [...ids];
        u.job = { kind: "build", target: u.buildQueue.shift() };
        u.order = null;
        u.pathTimer = 0;
        u.hold = false;
      }
    }
  }
  function placeBuild(p, append = false) {
    if (!playable() || !placement) return false;
    const kind = placement,
      builders = workers().filter((u) => selected.has(u.id));
    if (!afford(BUILDINGS[kind].cost) || !validSite(kind, p)) {
      toast(
        "Choose clear ground away from structures, trees, deposits, and water.",
      );
      return false;
    }
    pay(BUILDINGS[kind].cost);
    const b = makeBuilding(kind, 0, p.x, p.y, 0, {
      rotation: placementRotation,
    });
    state.buildings.push(b);
    rebuildNavigation();
    queueConstruction(builders, [b.id], append);
    placement = append ? kind : null;
    mode = append ? "build" : "move";
    selectedBuilding = null;
    toast(
      `${BUILDINGS[kind].name} planned. Right-click it with villagers to assign builders.`,
    );
    updateUI();
    return true;
  }
  function cancel() {
    wallDrag = null;
    wallAnchor = null;
    if (mode === "build" || mode === "attack") {
      placement = null;
      mode = "move";
      updateUI();
      return;
    }
    const targets = state.buildings.filter(
      (b) =>
        (b.id === selectedBuilding || selectedBuildings.has(b.id)) &&
        b.team === 0 &&
        b.hp > 0,
    );
    const removed = new Set();
    let cancelled = 0;
    for (const b of targets) {
      if (b.progress < 1) {
        for (const [r, n] of Object.entries(b.spent))
          state.resources[r] += n * (1 - b.progress) * 0.75;
        removed.add(b.id);
        cancelled++;
      } else if (b.queue.length) {
        pay(b.queue.shift().cost, -1);
        cancelled++;
      }
    }
    if (removed.size) {
      state.buildings = state.buildings.filter((b) => !removed.has(b.id));
      for (const u of workers()) {
        u.buildQueue = u.buildQueue?.filter((id) => !removed.has(id));
        if (removed.has(u.job?.target)) {
          const id = u.buildQueue?.shift();
          u.job = id ? { kind: "build", target: id } : null;
          u.pathTimer = 0;
        }
      }
      for (const id of removed) selectedBuildings.delete(id);
      if (removed.has(selectedBuilding))
        selectedBuilding = [...selectedBuildings][0] || null;
      rebuildNavigation();
    }
    if (cancelled)
      toast(
        `${cancelled} selected construction or training orders cancelled. Unused materials returned.`,
      );
    updateUI();
  }
  function toggleDeployment() {
    if (!playable()) return;
    const engines = fighters().filter(
      (u) => selected.has(u.id) && u.type === "trebuchet",
    );
    if (!engines.length) {
      toast("Select a trebuchet to set up or pack.");
      return;
    }
    for (const u of engines) {
      u.autoScout = null;
      u.fireTarget = null;
      if (u.deployment === "packed") {
        u.deployment = "setting-up";
        u.deployTimer = 6;
        u.order = null;
        u.pendingOrder = null;
        u.path = [];
      } else if (u.deployment === "deployed") {
        u.deployment = "packing";
        u.deployTimer = 4;
        u.target = null;
      }
    }
    updateUI();
  }
  function issueOrder(x, y, attack = false, append = false) {
    if (!playable()) return;
    if (mode === "build") {
      cancel();
      return;
    }
    const p = { x: clamp(x, 25, W - 25), y: clamp(y, 25, H - 25) },
      node = playerRemembers(p) ? resourceAt(p) : null,
      building = state.buildings.find(
        (b) =>
          b.hp > 0 &&
          Math.abs(p.x - b.x) < b.w / 2 + 6 &&
          Math.abs(p.y - b.y) < b.h / 2 + 6,
      ),
      enemy =
        state.units
          .filter(
            (u) =>
              u.team === 1 && u.hp > 0 && playerSees(u) && distance(u, p) < 24,
          )
          .sort((a, b) => distance(a, p) - distance(b, p))[0] ||
        (building?.team === 1 && playerSees(building) ? building : null);
    const escort = friendUnits().find(
      (u) => ["pilgrim", "merchant"].includes(u.type) && distance(u, p) < 35,
    );
    const units = friendUnits().filter(
      (u) => selected.has(u.id) && !["pilgrim", "merchant"].includes(u.type),
    );
    if (!units.length) {
      const producers = state.buildings.filter(
        (b) =>
          (b.id === selectedBuilding || selectedBuildings.has(b.id)) &&
          b.team === 0 &&
          b.hp > 0 &&
          b.progress >= 1 &&
          Object.values(TYPES).some((t) => t.producer === b.kind),
      );
      for (const b of producers) b.rally = findFree(p);
      toast(
        producers.length
          ? "New troops from selected training buildings will rally here."
          : "This building cannot train troops and has no rally point.",
      );
      return;
    }
    for (const u of units.filter(
      (u) => u.type === "trebuchet" && u.deployment !== "packed",
    )) {
      u.autoScout = null;
      u.target = null;
      u.manualTarget = false;
      if (u.deployment === "deployed" || u.deployment === "setting-up") {
        const d = distance(u, p);
        if (d >= 180 && d <= 690) {
          u.fireTarget = { ...p };
          u.hold = false;
          u.order = null;
          toast("Trebuchet target set. The engine will fire when ready.");
        } else
          toast(
            "Outside siege range (180-690). Press Pack up before moving the engine.",
          );
      } else u.pendingOrder = { ...findFree(p), attack: false };
    }
    const combat = units.filter(
        (u) =>
          u.type !== "worker" &&
          (u.type !== "trebuchet" || u.deployment === "packed"),
      ),
      center = combat.length
        ? combat.reduce(
            (a, u) => ({
              x: a.x + u.x / combat.length,
              y: a.y + u.y / combat.length,
            }),
            { x: 0, y: 0 },
          )
        : p;
    const a = Math.atan2(p.y - center.y, p.x - center.x),
      front = { x: Math.cos(a), y: Math.sin(a) },
      side = { x: -front.y, y: front.x },
      cols = Math.max(3, Math.ceil(Math.sqrt(combat.length))),
      sorted = [...combat].sort(
        (a, b) => TYPES[a.type].rank - TYPES[b.type].rank,
      ),
      formationId = ++uid,
      slots = [];
    sorted.forEach((u, i) => {
      u.autoScout = null;
      const row = Math.floor(i / cols),
        column = (i % cols) - (cols - 1) / 2,
        extra = u.type === "chaplain" ? 100 : u.type === "trebuchet" ? 170 : 0;
      let goal = marchPoint({
        x: p.x + side.x * column * 32 - front.x * (row * 32 + extra),
        y: p.y + side.y * column * 32 - front.y * (row * 32 + extra),
      });
      if (u.type === "knight") {
        const flank = i % 2 ? -1 : 1;
        goal = findFree({
          x: goal.x + side.x * flank * 55,
          y: goal.y + side.y * flank * 55,
        });
      }
      goal = reserveSlot(goal, slots);
      const order = {
        x: goal.x,
        y: goal.y,
        attack: attack || !!enemy || !!escort,
        formation: formationId,
      };
      u.target = u.type === "chaplain" || attack ? null : enemy?.id || null;
      u.manualTarget = !!enemy && !attack && u.type !== "chaplain";
      u.hold = false;
      u.pathTimer = 0;
      u.formation = { id: formationId, x: goal.x, y: goal.y };
      u.marchOffset = { x: goal.x - p.x, y: goal.y - p.y };
      u.order = order;
    });
    if (sorted.length)
      state.formations.push({
        id: formationId,
        members: sorted.map((u) => u.id),
        anchor: { ...center },
        destination: p,
        path: nav.find(center, p),
        revision: nav.revision,
        speed: Math.min(...sorted.map((u) => TYPES[u.type].speed)),
        arrived: false,
        wait: 0,
        escortId: escort?.id || null,
      });
    for (const u of units.filter((u) => u.type === "worker")) {
      if (!append) u.buildQueue = [];
      u.hold = false;
      if (node && (!building || building.progress >= 1)) {
        assignGather(u, node.kind === "farm" ? "food" : node.kind, node);
      } else if (
        building?.team === 0 &&
        (building.progress < 1 || building.hp < building.maxHp)
      ) {
        if (building.progress < 1)
          queueConstruction([u], [building.id], append);
        else {
          u.job = { kind: "repair", target: building.id };
          u.order = null;
          u.pathTimer = 0;
        }
      } else {
        u.job = null;
        u.order = { ...findFree(p), attack: false };
        u.pathTimer = 0;
      }
    }
    if (
      combat.length &&
      combat.every((u) => u.type === "chaplain") &&
      (attack || enemy)
    ) {
      combat.forEach((u) => (u.order = null));
      toast("Chaplains need an escort to advance into battle.");
    }
    state.rings.push({
      x: p.x,
      y: p.y,
      t: 0,
      color: enemy || attack ? "#a54831" : "#ece0b3",
      r: 24,
    });
    mode = "move";
    if (escort && combat.length)
      toast(
        "The company will guard and follow the caravan. Defeat nearby threats to keep it moving.",
      );
    sound("order");
    updateUI();
  }
  function selectArmy() {
    selected = new Set(fighters().map((u) => u.id));
    selectedBuilding = null;
    setTab("army");
    updateUI();
  }
  function selectWorkers() {
    selected = new Set(workers().map((u) => u.id));
    selectedBuilding = null;
    setTab("settlement");
    updateUI();
  }
  function idleWorker() {
    const u = workers().find((u) => !u.job && !u.order);
    if (u) {
      selected = new Set([u.id]);
      selectedBuilding = null;
      camera.x = u.x;
      camera.y = u.y;
      setTab("settlement");
      updateView();
      updateUI();
    } else toast("All villagers are working.");
  }
  function hold() {
    if (!playable()) return;
    for (const u of state.units)
      if (selected.has(u.id)) {
        u.autoScout = null;
        u.fireTarget = null;
        u.order = null;
        u.pendingOrder = null;
        u.target = null;
        u.job = null;
        u.buildQueue = [];
        u.hold = true;
        u.path = [];
      }
    placement = null;
    mode = "move";
    updateUI();
  }
  function bless() {
    if (!playable()) return;
    const units = fighters().filter((u) => selected.has(u.id));
    if (!units.length || state.faith < 30) {
      toast("Select soldiers and gather 30 faith for a benediction.");
      return;
    }
    state.faith -= 30;
    for (const u of units) {
      u.hp = Math.min(u.maxHp, u.hp + 30);
      u.blessed = 15;
      state.rings.push({ x: u.x, y: u.y, t: 0, color: "#f2d27a", r: 18 });
    }
    sound("bless");
    toast("In nomine Patris. The company receives a benediction.");
    updateUI();
  }
  function setAttack() {
    if (!playable() || !selected.size) return;
    mode = "attack";
    placement = null;
    toast("Left-click a destination to advance in formation and engage.");
    updateUI();
  }
  function surfaceDistance(u, target) {
    return target.w
      ? Math.hypot(
          Math.max(0, Math.abs(u.x - target.x) - target.w / 2),
          Math.max(0, Math.abs(u.y - target.y) - target.h / 2),
        )
      : Math.max(0, distance(u, target) - (target.r || 0));
  }
  function constructionFinished(u, b) {
    u.job = null;
    while (u.buildQueue?.length) {
      const next = getObject(u.buildQueue.shift());
      if (next && next.progress < 1) {
        u.job = { kind: "build", target: next.id };
        u.pathTimer = 0;
        return;
      }
    }
    if (b.kind === "wall") {
      const next = state.buildings
        .filter(
          (c) =>
            c.team === u.team &&
            c.kind === "wall" &&
            c.hp > 0 &&
            c.progress < 1 &&
            distance(c, b) < 110,
        )
        .sort((a, c) => distance(a, u) - distance(c, u))[0];
      if (next) {
        u.job = { kind: "build", target: next.id };
        u.pathTimer = 0;
        return;
      }
    }
    if (b.kind === "farm") {
      if (!assignGather(u, "food", b)) assignGather(u, "food");
      return;
    }
    const types = BUILDINGS[b.kind].drop;
    if (!types) return;
    const candidates = state.nodes
      .filter(
        (n) =>
          types.includes(n.kind) &&
          n.remaining > 0 &&
          (u.team === 0 ? fog : enemyFog).remembers(n),
      )
      .sort((a, b) => distance(a, u) - distance(b, u));
    const nearest = candidates.find((n) => !edgePoint(u, n, 16).unreachable);
    if (nearest) assignGather(u, nearest.kind, nearest);
    else for (const type of types) if (assignGather(u, type)) break;
  }
  function harvestSpot(u, target, farm) {
    if (
      u.harvestSpot?.target === target.id &&
      groundFree(u.harvestSpot.x, u.harvestSpot.y, 6)
    )
      return u.harvestSpot;
    const reserved = state.units
      .filter(
        (a) =>
          a.id !== u.id &&
          a.hp > 0 &&
          a.job?.target === target.id &&
          a.harvestSpot?.target === target.id,
      )
      .map((a) => a.harvestSpot);
    const heading = Math.atan2(u.y - target.y, u.x - target.x),
      radius = target.kind === "wood" ? 46 : (target.r || 24) + 12;
    let best = null,
      score = Infinity;
    for (let i = 0; i < (farm ? 5 : 24); i++) {
      const a = heading + (i * Math.PI) / 12;
      const p = farm
        ? {
            x: target.x + ((i % 3) - 1) * target.w * 0.23,
            y: target.y + (i < 3 ? -0.22 : 0.22) * target.h,
          }
        : {
            x: target.x + Math.cos(a) * radius,
            y: target.y + Math.sin(a) * radius,
          };
      if (!groundFree(p.x, p.y, 6) || reserved.some((q) => distance(p, q) < 22))
        continue;
      const value = distance(p, u);
      if (value < score) {
        score = value;
        best = p;
      }
    }
    if (!best) best = edgePoint(u, target, 16);
    return (u.harvestSpot = { ...best, target: target.id });
  }
  function workerAI(u, dt) {
    const threats = nearby(u, 190).filter(
      (e) =>
        e.team !== u.team &&
        e.team !== 2 &&
        !["chaplain", "trebuchet"].includes(e.type),
    );
    if (threats.length) {
      u.fleeUntil = state.time + 5;
      const shelters = completeBuildings(null, u.team).filter(
        (b) => b.kind === "towncenter" || b.kind === "tower",
      );
      const shelter = shelters.sort(
        (a, b) => distance(u, a) - distance(u, b),
      )[0];
      if (shelter) {
        const e = threats.sort((a, b) => distance(a, u) - distance(b, u))[0],
          a = Math.atan2(shelter.y - e.y, shelter.x - e.x);
        u.shelter = findFree({
          x: shelter.x + Math.cos(a) * (shelter.r + 50),
          y: shelter.y + Math.sin(a) * (shelter.r + 50),
        });
      }
    }
    if (u.fleeUntil > state.time && u.shelter) {
      moveUnit(u, u.shelter, dt);
      return;
    }
    if (u.order) {
      marchUnit(u, dt);
      return;
    }
    if (!u.job || u.hold) return;
    const job = u.job;
    if (job.kind === "build" || job.kind === "repair") {
      const b = state.buildings.find(
        (b) => b.id === job.target && b.hp > 0 && b.team === u.team,
      );
      if (!b) {
        u.job = null;
        return;
      }
      if (job.kind === "build" && b.progress >= 1) {
        constructionFinished(u, b);
        return;
      }
      if (surfaceDistance(u, b) > 14) {
        let contact = u.buildContact;
        if (
          !contact ||
          contact.target !== b.id ||
          contact.revision !== nav.revision ||
          contact.expires < state.time
        ) {
          const candidates = [];
          for (let i = 0; i < 24; i++) {
            const angle = (i * Math.PI) / 12,
              cx = Math.cos(angle),
              cy = Math.sin(angle);
            const radius =
              Math.min(
                b.w / 2 / Math.max(0.01, Math.abs(cx)),
                b.h / 2 / Math.max(0.01, Math.abs(cy)),
              ) + 10;
            const p = { x: b.x + cx * radius, y: b.y + cy * radius };
            if (groundFree(p.x, p.y, 6)) candidates.push(p);
          }
          candidates.sort((a, b) => distance(u, a) - distance(u, b));
          const point = candidates.find((p) => nav.find(u, p).length);
          contact = u.buildContact = point
            ? {
                ...point,
                target: b.id,
                revision: nav.revision,
                expires: state.time + 2,
              }
            : null;
        }
        if (contact) moveUnit(u, contact, dt, 3);
        else u.moving = false;
        return;
      }
      u.working = true;
      u.workPhase = (u.workPhase || 0) + dt;
      if (u.workPhase >= 1) {
        u.workPhase %= 1;
        sound("build", u);
        for (let i = 0; i < 4; i++)
          state.particles.push({
            x: u.x + Math.cos(u.angle) * 15,
            y: u.y + Math.sin(u.angle) * 15,
            vx: Math.cos(i * 2) * 24,
            vy: Math.sin(i * 2) * 24,
            t: 0,
            life: 0.55,
            color: i % 2 ? "#c9ac77" : "#877452",
            r: 1.5,
          });
      }
      u.angle = Math.atan2(b.y - u.y, b.x - u.x);
      if (job.kind === "build") {
        if (b.progress >= 1) {
          constructionFinished(u, b);
          return;
        }
        const progress = Math.min(1 - b.progress, dt / BUILDINGS[b.kind].time);
        b.progress = Math.min(1, b.progress + progress);
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.8 * progress);
        if (b.progress >= 1) {
          b.hp = Math.min(b.maxHp, Math.round(b.hp * 1000) / 1000);
          state.stats.built++;
          if (u.team === 0) toast(BUILDINGS[b.kind].name + " is complete.");
          sound("bell");
          constructionFinished(u, b);
        }
      } else {
        if (b.hp >= b.maxHp) {
          u.job = null;
          return;
        }
        const repair = Math.min(10 * dt, b.maxHp - b.hp);
        if (stock(u.team).wood >= repair * 0.08) {
          pay({ wood: repair * 0.08 }, 1, u.team);
          b.hp += repair;
        } else u.working = false;
      }
      return;
    }
    if (job.kind === "clear") {
      const n = getObject(job.target);
      if (!n || n.remaining <= 0) {
        u.job = null;
        return;
      }
      if (surfaceDistance(u, n) > 60) {
        moveUnit(u, edgePoint(u, n, 12), dt);
        return;
      }
      u.working = true;
      u.workPhase = (u.workPhase || 0) + dt;
      u.gatherSource = n.kind;
      u.angle = Math.atan2(n.y - u.y, n.x - u.x);
      n.remaining = Math.max(0, n.remaining - dt * 45);
      if (!n.remaining) {
        state.navDirty = true;
        u.job = null;
      }
      return;
    }
    if (job.kind === "gather") {
      let target = getObject(job.target);
      job.cluster ||= target ? resourceCluster(target) : [];
      if (
        !target ||
        target.hp === 0 ||
        (target.remaining === 0 && target.kind !== "farm")
      ) {
        if (u.carry > 0) job.phase = "deliver";
        else {
          assignGather(u, job.resource, null, job.cluster);
          return;
        }
      }
      const capacity = 16;
      if (job.phase === "deliver" || u.carry >= capacity) {
        job.phase = "deliver";
        const drop = completeBuildings(null, u.team)
          .filter((b) =>
            BUILDINGS[b.kind].drop?.includes(u.carryType || job.resource),
          )
          .sort((a, b) => distance(a, u) - distance(b, u))[0];
        if (!drop) return;
        const p = edgePoint(u, drop, 20);
        if (surfaceDistance(u, drop) > 65) {
          moveUnit(u, p, dt);
          return;
        }
        if (u.carry > 0) {
          stock(u.team)[u.carryType] += u.carry;
          if (u.team === 0) state.stats.gathered[u.carryType] += u.carry;
          else state.enemy.gathered[u.carryType] += u.carry;
          sound("deliver", u);
          u.carry = 0;
          u.carryType = null;
        }
        job.phase = "approach";
        u.pathTimer = 0;
        return;
      }
      if (!target) {
        u.job = null;
        return;
      }
      if (edgePoint(u, target, 16).unreachable) {
        assignGather(u, job.resource, null, job.cluster);
        return;
      }
      const farm = target.kind === "farm";
      const workSpot = harvestSpot(u, target, farm);
      if (distance(u, workSpot) > 8) {
        const d = distance(u, workSpot),
          amount = Math.min(d, TYPES.worker.speed * dt);
        const p = {
          x: u.x + ((workSpot.x - u.x) / d) * amount,
          y: u.y + ((workSpot.y - u.y) / d) * amount,
        };
        if (
          d < 110 &&
          groundFree(p.x, p.y, 6) &&
          groundFree(workSpot.x, workSpot.y, 6)
        ) {
          u.angle = Math.atan2(p.y - u.y, p.x - u.x);
          u.x = p.x;
          u.y = p.y;
          u.moving = true;
          u.anim += dt * 10;
          return;
        }
        if (farm || surfaceDistance(u, target) > 60) {
          moveUnit(u, edgePoint(u, target, 12), dt);
          return;
        }
      }
      if (farm && target.remaining <= 0) {
        target.replantRemaining ??= 8;
        target.replantRemaining = Math.max(0, target.replantRemaining - dt);
        u.working = true;
        u.gatherSource = "sowing";
        u.workPhase = (u.workPhase || 0) + dt;
        if (target.replantRemaining <= 0) {
          target.remaining = target.max || 2400;
          delete target.replantRemaining;
          if (u.team === 0) toast("Grain field replanted. Harvesting resumes.");
        }
        return;
      }
      u.working = true;
      u.gatherSource = farm ? "farm" : target.kind;
      u.workPhase = (u.workPhase || 0) + dt;
      if (u.workPhase >= 1) {
        u.workPhase %= 1;
        sound(job.resource, u);
        if (!farm)
          for (let i = 0; i < 3; i++)
            state.particles.push({
              x: u.x + Math.cos(u.angle) * 16,
              y: u.y + Math.sin(u.angle) * 16,
              vx: Math.cos(i * 2) * 20,
              vy: Math.sin(i * 2) * 20,
              t: 0,
              life: 0.45,
              color:
                job.resource === "wood"
                  ? "#ca9b62"
                  : job.resource === "gold"
                    ? "#edc456"
                    : "#bdc8c8",
              r: 1.3,
            });
      }
      u.angle = Math.atan2(target.y - u.y, target.x - u.x);
      const nearbyDrop = completeBuildings(null, u.team).some(
          (b) =>
            b.kind !== "towncenter" &&
            BUILDINGS[b.kind].drop?.includes(job.resource) &&
            distance(b, target) < 350,
        ),
        rate =
          (job.resource === "gold" || job.resource === "stone" ? 3.0 : 3.7) *
          (nearbyDrop ? 1.15 : 1) *
          (LEVELS[state.level].kind === "survival" && job.resource === "food"
            ? 0.72
            : 1),
        amount = Math.min(rate * dt, capacity - u.carry, target.remaining);
      u.carry += amount;
      u.carryType = job.resource;
      job.phase = "harvest";
      {
        target.remaining = Math.max(0, target.remaining - amount);
        if (!target.remaining && target.kind !== "food") state.navDirty = true;
      }
      if (u.carry >= capacity - 0.001 || target.remaining === 0) {
        job.phase = "deliver";
        u.pathTimer = 0;
      }
    }
  }
  function supportAI(u, dt) {
    const friendly = nearby(u, 650).filter(
        (a) => a.team === u.team && alive(a),
      ),
      threats = nearby(u, 300).filter(
        (e) => e.team !== u.team && e.team !== 2 && TYPES[e.type].damage > 0,
      ),
      wounded = friendly
        .filter((a) => a.hp < a.maxHp && distance(u, a) < TYPES.chaplain.range)
        .sort((a, b) => {
          const sa = a.hp / a.maxHp - (a.type === "sword" ? 0.08 : 0),
            sb = b.hp / b.maxHp - (b.type === "sword" ? 0.08 : 0);
          return sa - sb;
        });
    if (wounded.length && u.cooldown <= 0) {
      const ally = wounded[0],
        amount = Math.min(
          16 * (1 + (u.rank || 0) * 0.25),
          ally.maxHp - ally.hp,
        );
      ally.hp += amount;
      state.healed += amount;
      u.cooldown = 1.5;
      state.rings.push({ x: ally.x, y: ally.y, t: 0, color: "#ebd18a", r: 15 });
    }
    const fightersNear = friendly.filter(
      (a) =>
        ![
          "worker",
          "chaplain",
          "trebuchet",
          "civilian",
          "pilgrim",
          "merchant",
        ].includes(a.type),
    );
    if (threats.length) {
      const closest = threats.sort(
        (a, b) => distance(a, u) - distance(b, u),
      )[0];
      if (distance(u, closest) < 190) {
        const ally = fightersNear.sort(
          (a, b) => distance(a, u) - distance(b, u),
        )[0];
        const anchor =
            ally || completeBuildings("towncenter", u.team)[0] || u.home || u,
          a = Math.atan2(anchor.y - closest.y, anchor.x - closest.x),
          goal = findFree({
            x: anchor.x + Math.cos(a) * 115,
            y: anchor.y + Math.sin(a) * 115,
          });
        moveUnit(u, goal, dt);
        return;
      }
    }
    if (u.hold) return;
    if (u.order && !u.order.attack) {
      marchUnit(u, dt);
      return;
    }
    const escorts = fightersNear.filter(
      (a) =>
        !u.order ||
        a.order?.formation === u.order.formation ||
        a.formation?.id === u.order.formation,
    );
    const candidates = escorts.length ? escorts : fightersNear;
    const injured = candidates
      .filter((a) => a.hp < a.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const ally =
      injured || candidates.sort((a, b) => distance(a, u) - distance(b, u))[0];
    if (!ally) return;
    const enemy =
        threats[0] ||
        state.buildings.find(
          (b) =>
            b.team !== u.team && b.team !== 2 && b.kind === "fort" && b.hp > 0,
        ),
      direction = enemy
        ? Math.atan2(enemy.y - ally.y, enemy.x - ally.x)
        : ally.angle;
    const goal = findFree({
      x: ally.x - Math.cos(direction) * 105,
      y: ally.y - Math.sin(direction) * 105,
    });
    if (distance(u, goal) > 35) moveUnit(u, goal, dt);
  }
  function targetScore(u, e) {
    const d = distance(u, e);
    let score = d;
    if (
      u.type === "knight" &&
      ["archer", "chaplain", "trebuchet"].includes(e.type)
    )
      score -= 115;
    if (
      u.type === "archer" &&
      ["archer", "chaplain", "standard"].includes(e.type)
    )
      score -= 60;
    if (u.type === "sword" && e.type === "knight") score -= 40;
    if (e.target === u.id) score -= 55;
    if (e.hp / e.maxHp < 0.3) score -= 25;
    return score;
  }
  function acquire(u, r = 310) {
    const enemies = nearby(u, r).filter(
      (e) =>
        e.team !== u.team &&
        e.team !== 2 &&
        e.type !== "civilian" &&
        (u.team === 0 ? fog : enemyFog).sees(e),
    );
    let best = null,
      score = Infinity;
    for (const e of enemies) {
      if (
        u.team === 1 &&
        !u.order?.attack &&
        u.home &&
        distance(e, u.home) > 420
      )
        continue;
      const n = targetScore(u, e);
      if (n < score) {
        best = e;
        score = n;
      }
    }
    if (best) return best;
    return (
      state.buildings
        .filter(
          (b) =>
            b.team !== u.team &&
            b.team !== 2 &&
            b.hp > 0 &&
            (u.team === 0 ? fog : enemyFog).sees(b) &&
            distance(u, b) < r + b.r,
        )
        .sort((a, b) => distance(a, u) - distance(b, u))[0] || null
    );
  }
  function projectile(u, target, damage) {
    state.arrows.push({
      x: u.x,
      y: u.y,
      tx: target.x,
      ty: target.y,
      target: target.id,
      team: u.team,
      damage,
      life: 2.5,
      sx: u.x,
      sy: u.y,
    });
  }
  function isCapital(b) {
    if (!b) return false;
    const player = state.capitals?.player || state.buildings[0]?.id,
      enemy =
        state.capitals?.enemy ||
        state.buildings.find((c) => c.team === 1 && c.kind === "towncenter")
          ?.id;
    return (
      b.id === player ||
      b.id === enemy ||
      (state.mode !== "quickmatch" &&
        !b.outpost &&
        b.id === state.buildings[1]?.id)
    );
  }
  function damage(target, amount, source, siege = false) {
    if (DEBUG_MODE && state.cheats?.invulnerable && target?.team === 0) return;
    if (!target || target.hp <= 0 || target.team === 2) return;
    const fortified =
      target.kind === "wall" || target.kind === "gate" || target.gate;
    const armored = fortified
      ? siege
        ? 3
        : source?.type === "archer"
          ? 0.035
          : 0.12
      : target.kind === "fort"
        ? siege
          ? 0.95
          : 0.22
        : 1;
    target.hp -= amount * armored * (target.blessed > 0 ? 0.75 : 1);
    if (target.kind === "fort" && siege && source?.team === 0)
      state.stats.siegeHits++;
    if (target.type && !target.kind) {
      target.lastAttacker = source?.id;
      target.lastHit = state.time;
      if (settings.gore && amount > 4) blood(target.x, target.y, 3);
    }
    if (target.hp > 0) return;
    target.hp = 0;
    if (target.kind) {
      state.navDirty = true;
      if (isCapital(target)) {
        finish(target.team !== 0);
        return;
      }
      if (target.id === state.buildings[0].id) {
        finish(false);
        return;
      }
      if (
        target.id === state.buildings[1].id &&
        LEVELS[state.level].kind === "occupation"
      ) {
        state.citadelTaken = target.team !== 0;
        state.occupation = 0;
        target.team = state.citadelTaken ? 0 : 1;
        if (state.citadelTaken) state.waveTimer = Math.min(12, state.waveTimer);
        target.hp = 1600;
        target.maxHp = 1600;
        target.queue = [];
        toast(
          state.citadelTaken
            ? "The citadel is taken. Secure the holy sites and prepare for the counterattack!"
            : "The citadel has been retaken. Regroup and recover it!",
        );
        sound("horn");
      } else toast(BUILDINGS[target.kind].name + " has fallen.");
      for (let i = 0; i < 24; i++)
        state.particles.push({
          x: target.x,
          y: target.y,
          vx: (Math.random() - 0.5) * 190,
          vy: (Math.random() - 0.5) * 190,
          t: 0,
          life: 1,
          color: i % 2 ? "#c3aa79" : "#6d5b42",
          r: 3,
        });
      return;
    }
    if (target.team === 0) {
      state.losses++;
      selected.delete(target.id);
    } else if (target.team === 1) state.kills++;
    if (settings.gore) {
      state.corpses.push({
        x: target.x,
        y: target.y,
        angle: target.angle,
        shattered: siege,
        type: target.type,
        team: target.team,
        t: 0,
      });
      state.marks.push({
        x: target.x,
        y: target.y,
        r: 12 + Math.random() * 12,
        t: 0,
      });
      blood(target.x, target.y, 35);
    } else
      for (let i = 0; i < 8; i++)
        state.particles.push({
          x: target.x,
          y: target.y,
          vx: (Math.random() - 0.5) * 65,
          vy: (Math.random() - 0.5) * 65,
          t: 0,
          life: 0.65,
          color: "#bdab82",
          r: 2,
        });
  }
  function blood(x, y, count) {
    for (let i = 0; i < count; i++)
      state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 130,
        vy: (Math.random() - 0.5) * 130,
        t: 0,
        life: 0.35 + Math.random() * 0.35,
        color: i % 3 ? "#b3222d" : "#611119",
        r: 1 + Math.random() * 2,
        blood: true,
      });
  }
  function siegeAI(u, dt) {
    if (u.deployment === "setting-up" || u.deployment === "packing") {
      u.deployTimer -= dt;
      if (u.deployTimer <= 0) {
        if (u.deployment === "setting-up") {
          u.deployment = "deployed";
          u.cooldown = Math.max(1, u.cooldown);
        } else {
          u.deployment = "packed";
          u.order = u.pendingOrder;
          u.pendingOrder = null;
        }
        u.pathTimer = 0;
      }
      return;
    }
    let target = u.target ? getObject(u.target) : null;
    if (
      target?.team === u.team ||
      target?.team === 2 ||
      (target && !(u.team === 0 ? fog : enemyFog).sees(target))
    )
      target = null;
    if (u.deployment === "deployed") {
      if (u.hold) return;
      if (u.fireTarget) target = u.fireTarget;
      if (target && (distance(u, target) < 180 || distance(u, target) > 690))
        target = null;
      if (!target) {
        target =
          state.buildings
            .filter(
              (b) =>
                b.team !== u.team &&
                b.team !== 2 &&
                b.hp > 0 &&
                (u.team === 0 ? fog : enemyFog).sees(b) &&
                distance(u, b) < TYPES.trebuchet.range &&
                distance(u, b) > 180,
            )
            .sort((a, b) => distance(a, u) - distance(b, u))[0] ||
          nearby(u, 690)
            .filter(
              (e) =>
                e.team !== u.team &&
                e.team !== 2 &&
                (u.team === 0 ? fog : enemyFog).sees(e) &&
                distance(u, e) > 180,
            )
            .sort(
              (a, b) =>
                nearby(b, 85).filter((c) => c.team === b.team).length -
                nearby(a, 85).filter((c) => c.team === a.team).length,
            )[0];
      }
      if (
        target &&
        distance(u, target) >= 180 &&
        distance(u, target) <= 690 &&
        u.cooldown <= 0
      ) {
        u.angle = Math.atan2(target.y - u.y, target.x - u.x);
        u.cooldown = 8;
        u.strike = 1;
        state.boulders.push({
          x: u.x,
          y: u.y,
          tx: target.x,
          ty: target.y,
          sx: u.x,
          sy: u.y,
          t: 0,
          duration: 2.1,
          team: u.team,
          source: u.id,
          damage: 135 * (1 + (u.rank || 0) * 0.25),
          r: 100,
        });
        sound("siege", u);
      }
      return;
    }
    if (u.order) {
      if (u.order.attack && u.team === 1) {
        target = target || acquire(u, 690);
        if (target && distance(u, target) < 620 && distance(u, target) > 210) {
          u.target = target.id;
          u.deployment = "setting-up";
          u.deployTimer = 6;
          u.order = null;
          u.path = [];
          return;
        }
        if (target) {
          const a = Math.atan2(u.y - target.y, u.x - target.x),
            goal = findFree({
              x: target.x + Math.cos(a) * 540,
              y: target.y + Math.sin(a) * 540,
            });
          moveUnit(u, goal, dt);
          return;
        }
      }
      marchUnit(u, dt);
    }
  }
  function combatAI(u, dt) {
    if (u.type === "chaplain") {
      supportAI(u, dt);
      return;
    }
    if (u.type === "trebuchet") {
      siegeAI(u, dt);
      return;
    }
    let target = u.target ? getObject(u.target) : null;
    if (
      target &&
      (target.team === u.team ||
        target.team === 2 ||
        !(u.team === 0 ? fog : enemyFog).sees(target) ||
        (distance(u, target) > 650 && !u.manualTarget))
    )
      target = null;
    if (u.team === 1 && u.scout) {
      u.target = null;
      const danger = nearby(u, 290)
        .filter(
          (e) => e.team === 0 && TYPES[e.type].damage > 0 && enemyFog.sees(e),
        )
        .sort((a, b) => distance(a, u) - distance(b, u))[0];
      if (danger) {
        const a = Math.atan2(u.y - danger.y, u.x - danger.x);
        moveUnit(
          u,
          findFree({ x: u.x + Math.cos(a) * 240, y: u.y + Math.sin(a) * 240 }),
          dt,
        );
        u.order = null;
      } else if (u.order) marchUnit(u, dt);
      return;
    }
    const arriving = u.order && distance(u, u.order) < 200;
    const engage =
      !u.order || u.order.attack || arriving || u.lastHit > state.time - 2;
    if (!target && engage) {
      const formation = state.formations.find(
        (f) => f.id === u.order?.formation && !f.arrived,
      );
      const r =
        arriving && !u.order?.attack
          ? TYPES[u.type].range + 35
          : formation
            ? Math.min(220, TYPES[u.type].range + 50)
            : 310;
      if (
        !formation ||
        distance(u, formation.anchor) < 270 ||
        u.lastHit > state.time - 2
      )
        target = acquire(u, u.hold ? TYPES[u.type].range + 35 : r);
    }
    if (target && u.type === "archer")
      u.aimAngle = Math.atan2(target.y - u.y, target.x - u.x);
    if (target && u.type === "archer" && !u.hold) {
      const threat = nearby(u, 100)
        .filter(
          (e) =>
            e.team !== u.team &&
            e.team !== 2 &&
            ["sword", "knight"].includes(e.type),
        )
        .sort((a, b) => distance(a, u) - distance(b, u))[0];
      if (threat) {
        if (distance(u, target) < 225 && u.cooldown <= 0) fire(u, target);
        const allies = nearby(u, 300)
            .filter(
              (a) => a.team === u.team && ["sword", "knight"].includes(a.type),
            )
            .sort((a, b) => distance(a, u) - distance(b, u)),
          anchor = allies[0] || u,
          a = Math.atan2(anchor.y - threat.y, anchor.x - threat.x);
        moveUnit(
          u,
          findFree({
            x: anchor.x + Math.cos(a) * 130,
            y: anchor.y + Math.sin(a) * 130,
          }),
          dt,
        );
        u.target = target.id;
        return;
      }
    }
    u.target = target?.id || null;
    if (target) {
      const range = TYPES[u.type].range + (target.kind ? 15 : 5),
        d = target.kind
          ? Math.hypot(
              Math.max(0, Math.abs(u.x - target.x) - target.w / 2),
              Math.max(0, Math.abs(u.y - target.y) - target.h / 2),
            )
          : distance(u, target);
      u.angle = Math.atan2(target.y - u.y, target.x - u.x);
      if (d <= range) {
        if (u.cooldown <= 0) fire(u, target);
      } else if (!u.hold) {
        let goal = target.kind
          ? edgePoint(u, target, 16)
          : { x: target.x, y: target.y };
        if (
          u.type === "knight" &&
          !target.kind &&
          ["archer", "chaplain", "trebuchet"].includes(target.type) &&
          d > 90
        ) {
          const a =
            Math.atan2(target.y - u.y, target.x - u.x) +
            (u.id % 2 ? 1 : -1) * 0.6;
          goal = {
            x: target.x - Math.cos(a) * 55,
            y: target.y - Math.sin(a) * 55,
          };
        }
        moveUnit(u, goal, dt);
      }
      return;
    }
    u.manualTarget = false;
    if (u.order) {
      marchUnit(u, dt);
    } else if (u.team === 1 && u.home && distance(u, u.home) > 60)
      moveUnit(u, u.home, dt);
  }
  function fire(u, target) {
    u.aimAngle = Math.atan2(target.y - u.y, target.x - u.x);
    u.angle = u.aimAngle;
    u.cooldown = TYPES[u.type].cooldown;
    u.strike = 0.35;
    let n = TYPES[u.type].damage * (1 + (u.rank || 0) * 0.25);

    if (u.blessed > 0) n *= 1.25;
    if (stock(u.team).food < 1) n *= 0.75;
    if (nearby(u, 180).some((a) => a.team === u.team && a.type === "standard"))
      n *= 1.12;
    if (u.type === "archer") projectile(u, target, n);
    else damage(target, n, u);
    sound(u.type === "archer" ? "arrow" : "hit", u);
  }
  const DIFFICULTIES = {
    easy: {
      think: 10,
      workers: 10,
      attack: 22,
      retreat: 0.65,
      reserve: 6,
      grace: 300,
    },
    normal: {
      think: 6,
      workers: 16,
      attack: 24,
      retreat: 0.55,
      reserve: 6,
      grace: 240,
    },
    hard: {
      think: 4,
      workers: 24,
      attack: 28,
      retreat: 0.45,
      reserve: 7,
      grace: 180,
    },
  };
  function enemyEconomy(dt) {
    const ai = state.enemy,
      plan = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
    ai.think -= dt;
    if (ai.think > 0) return;
    ai.think = plan.think;
    const base = completeBuildings("towncenter", 1)[0];
    if (!base) return;
    const ws = workers(1),
      army = fighters(1),
      pop = population(1);
    const known = Object.values(enemyFog.known).filter(
      (b) => b.team === 0 && b.hp > 0,
    );
    ai.discovered = known.length > 0;
    function train(type) {
      const b = completeBuildings(TYPES[type].producer, 1).sort(
        (a, b) => a.queue.length - b.queue.length,
      )[0];
      if (
        !b ||
        b.queue.length >= 3 ||
        pop.used + pop.queued >= pop.cap ||
        !afford(TYPES[type].cost, 1)
      )
        return false;
      pay(TYPES[type].cost, 1, 1);
      ai.spent += Object.values(TYPES[type].cost).reduce((a, b) => a + b, 0);
      b.queue.push({
        kind: "unit",
        type,
        time: 0,
        duration: TYPES[type].train,
        cost: { ...TYPES[type].cost },
      });
      pop.queued++;
      return true;
    }
    function build(kind) {
      if (
        !afford(BUILDINGS[kind].cost, 1) ||
        state.buildings.some(
          (b) => b.team === 1 && b.kind === kind && b.progress < 1 && b.hp > 0,
        )
      )
        return false;
      const builders = ws.filter((u) => u.job?.kind !== "build").slice(0, 2);
      if (!builders.length) return false;
      for (let i = 0; i < 100; i++) {
        const a = i * 2.399,
          r = 310 + Math.floor(i / 12) * 65,
          p = { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r };
        if (!validSite(kind, p, 1)) continue;
        pay(BUILDINGS[kind].cost, 1, 1);
        const b = makeBuilding(kind, 1, p.x, p.y, 0);
        state.buildings.push(b);
        state.navDirty = true;
        builders.forEach((u) => {
          u.job = { kind: "build", target: b.id };
          u.order = null;
          u.target = null;
        });
        return true;
      }
      return false;
    }
    if (pop.cap - pop.used - pop.queued < 5) build("house");
    if (ws.length < plan.workers) train("worker");
    for (const kind of ["lumbercamp", "miningcamp", "mill"])
      if (!completeBuildings(kind, 1).length) build(kind);
    const farms = completeBuildings("farm", 1).filter((b) => b.remaining > 0);
    if (farms.length < Math.ceil(ws.length / 7)) build("farm");
    for (const kind of ["barracks", "stable", "chapel", "siegeworkshop"])
      if (
        !completeBuildings(kind, 1).length &&
        (kind !== "siegeworkshop" || state.time > 150)
      )
        build(kind);
    if (state.time > 100 && !completeBuildings("tower", 1).length)
      build("tower");
    const damaged = completeBuildings(null, 1).filter(
      (b) =>
        b.hp < b.maxHp * 0.7 &&
        !ws.some((u) => u.job?.kind === "repair" && u.job.target === b.id),
    );
    if (damaged.length && state.enemy.resources.wood > 25) {
      const b = damaged.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0],
        worker = ws
          .filter((u) => u.job?.kind !== "build")
          .sort((a, c) => distance(a, b) - distance(c, b))[0];
      if (worker) {
        worker.job = { kind: "repair", target: b.id };
        worker.order = null;
      }
    }
    const desired = { food: 0.3, wood: 0.3, gold: 0.25, stone: 0.15 },
      assignments = { food: 0, wood: 0, gold: 0, stone: 0 };
    for (const u of ws) if (u.job?.resource) assignments[u.job.resource]++;
    for (const u of ws) {
      if (u.job?.kind === "build" && getObject(u.job.target)?.progress >= 1)
        u.job = null;
      if (u.job || u.order || u.exhaustedCluster || u.fleeUntil > state.time)
        continue;
      const resource = Object.keys(desired).sort(
        (a, b) =>
          assignments[a] / Math.max(1, ws.length) -
          desired[a] -
          (assignments[b] / Math.max(1, ws.length) - desired[b]),
      )[0];
      for (const r of [
        resource,
        ...Object.keys(desired).filter((r) => r !== resource),
      ])
        if (assignGather(u, r)) {
          assignments[r]++;
          break;
        }
    }
    const cycle = [
      "sword",
      "archer",
      "sword",
      "knight",
      "archer",
      "chaplain",
      "standard",
      "trebuchet",
    ];
    for (let i = 0; i < (state.difficulty === "hard" ? 2 : 1); i++)
      train(cycle[(army.length + i) % cycle.length]);
    if (state.difficulty !== "easy" && state.time > 300) {
      for (const type of ["sword", "archer", "knight"]) {
        const t = TECHS[type + (rankFor(type, 1) + 1)],
          b = t && completeBuildings(t.producer, 1)[0];
        if (
          t &&
          b &&
          b.queue.length < 2 &&
          !state.buildings.some(
            (b) =>
              b.team === 1 && b.queue.some((q) => q.tech === type + t.rank),
          ) &&
          afford(t.cost, 1)
        ) {
          pay(t.cost, 1, 1);
          b.queue.push({
            kind: "research",
            tech: type + t.rank,
            time: 0,
            duration: t.time,
            cost: { ...t.cost },
          });
          break;
        }
      }
    }
    // Scouts choose unexplored grid sectors, never undiscovered player coordinates.
    const scouts = army.filter((u) => u.scout);
    const scoutLimit =
      state.difficulty === "hard" ? 3 : state.difficulty === "easy" ? 1 : 2;
    for (const u of army
      .filter((u) => !u.scout && ["knight", "archer"].includes(u.type))
      .slice(0, Math.max(0, scoutLimit - scouts.length))) {
      u.scout = true;
      u.squad = null;
      scouts.push(u);
    }
    const reserved = [];
    for (const scout of scouts)
      if (
        !scout.target &&
        (!scout.order || distance(scout, scout.order) < 90)
      ) {
        let best = null,
          score = Infinity;
        for (let y = 450; y < H - 200; y += 650)
          for (let x = 450; x < W - 200; x += 650) {
            const p = { x, y };
            if (
              enemyFog.remembers(p) ||
              reserved.some((q) => distance(q, p) < 550)
            )
              continue;
            const value = distance(scout, p);
            if (value < score) {
              score = value;
              best = p;
            }
          }
        if (best) {
          reserved.push(best);
          ai.scout++;
          scout.order = { ...findFree(best), attack: false };
          scout.pathTimer = 0;
        }
      }
    const active = army.filter((u) => !u.scout),
      visibleThreats = state.units.filter(
        (u) => u.team === 0 && enemyFog.sees(u) && distance(u, base) < 850,
      );
    if (visibleThreats.length) {
      const target = visibleThreats.sort(
        (a, b) => distance(a, base) - distance(b, base),
      )[0];
      const defenders = active.filter(
        (u) => !u.order?.formation && distance(u, base) < 950,
      );
      if (defenders.length > 2) {
        const id = ++uid,
          center = defenders.reduce(
            (p, u) => ({
              x: p.x + u.x / defenders.length,
              y: p.y + u.y / defenders.length,
            }),
            { x: 0, y: 0 },
          );
        const destination = findFree(target);
        defenders.forEach((u, i) => {
          const goal = findFree({
            x: destination.x + ((i % 5) - 2) * 26,
            y:
              destination.y +
              Math.floor(i / 5) * 26 +
              (u.type === "chaplain" ? 150 : 0),
          });
          u.order = { ...goal, attack: true, formation: id };
          u.marchOffset = {
            x: goal.x - destination.x,
            y: goal.y - destination.y,
          };
          u.pathTimer = 0;
        });
        state.formations.push({
          id,
          members: defenders.map((u) => u.id),
          anchor: center,
          destination,
          path: nav.find(center, destination),
          revision: nav.revision,
          speed: Math.min(...defenders.map((u) => TYPES[u.type].speed)),
          arrived: false,
          wait: 0,
        });
      }
      return;
    }
    const healthy = active.filter(
      (u) => u.hp / u.maxHp > plan.retreat && distance(u, base) < 1200,
    );
    // Reinforcements muster at home instead of trickling into the battle.
    for (const u of active)
      if (!u.order && !u.target && !u.hold) {
        u.home ||= findFree({
          x: base.x - 180 + (u.id % 6) * 26,
          y: base.y + 180 + Math.floor((u.id % 24) / 6) * 26,
        });
      }
    for (const u of active)
      if (u.hp / u.maxHp < plan.retreat) {
        u.target = null;
        u.order = {
          ...findFree({ x: base.x - 100, y: base.y + 120 }),
          attack: false,
        };
        u.squad = null;
      }
    if (
      known.length &&
      healthy.length >= plan.attack &&
      state.time >= plan.grace &&
      state.time - ai.attack > 100 &&
      !state.formations.some(
        (f) =>
          !f.arrived && f.members.some((id) => active.some((u) => u.id === id)),
      )
    ) {
      ai.attack = state.time;
      if (ai.faith >= 30 && state.difficulty !== "easy") {
        ai.faith -= 30;
        for (const u of healthy) {
          u.blessed = 15;
          u.hp = Math.min(u.maxHp, u.hp + 30);
        }
      }
      const target = known.sort(
        (a, b) =>
          (a.kind === "tower" ? 500 : 0) +
          distance(a, base) -
          ((b.kind === "tower" ? 500 : 0) + distance(b, base)),
      )[0];
      const center = healthy.reduce(
        (p, u) => ({
          x: p.x + u.x / healthy.length,
          y: p.y + u.y / healthy.length,
        }),
        { x: 0, y: 0 },
      );
      const a = Math.atan2(target.y - center.y, target.x - center.x),
        group = healthy
          .sort((a, b) => TYPES[a.type].rank - TYPES[b.type].rank)
          .slice(0, -plan.reserve);
      const formationId = ++uid,
        destination = findFree({
          x: target.x - Math.cos(a) * (target.r + 80),
          y: target.y - Math.sin(a) * (target.r + 80),
        });
      group.forEach((u, i) => {
        const rear =
            u.type === "chaplain"
              ? 150
              : u.type === "trebuchet"
                ? 450
                : Math.floor(i / 6) * 24,
          side = ((i % 6) - 2.5) * 25;
        const goal = findFree({
          x:
            target.x -
            Math.cos(a) * (target.r + 80 + rear) -
            Math.sin(a) * side,
          y:
            target.y -
            Math.sin(a) * (target.r + 80 + rear) +
            Math.cos(a) * side,
        });
        u.squad = null;
        u.home = null;
        u.order = { ...goal, attack: true, formation: formationId };
        u.formation = { id: formationId, ...goal };
        u.marchOffset = {
          x: goal.x - destination.x,
          y: goal.y - destination.y,
        };
        u.pathTimer = 0;
        if (u.type === "trebuchet" && u.deployment === "deployed") {
          u.deployment = "packing";
          u.deployTimer = 4;
          u.pendingOrder = u.order;
          u.order = null;
        }
      });
      if (group.length)
        state.formations.push({
          id: formationId,
          members: group.map((u) => u.id),
          anchor: { ...center },
          destination,
          path: nav.find(center, destination),
          revision: nav.revision,
          speed: Math.min(...group.map((u) => TYPES[u.type].speed)),
          arrived: false,
          wait: 0,
        });
    }
  }
  function strategicAI(dt) {
    enemyEconomy(dt);
  }
  function civilianAI(u, dt) {
    const threats = nearby(u, 180).filter(
      (e) => e.team !== 2 && TYPES[e.type].damage > 0,
    );
    if (threats.length) {
      const closest = threats.sort(
          (a, b) => distance(a, u) - distance(b, u),
        )[0],
        a = Math.atan2(u.y - closest.y, u.x - closest.x);
      u.order = findFree({
        x: u.x + Math.cos(a) * 170,
        y: u.y + Math.sin(a) * 170,
      });
      u.wander = 6;
    }
    u.wander -= dt;
    if (!u.order && u.wander <= 0) {
      const a = (u.id * 1.71 + Math.floor(state.time / 9)) * 2.4;
      u.order = findFree({
        x: u.home.x + Math.cos(a) * 115,
        y: u.home.y + Math.sin(a) * 100,
      });
      u.wander = 6 + (u.id % 6);
    }
    if (u.order && moveUnit(u, u.order, dt)) u.order = null;
  }
  function caravanAI(u, dt) {
    const escort = nearby(u, 220).some(
        (a) =>
          a.team === 0 &&
          ![
            "worker",
            "chaplain",
            "trebuchet",
            "civilian",
            "pilgrim",
            "merchant",
          ].includes(a.type),
      ),
      danger = nearby(u, 210).some(
        (a) => a.team === 1 && TYPES[a.type].damage > 0,
      );
    u.escortWaiting = !escort || danger;
    if (u.escortWaiting) return;
    const goal = u.route[u.routeIndex];
    if (!goal) return;
    if (moveUnit(u, goal, dt, 35)) {
      u.routeIndex++;
      u.pathTimer = 0;
      if (u.routeIndex >= u.route.length) {
        state.stats.rescued++;
        toast("A pilgrim caravan has reached the refuge.");
        u.evacuated = true;
        u.hp = 0;
      }
    }
  }
  function objectiveState() {
    const l = LEVELS[state.level],
      fort = state.buildings[1];
    if (state.mode === "quickmatch") {
      const remaining = state.buildings.filter(
        (b) =>
          b.team === 1 && ["fort", "towncenter"].includes(b.kind) && b.hp > 0,
      ).length;
      return {
        progress: remaining ? 0 : 1,
        text: "Destroy the enemy town center",
        won: !remaining,
      };
    }
    if (l.kind === "settlement") {
      const farms = completeBuildings("farm").length,
        food = state.stats.gathered.food;
      return {
        progress:
          (Math.min(2, farms) / 2 +
            Math.min(200, food) / 200 +
            (fort.team === 0 ? 1 : 0)) /
          3,
        text: `Farms ${Math.min(2, farms)}/2 · food gathered ${Math.floor(Math.min(200, food))}/200 · outpost ${fort.team === 0 ? "secured" : "unclaimed"}`,
        won: farms >= 2 && food >= 200 && fort.team === 0,
      };
    }
    if (l.kind === "escort") {
      const tower = completeBuildings("tower").some(
          (b) => distance(b, { x: riverX(1150), y: 1150 }) < 280,
        ),
        rescued = state.stats.rescued;
      return {
        progress: (Math.min(2, rescued) / 2 + (tower ? 1 : 0)) / 2,
        text: `Pilgrims ${rescued}/2 · bridge ${tower ? "fortified" : "unsecured"}`,
        won: rescued >= 2 && tower,
      };
    }
    if (l.kind === "survival") {
      const chapel = completeBuildings("chapel").length > 0;
      return {
        progress: (Math.min(360, state.time) / 360 + (chapel ? 1 : 0)) / 2,
        text: `Hold ${Math.floor(Math.min(state.time, 360))}/360s · chapel ${chapel ? "complete" : "needed"}`,
        won: state.time >= 360 && chapel,
      };
    }
    if (l.kind === "liberation") {
      const sites = state.sites.filter((s) => !s.optional && s.captured).length;
      return {
        progress: (sites / 2 + Math.min(90, state.occupation) / 90) / 2,
        text: `Villages ${sites}/2 · hold ${Math.floor(state.occupation)}/90s`,
        won: sites === 2 && state.occupation >= 90,
      };
    }
    if (l.kind === "siege") {
      const gates = state.buildings.filter((b) => b.gate && b.hp <= 0).length;
      return {
        progress:
          (Math.min(2, gates) / 2 + (state.stats.siegeHits > 0 ? 1 : 0)) / 2,
        text: `Gatehouses ${gates}/2 · siege hits ${state.stats.siegeHits}`,
        won: gates >= 2 && state.stats.siegeHits > 0,
      };
    }
    const sites = state.sites.filter((s) => !s.optional && s.captured).length;
    return {
      progress:
        ((state.citadelTaken ? 1 : 0) +
          sites / 2 +
          Math.min(90, state.occupation) / 90) /
        3,
      text: `Sites ${sites}/2 · citadel ${state.citadelTaken ? "taken" : "standing"} · hold ${Math.floor(state.occupation)}/90s`,
      won: state.citadelTaken && sites === 2 && state.occupation >= 90,
    };
  }
  function update(dt) {
    if (!playable()) return;
    const ownCapital =
      state.buildings.find((b) => b.id === state.capitals?.player) ||
      state.buildings.find((b) => b.team === 0 && b.kind === "towncenter");
    const enemyCapital =
      state.buildings.find((b) => b.id === state.capitals?.enemy) ||
      state.buildings.find((b) => b.team === 1 && b.kind === "towncenter");
    if (ownCapital?.hp <= 0) {
      finish(false);
      return;
    }
    if (
      enemyCapital?.hp <= 0 ||
      (state.mode !== "quickmatch" &&
        !state.buildings[1]?.outpost &&
        state.buildings[1]?.hp <= 0)
    ) {
      finish(true);
      return;
    }
    if (DEBUG_MODE && state.cheats?.instant) {
      for (const b of state.buildings)
        if (b.team === 0 && b.hp > 0) {
          if (b.progress < 1) {
            b.progress = 1;
            b.hp = b.maxHp;
            state.navDirty = true;
          }
          if (b.queue[0]) b.queue[0].time = b.queue[0].duration;
        }
    }
    state.time += dt;
    visionTimer -= dt;
    if (visionTimer <= 0) {
      fog.update(state.units, state.buildings);
      enemyFog.update(state.units, state.buildings);
      visionTimer = 0.2;
    }
    state.waveTimer -= dt;
    state.saveTimer -= dt;
    const foodUse = fighters().length * 0.025 * dt;
    state.resources.food = Math.max(0, state.resources.food - foodUse);
    const consumption = Math.min(
      state.enemy.resources.food,
      fighters(1).length * 0.025 * dt,
    );
    state.enemy.consumed += consumption;
    state.enemy.faith = Math.min(
      250,
      state.enemy.faith +
        (fighters(1).filter((u) => u.type === "chaplain").length * 0.55 +
          completeBuildings("chapel", 1).length * 0.5) *
          dt,
    );
    state.enemy.resources.food = Math.max(
      0,
      state.enemy.resources.food - fighters(1).length * 0.025 * dt,
    );
    state.faith = Math.min(
      250,
      state.faith +
        (fighters().filter((u) => u.type === "chaplain").length * 0.55 +
          completeBuildings("chapel").length * 0.5) *
          dt,
    );
    if (state.navDirty) {
      state.navDirty = false;
      rebuildNavigation();
    }
    rebuildSpatial();
    updateScouting(dt);
    updateFormations(dt);
    strategicAI(dt);
    for (const b of state.buildings) {
      if (b.hp <= 0 || b.progress < 1) continue;
      const item = b.queue[0];
      if (item) {
        item.time += dt;
        if (item.time >= item.duration) {
          b.queue.shift();
          if (item.kind === "research") {
            const t = TECHS[item.tech];
            (b.team === 0 ? state.upgrades : state.enemy.upgrades)[t.type] =
              t.rank;
            if (b.team === 0) state.techs[item.tech] = true;
            for (const u of state.units)
              if (u.team === b.team && u.type === t.type) applyRank(u, t.rank);
            if (b.team === 0)
              toast(
                t.name +
                  " upgrade complete. Your whole company has been upgraded.",
              );
          } else {
            const p = spawnPoint(b),
              u = makeUnit(item.type, b.team, p.x, p.y);
            applyRank(u, rankFor(item.type, b.team));
            if (b.rally)
              u.order = {
                ...rallyPosition(u, b.rally),
                rally: { ...b.rally },
                attack: true,
              };
            state.units.push(u);
            if (b.team === 0)
              toast(unitName(u) + " has joined the settlement.");
            sound("recruit");
          }
        }
      }
      const spec = BUILDINGS[b.kind];
      if (spec.range && b.team !== 2) {
        b.guardCooldown -= dt;
        if (b.guardCooldown <= 0) {
          const target = nearby(b, spec.range)
            .filter(
              (u) =>
                u.team !== b.team &&
                u.team !== 2 &&
                (b.team === 0 ? fog : enemyFog).sees(u),
            )
            .sort((a, c) => distance(a, b) - distance(c, b))[0];
          if (target) {
            b.guardCooldown = 2.3;
            projectile({ ...b, type: "archer" }, target, spec.damage);
          }
        }
      }
      if (b.kind === "chapel" && b.team !== 2) {
        for (const u of nearby(b, 180))
          if (u.team === b.team && u.hp < u.maxHp) {
            const heal = Math.min(u.maxHp - u.hp, dt * 2);
            u.hp += heal;
            state.healed += heal;
          }
      }
    }
    for (const u of [...state.units]) {
      if (u.hp <= 0) continue;
      u.moving = false;
      u.working = false;
      u.cooldown -= dt;
      u.strike = Math.max(0, u.strike - dt);
      u.blessed = Math.max(0, u.blessed - dt);
      if (u.autoScout) {
        u.target = null;
        if (u.type === "trebuchet" && u.deployment === "packing") {
          u.deployTimer -= dt;
          if (u.deployTimer <= 0) {
            u.deployment = "packed";
            u.order = u.pendingOrder;
            u.pendingOrder = null;
          }
        }
        if (u.order) marchUnit(u, dt);
      } else if (u.type === "worker") workerAI(u, dt);
      else if (u.type === "civilian") civilianAI(u, dt);
      else if (u.type === "pilgrim" || u.type === "merchant") caravanAI(u, dt);
      else combatAI(u, dt);
    }
    // Local crowd separation preserves formation slots without pushing units through walls.
    for (const u of state.units) {
      if (u.hp <= 0 || !u.moving) continue;
      for (const other of nearby(u, 24)) {
        if (other.id <= u.id || other.hp <= 0) continue;
        const d = distance(u, other),
          r =
            u.type === "knight" ||
            other.type === "knight" ||
            u.type === "trebuchet" ||
            other.type === "trebuchet"
              ? 26
              : 18;
        if (d < r && d > 0.1) {
          if (
            u.order?.formation &&
            u.order.formation === other.order?.formation &&
            distance(u, u.order) > 180 &&
            distance(other, other.order) > 180
          )
            continue;
          const push = (r - d) * Math.min(0.06, dt * 1.5),
            dx = ((u.x - other.x) / d) * push,
            dy = ((u.y - other.y) / d) * push;
          if (groundFree(u.x + dx, u.y + dy, 7)) {
            u.x += dx;
            u.y += dy;
          }
          if (other.moving && groundFree(other.x - dx, other.y - dy, 7)) {
            other.x -= dx;
            other.y -= dy;
          }
        }
      }
    }
    for (const a of state.arrows) {
      const target = getObject(a.target);
      if (target?.hp > 0) {
        a.tx = target.x;
        a.ty = target.y;
      }
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (d < 480 * dt) {
        if (target?.hp > 0)
          damage(target, a.damage, { id: 0, team: a.team, type: "archer" });
        a.life = 0;
      } else {
        a.x += ((a.tx - a.x) / d) * 480 * dt;
        a.y += ((a.ty - a.y) / d) * 480 * dt;
        a.life -= dt;
      }
    }
    state.arrows = state.arrows.filter((a) => a.life > 0);
    for (const stone of state.boulders) {
      stone.t += dt;
      const flight = clamp(stone.t / stone.duration, 0, 1),
        px = stone.sx + (stone.tx - stone.sx) * flight,
        py =
          stone.sy +
          (stone.ty - stone.sy) * flight -
          Math.sin(flight * Math.PI) * 150;
      state.particles.push({
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 20,
        vy: -12,
        t: 0,
        life: 0.45,
        color: Math.random() < 0.5 ? "#f4a342" : "#4c433ecc",
        r: 3 + Math.random() * 4,
      });
      if (stone.t >= stone.duration && !stone.hit) {
        stone.hit = true;
        const source = { id: stone.source, team: stone.team };
        for (const target of [...state.units, ...state.buildings])
          if (target.hp > 0 && target.team !== 2) {
            const d = distance({ x: stone.tx, y: stone.ty }, target);
            if (d < stone.r + (target.kind ? target.r * 0.6 : 0)) {
              const amount =
                stone.damage *
                (1 - clamp(d / (stone.r + (target.r || 0)), 0, 0.7));
              damage(target, amount, source, true);
            }
          }
        state.rings.push({
          x: stone.tx,
          y: stone.ty,
          t: 0,
          color: "#efaa4e",
          r: stone.r,
        });
        for (let i = 0; i < 68; i++)
          state.particles.push({
            x: stone.tx,
            y: stone.ty,
            vx: (Math.random() - 0.5) * 240,
            vy: (Math.random() - 0.5) * 240,
            t: 0,
            life: 0.6 + Math.random() * 1.4,
            color: ["#ffd778", "#ee8633", "#d0461d", "#594e42", "#88735a"][
              i % 5
            ],
            r: 2 + Math.random() * 7,
          });
        sound("impact");
      }
    }
    state.boulders = state.boulders.filter((s) => !s.hit);
    for (const s of state.sites) {
      if (s.name === "Pilgrim refuge") continue;
      const owner = s.team ?? (s.captured ? 0 : 2);
      const counts = [0, 0];
      for (const u of state.units)
        if (
          u.hp > 0 &&
          u.team < 2 &&
          ![
            "worker",
            "civilian",
            "chaplain",
            "trebuchet",
            "pilgrim",
            "merchant",
          ].includes(u.type) &&
          distance(u, s) < s.r
        )
          counts[u.team]++;
      const claimant =
        counts[0] >= 3 && !counts[1]
          ? 0
          : counts[1] >= 3 && !counts[0]
            ? 1
            : null;
      s.team = owner;
      if (claimant !== null && claimant !== owner) {
        if (s.claimingTeam !== claimant) {
          s.claimingTeam = claimant;
          s.claimProgress = 0;
        }
        s.claimProgress = Math.min(1, (s.claimProgress || 0) + dt / 18);
        if (s.claimProgress >= 1) {
          s.team = claimant;
          s.captured = claimant === 0;
          s.progress = 1;
          s.claimProgress = 0;
          s.claimingTeam = null;
          for (const building of state.buildings)
            if (building.site === s.id && building.hp > 0)
              building.team = claimant;
          toast(
            s.name +
              (claimant === 0
                ? " secured beneath your standards."
                : " captured by the opposing host."),
          );
          sound("bell");
        }
      } else s.claimProgress = Math.max(0, (s.claimProgress || 0) - dt / 18);
      s.captured = s.team === 0;
      if (s.team === 2) s.progress = s.claimProgress || 0;
    }
    if (
      (state.citadelTaken || LEVELS[state.level].kind === "liberation") &&
      state.sites.filter((s) => !s.optional).every((s) => s.captured)
    )
      state.occupation += dt;
    else state.occupation = 0;
    for (const p of state.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    state.particles = state.particles.filter((p) => p.t < p.life).slice(-400);
    for (const r of state.rings) r.t += dt;
    state.rings = state.rings.filter((r) => r.t < 1).slice(-80);
    for (const c of state.corpses) c.t += dt;
    for (const m of state.marks) m.t += dt;
    state.corpses = state.corpses.slice(-260);
    state.marks = state.marks.slice(-260);
    state.units = state.units.filter((u) => u.hp > 0);
    state.squads = state.squads.filter(
      (s) => s.role === "guard" || state.units.some((u) => u.squad === s.id),
    );
    if (
      LEVELS[state.level].kind === "escort" &&
      state.stats.rescued +
        state.units.filter((u) => u.type === "pilgrim").length <
        2
    ) {
      finish(false);
      return;
    }
    if (objectiveState().won) finish(true);
    if (state.saveTimer <= 0) {
      state.saveTimer = 20;
      if (!TEST) saveGame();
    }
  }
  function setTab(value) {
    tab = value;
    for (const name of ["army", "settlement", "research"])
      $(name + "-tab").setAttribute("aria-selected", String(name === value));
    for (const [name, list] of [
      ["army", "recruit"],
      ["settlement", "build"],
      ["research", "research"],
    ])
      $(list + "-list").classList.toggle("hidden", name !== value);
  }
  function actionCard(id, name, cost, art, action, tooltip) {
    const b = document.createElement("button");
    b.id = id;
    b.className = "action-card";
    b.title = tooltip || name;
    b.addEventListener("click", action);
    const c = document.createElement("canvas");
    c.width = 90;
    c.height = 80;
    const g = c.getContext("2d");
    g.translate(45, 40);
    if (art.type) {
      g.scale(1.5, 1.5);
      drawUnit(
        g,
        {
          type: art.type,
          team: 0,
          angle: -Math.PI / 2,
          anim: 0,
          moving: false,
          cooldown: 0,
          strike: 0,
          carry: 0,
          job: null,
          deployment: "packed",
        },
        0,
      );
    } else if (art.kind) {
      const spec = BUILDINGS[art.kind],
        scale = Math.min(65 / spec.w, 58 / spec.h);
      g.scale(scale, scale);
      Art.structure(
        g,
        {
          kind: art.kind,
          team: 0,
          x: 0,
          y: 0,
          w: spec.w,
          h: spec.h,
          hp: spec.hp,
          maxHp: spec.hp,
          progress: 1,
        },
        0,
      );
    } else {
      g.fillStyle = "#c5a36b";
      g.font = "34px Georgia";
      g.textAlign = "center";
      g.fillText(art.symbol, 0, 10);
    }
    const strong = document.createElement("strong");
    strong.textContent = name;
    const price = document.createElement("span");
    price.className = "cost";
    price.textContent = costText(cost);
    b.append(c, strong, price);
    if (art.type && ROLES[art.type]) {
      const role = document.createElement("span");
      role.className = "role";
      role.textContent = ROLES[art.type].label;
      b.append(role);
      b.title += " " + ROLES[art.type].description;
    }
    return b;
  }
  function initActions() {
    for (const key of [
      "worker",
      "sword",
      "archer",
      "knight",
      "chaplain",
      "standard",
      "trebuchet",
    ]) {
      const t = TYPES[key];
      $("recruit-list").append(
        actionCard(
          "recruit-" + key,
          t.short || t.name,
          t.cost,
          { type: key },
          () => recruit(key),
          `${t.name}: ${costText(t.cost)}. Trained at ${BUILDINGS[t.producer].name}.`,
        ),
      );
    }
    for (const [k, t] of Object.entries(BUILDINGS))
      if (t.cost)
        $("build-list").append(
          actionCard(
            "build-" + k,
            t.name,
            t.cost,
            { kind: k },
            () => beginBuild(k),
            `${t.name}: ${costText(t.cost)}. ${t.time}s per villager.`,
          ),
        );
    for (const [k, t] of Object.entries(TECHS))
      $("research-list").append(
        actionCard(
          "research-" + k,
          t.name,
          t.cost,
          { type: t.type },
          () => research(k),
          t.desc,
        ),
      );
  }

  function updateUI() {
    if (!state) return;
    $("rotate-placement").hidden = placement !== "gate";
    const audioState = window.CruciataAudio.status();
    $("music-now-playing").textContent =
      settings.musicVolume === 0
        ? "Music muted"
        : audioState.music.title
          ? "Now playing: " + audioState.music.title + " (shuffled playlist)"
          : "Background music: shuffled playlist";
    for (const r of ["food", "wood", "gold", "stone"])
      $(r).textContent = Math.floor(state.resources[r]);
    $("faith").textContent = Math.floor(state.faith);
    $("faith").parentElement.title =
      "Faith: chaplains and chapels generate devotion. Bless costs 30 faith and boosts selected soldiers for 15 seconds.";
    const pop = population();
    $("population").textContent = pop.used + pop.queued + " / " + pop.cap;
    $("population").title =
      `${pop.used} present, ${pop.queued} training, ${pop.cap} capacity`;
    $("timer").textContent =
      Math.floor(state.time / 60)
        .toString()
        .padStart(2, "0") +
      ":" +
      Math.floor(state.time % 60)
        .toString()
        .padStart(2, "0");
    $("status-label").textContent = state.result
      ? "CHAPTER " + state.result.toUpperCase()
      : state.paused
        ? "AT REST"
        : state.resources.food < 1
          ? "FOOD SHORTAGE"
          : "THE HOST MARCHES";
    const obj = objectiveState();
    $("objective-stage").textContent = obj.text;
    $("garrison-strength").textContent = Math.round(obj.progress * 100) + "%";
    $("garrison-progress").style.width = obj.progress * 100 + "%";
    $("wave-countdown").textContent = state.result
      ? "Battle concluded"
      : "Enemy command · " + state.difficulty + " AI";
    $("idle-count").textContent = workers().filter(
      (u) => !u.job && !u.order,
    ).length;
    $("worker-ledger").replaceChildren();
    for (const r of ["food", "wood", "gold", "stone"]) {
      const row = document.createElement("div");
      row.className = "worker-row";
      row.innerHTML = `<span>${r.charAt(0).toUpperCase() + r.slice(1)} hands</span><span>${workers().filter((u) => u.job?.resource === r).length}</span>`;
      $("worker-ledger").append(row);
    }
    const units = friendUnits().filter((u) => selected.has(u.id));
    if (units.length) selectedBuildings.clear();
    const b = state.buildings.find(
        (b) => b.id === selectedBuilding && b.hp > 0,
      ),
      single = units[0],
      icon = $("selection-icon").getContext("2d");
    icon.clearRect(0, 0, 74, 74);
    icon.save();
    icon.translate(37, 37);
    let health = 1;
    $("queue-detail").textContent = "";
    $("selection-role").textContent = units.length
      ? units.every((u) => u.type === single.type)
        ? ROLES[single.type]?.description || ""
        : "Mixed company: infantry forward, archers behind, chaplains protected at the rear."
      : "";
    if (b) {
      const spec = BUILDINGS[b.kind];
      $("selection-title").textContent = b.outpost
        ? state.sites.find((s) => s.id === b.site)?.name || "Outpost"
        : b.kind === "chapel" && b.team === 1
          ? "Prayer house"
          : spec.name;
      $("selection-label").textContent =
        b.team === 0
          ? "YOUR STRUCTURE"
          : b.team === 2
            ? b.outpost
              ? "NEUTRAL OUTPOST"
              : "CIVILIAN SETTLEMENT"
            : "OPPOSING GARRISON";
      $("selection-detail").textContent =
        b.progress < 1
          ? Math.floor(b.progress * 100) + "% constructed"
          : Math.round(b.hp) + " / " + b.maxHp + " health";
      health = b.hp / b.maxHp;
      icon.scale(Math.min(56 / b.w, 56 / b.h), Math.min(56 / b.w, 56 / b.h));
      Art.structure(icon, { ...b, x: 0, y: 0 }, state.time);
      if (b.queue.length) {
        const q = b.queue[0];
        $("queue-detail").textContent =
          (q.kind === "unit"
            ? unitName({
                type: q.type,
                team: b.team,
                rank: rankFor(q.type, b.team),
              })
            : b.team === 1
              ? ENEMY_VARIANTS[TECHS[q.tech].type]?.[TECHS[q.tech].rank] ||
                TECHS[q.tech].name
              : TECHS[q.tech].name) +
          " · " +
          Math.ceil(q.duration - q.time) +
          "s · " +
          b.queue.length +
          " queued";
      }
    } else if (units.length) {
      $("selection-label").textContent = units.every((u) => u.type === "worker")
        ? "YOUR VILLAGERS"
        : "YOUR COMPANY";
      $("selection-title").textContent =
        units.length === 1
          ? unitName(single)
          : units.length + " people selected";
      health = units.reduce((n, u) => n + u.hp / u.maxHp, 0) / units.length;
      let detail = Math.round(health * 100) + "% company health";
      if (units.length === 1) {
        if (single.type === "worker")
          detail =
            single.fleeUntil > state.time
              ? "Seeking shelter"
              : single.job?.kind === "gather"
                ? `${single.job.resource} · carrying ${Math.floor(single.carry)}`
                : single.job?.kind === "build"
                  ? "Constructing"
                  : single.job?.kind === "repair"
                    ? "Repairing"
                    : "Idle villager";
        if (single.type === "trebuchet")
          detail =
            single.deployment.replaceAll("-", " ") +
            (single.deployTimer > 0
              ? " · " + Math.ceil(single.deployTimer) + "s"
              : "");
        if (single.type === "chaplain")
          detail = "Rear guard · healing & benediction";
      }
      $("selection-detail").textContent = detail;
      icon.scale(1.5, 1.5);
      drawUnit(icon, { ...single, angle: -Math.PI / 2 }, state.time);
    } else {
      $("selection-label").textContent = "CRUSADER HOST";
      $("selection-title").textContent = "The pilgrim company";
      $("selection-detail").textContent =
        "Select troops, villagers, or a structure.";
      Art.cross(icon, 0, 0, 15, "#b69a6b");
    }
    if (selectedNode) {
      const n = getObject(selectedNode);
      if (n) {
        icon.save();
        icon.scale(0.7, 0.7);
        Art.resource(icon, { ...n, x: 0, y: 0 }, state.time);
        icon.restore();
        $("selection-title").textContent =
          n.kind.charAt(0).toUpperCase() + n.kind.slice(1) + " patch";
        $("selection-label").textContent = "FINITE RESOURCE";
        $("selection-detail").textContent =
          Math.ceil(n.remaining) + " / " + n.max + " remaining";
        $("selection-role").textContent =
          "Right-click with villagers to gather. Clear patch removes it without recovering resources.";
        health = n.remaining / n.max;
      }
    }
    for (const key of [
      "worker",
      "sword",
      "archer",
      "knight",
      "chaplain",
      "standard",
      "trebuchet",
    ])
      $("recruit-" + key).hidden = !state.buildings.some(
        (b) =>
          (selectedBuildings.has(b.id) || selectedBuilding === b.id) &&
          b.team === 0 &&
          b.kind === TYPES[key].producer,
      );
    for (const [key, t] of Object.entries(TECHS))
      $("research-" + key).hidden =
        !state.buildings.some(
          (c) =>
            c.team === 0 &&
            c.hp > 0 &&
            (c.id === selectedBuilding || selectedBuildings.has(c.id)) &&
            c.kind === t.producer,
        ) || rankFor(t.type) !== t.rank - 1;
    $("research-tab").hidden = !state.buildings.some(
      (c) =>
        c.team === 0 &&
        c.hp > 0 &&
        (c.id === selectedBuilding || selectedBuildings.has(c.id)) &&
        Object.values(TECHS).some((t) => t.producer === c.kind),
    );
    $("gate-button") &&
      ($("gate-button").hidden = b?.kind !== "gate" || b.team !== 0);
    $("clear-patch") && ($("clear-patch").hidden = !selectedNode);
    if (selectedBuildings.size > 1) {
      const buildings = state.buildings.filter(
        (b) => selectedBuildings.has(b.id) && b.hp > 0,
      );
      $("selection-title").textContent =
        buildings.length + " selected structures";
      $("selection-detail").textContent =
        "Training applies to every compatible selected building. Cancel affects every selected foundation or first queued order.";
      $("queue-detail").textContent =
        buildings.reduce((n, b) => n + b.queue.length, 0) + " total queued";
    }
    if (b)
      $("selection-role").textContent =
        b.progress < 1
          ? "Foundation: assign villagers to build by right-clicking. This project provides no vision until completed."
          : b.outpost
            ? "Capturable outpost: bring at least three soldiers within its ring for 18 seconds, with no opposing troops present. Neutral outposts provide neither army with vision."
            : BUILDINGS[b.kind].drop
              ? "Depot: villagers deliver " +
                BUILDINGS[b.kind].drop.join(", ") +
                " here. Nearby depots shorten gathering trips. New builders automatically gather after completion."
              : b.kind === "farm"
                ? "Grain field: up to 5 villagers work inside. " +
                  Math.ceil(b.remaining) +
                  " / " +
                  b.max +
                  " grain remains. Villagers automatically replant exhausted fields. Right-click with villagers to assign."
                : b.kind === "gate"
                  ? b.closed
                    ? "Closed fortified gate: blocks both armies. Siege engines breach its reinforced masonry. Open it to permit passage."
                    : "Open gate: passage for both armies. Close it to block the gap."
                  : b.team === 2
                    ? "Protected neutral village: cannot be attacked. Bring at least three soldiers close to claim it. Captured houses add population; protect the civilians."
                    : Object.values(TYPES).some((t) => t.producer === b.kind)
                      ? "Trains troops. Right-click terrain to set a rally point for new units."
                      : b.kind === "house"
                        ? "Housing adds 12 population. Cannot train troops or set a rally point."
                        : "Defensive structure. Cannot train troops or set a rally point.";
    if (isCapital(b))
      $("selection-role").textContent =
        "Capital and resource depot. Its destruction decides the battle immediately, regardless of other objectives. Trains villagers and accepts every resource.";
    icon.restore();
    $("selection-health").style.width = health * 100 + "%";
    $("attack-button").classList.toggle("active", mode === "attack");
    $("scout-button").disabled = !units.some((u) => u.type !== "worker");
    $("scout-button").classList.toggle(
      "active",
      units.some((u) => u.autoScout),
    );
    if (units.some((u) => u.autoScout))
      $("selection-role").textContent =
        "Scouting together: explores unknown ground, avoids battle and withdraws from attacks. A new order ends scouting.";
    $("deploy-button").disabled = !units.some((u) => u.type === "trebuchet");
    $("deploy-label").textContent = units.some(
      (u) => u.type === "trebuchet" && u.deployment === "deployed",
    )
      ? "Pack up"
      : "Set up";
    $("bless-button").disabled =
      state.faith < 30 || !units.some((u) => u.type !== "worker");
    $("cancel-button").disabled =
      !placement &&
      mode !== "attack" &&
      !state.buildings.some(
        (b) =>
          b.team === 0 &&
          b.hp > 0 &&
          (b.id === selectedBuilding || selectedBuildings.has(b.id)) &&
          (b.progress < 1 || b.queue.length),
      );
    for (const key of [
      "worker",
      "sword",
      "archer",
      "knight",
      "chaplain",
      "standard",
      "trebuchet",
    ]) {
      const t = TYPES[key],
        producer = producerFor(key);
      $("recruit-" + key).querySelector("strong").textContent =
        VARIANTS[key]?.[rankFor(key)] || t.short || t.name;
      $("recruit-" + key).disabled =
        !producer ||
        !afford(t.cost) ||
        pop.used + pop.queued >= pop.cap ||
        producer.queue.length >= 8 ||
        !!state.result;
    }
    for (const [k, t] of Object.entries(BUILDINGS))
      if (t.cost) {
        $("build-" + k).disabled = !afford(t.cost) || !!state.result;
        $("build-" + k).classList.toggle("active", placement === k);
      }
    for (const [k, t] of Object.entries(TECHS)) {
      $("research-" + k).disabled =
        !!state.techs[k] ||
        rankFor(t.type) !== t.rank - 1 ||
        state.buildings.some((b) => b.queue.some((q) => q.tech === k)) ||
        !completeBuildings(t.producer).length ||
        !afford(t.cost) ||
        !!state.result;
      $("research-" + k).classList.toggle("completed", !!state.techs[k]);
    }
  }

  function drawUnit(g, u, time, drawAngle = u.angle) {
    g.scale(0.72, 0.72);
    if (u.type === "trebuchet") {
      g.save();
      g.rotate(drawAngle + Math.PI / 2);
      Art.rect(g, -16, -24, 32, 48, "#8d7147", "#594a31");
      for (const x of [-20, 20])
        for (const y of [-16, 16]) Art.ellipse(g, x, y, 4, 9, "#554631");
      const deployed =
          u.deployment === "deployed" || u.deployment === "setting-up",
        unfold = deployed
          ? u.deployment === "setting-up"
            ? 1 - u.deployTimer / 6
            : 1
          : u.deployment === "packing"
            ? u.deployTimer / 4
            : 0;
      Art.line(
        g,
        [
          [-12, -15],
          [-12 - unfold * 10, 25],
        ],
        4,
        "#b79b63",
      );
      Art.line(
        g,
        [
          [12, -15],
          [12 + unfold * 10, 25],
        ],
        4,
        "#b79b63",
      );
      const release = u.strike > 0 ? Math.sin((1 - u.strike) * Math.PI) : 0;
      const swing = release * 18;
      g.translate(0, release * 2);
      for (const x of [-1, 1]) {
        Art.line(
          g,
          [
            [x * 14, -14],
            [x * (14 + unfold * 10), 22],
          ],
          4,
          "#c49b63",
        );
        Art.line(
          g,
          [
            [x * 14, -14],
            [x * 8, 14],
          ],
          2,
          "#e3c491",
        );
        Art.ellipse(g, x * (18 + unfold * 8), 23, 5, 3, "#9c8260");
      }
      for (const y of [-18, -9, 0, 9, 18])
        Art.line(
          g,
          [
            [-14, y],
            [14, y],
          ],
          0.7,
          "#b18a55",
        );
      Art.ellipse(g, -10, 13, 4, 4, "#4c4539");
      const winch =
        u.deployment === "setting-up" || u.deployment === "packing"
          ? time * 4
          : 0;
      Art.line(
        g,
        [
          [-10 + Math.cos(winch) * 4, 13 + Math.sin(winch) * 4],
          [-10 - Math.cos(winch) * 4, 13 - Math.sin(winch) * 4],
        ],
        1.5,
        "#b99b6c",
      );
      Art.line(
        g,
        [
          [0, 16],
          [swing, -35 - unfold * 18],
        ],
        5,
        "#c2a56d",
      );
      Art.rect(g, -8, 7, 16, 14, "#69624c", "#afa483");
      Art.ellipse(g, swing, -36 - unfold * 18, 6, 6, "#8c907a");
      Art.line(
        g,
        [
          [-13, -7],
          [13, -7],
        ],
        3,
        "#574a33",
      );
      g.restore();
      return;
    }
    if (u.type === "pilgrim" || u.type === "merchant") {
      g.save();
      g.rotate(drawAngle + Math.PI / 2);
      Art.rect(
        g,
        -14,
        -18,
        28,
        38,
        u.type === "pilgrim" ? "#d9c69e" : "#ad8b56",
        "#6c593c",
      );
      for (const x of [-18, 18])
        for (const y of [-12, 13]) Art.ellipse(g, x, y, 4, 7, "#67543a");
      if (u.type === "pilgrim") Art.cross(g, 0, 0, 9, "#963d30");
      else
        for (let i = 0; i < 3; i++)
          Art.ellipse(g, -7 + i * 7, 0, 4, 8, "#c3a364");
      Art.line(
        g,
        [
          [0, -18],
          [0, -42],
        ],
        2,
        "#846a43",
      );
      Art.ellipse(g, 0, -45, 7, 12, "#aa9370");
      g.restore();
      return;
    }
    Art.unit(g, u, time, drawAngle);
    if (u.type === "standard") {
      g.save();
      g.rotate(drawAngle + Math.PI / 2);
      Art.banner(g, 9, -20, u.team, time);
      g.restore();
    }
  }
  function healthBar(g, x, y, ratio, w = 32, team = 0) {
    Art.rect(g, x - w / 2, y, w, 4, "#38402c99");
    Art.rect(
      g,
      x - w / 2,
      y,
      w * clamp(ratio, 0, 1),
      4,
      team === 1 ? "#a74734" : "#72934e",
    );
  }
  function onScreen(o, margin = 120) {
    return (
      o.x + (o.rx || 0) >= view.x - margin &&
      o.y + (o.ry || 0) >= view.y - margin &&
      o.x - (o.rx || 0) <= view.x + view.w + margin &&
      o.y - (o.ry || 0) <= view.y + view.h + margin
    );
  }
  function render() {
    const r = canvas.getBoundingClientRect(),
      dpr = Math.min(2, devicePixelRatio || 1),
      cw = Math.round(r.width * dpr),
      ch = Math.round(r.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    updateView();
    ctx.setTransform(
      view.scale * dpr,
      0,
      0,
      view.scale * dpr,
      -view.x * view.scale * dpr,
      -view.y * view.scale * dpr,
    );
    ctx.clearRect(view.x, view.y, view.w, view.h);
    ctx.drawImage(terrain, 0, 0, W, H);
    const time = state.time;
    for (const u of state.units) {
      const desired =
        u.type === "archer" &&
        (u.strike > 0 || u.target) &&
        Number.isFinite(u.aimAngle)
          ? u.aimAngle
          : u.angle;
      u.visualAngle ??= desired;
      const turn = Math.atan2(
        Math.sin(desired - u.visualAngle),
        Math.cos(desired - u.visualAngle),
      );
      u.visualAngle += clamp(turn, -0.16, 0.16);
    }
    const biome = state.config
      ? state.config.biome
      : LEVELS[state.level].terrain === 2
        ? 3
        : LEVELS[state.level].terrain >= 3
          ? 2
          : LEVELS[state.level].terrain;
    for (const road of state.roads || []) {
      if (
        !road.some((p) => onScreen(p, 120)) &&
        !road.some(
          (p, i) =>
            i &&
            segmentDistance({ x: camera.x, y: camera.y }, road[i - 1], p) <
              Math.hypot(view.w, view.h) / 2 + 80,
        )
      )
        continue;
      const points = road.map((p) => [p.x, p.y]);
      Art.line(ctx, points, 38, "#a58c5e");
      Art.line(ctx, points, 33, "#c5b381");
      for (const offset of [-7, 7])
        Art.line(
          ctx,
          points.map(([x, y]) => [x + offset, y]),
          0.8,
          "#8d78493d",
        );
    }
    Art.terrainDetails(
      ctx,
      view,
      biome,
      coastX,
      riverX,
      time,
      bridgeY(),
      state.mode !== "quickmatch" && LEVELS[state.level].terrain === 0,
    );
    const movingCoverActors = state.units.filter(
      (u) =>
        u.hp > 0 &&
        u.moving &&
        onScreen(u, 240) &&
        (u.team === 0 || playerSees(u)),
    );
    for (const patch of state.groundCover || [])
      if (onScreen(patch, 220))
        Art.groundCover(
          ctx,
          patch,
          movingCoverActors.filter(
            (u) =>
              Math.abs(u.x - patch.x) < patch.rx + 35 &&
              Math.abs(u.y - patch.y) < patch.ry + 35,
          ),
          time,
        );
    for (const d of decorations)
      if (onScreen(d)) {
        if (d.kind === "ridge") Art.ridge(ctx, d, view);
        else if (d.kind === "cliff") Art.cliff(ctx, d);
        else if (d.kind === "rock") {
          Art.ellipse(ctx, d.x + 4, d.y + 4, d.r, d.r * 0.8, "#4a553c35");
          Art.polygon(
            ctx,
            [
              [d.x - d.r, d.y],
              [d.x - d.r * 0.4, d.y - d.r],
              [d.x + d.r * 0.6, d.y - d.r * 0.7],
              [d.x + d.r, d.y + d.r * 0.4],
              [d.x - d.r * 0.4, d.y + d.r * 0.7],
            ],
            "#9c9f83",
            "#7f896a",
          );
          Art.line(
            ctx,
            [
              [d.x - d.r * 0.4, d.y - d.r],
              [d.x, d.y],
              [d.x + d.r * 0.6, d.y - d.r * 0.7],
            ],
            1,
            "#babe9a",
          );
        } else
          Art.tree(ctx, d.x, d.y, d.scale, LEVELS[state.level].terrain >= 3);
      }
    for (const n of state.nodes)
      if (n.remaining > 0 && onScreen(n)) Art.resource(ctx, n, time);
    if (settings.gore) {
      for (const m of state.marks)
        if (onScreen(m)) {
          ctx.globalAlpha = 0.7;
          const grow = 0.4 + Math.min(1, m.t) * 0.6;
          Art.ellipse(ctx, m.x, m.y, m.r * grow, m.r * 0.7 * grow, "#68151c");
          ctx.globalAlpha = 1;
        }
      for (const c of state.corpses)
        if (onScreen(c)) {
          ctx.save();
          ctx.translate(c.x, c.y);
          if (c.shattered && !["trebuchet", "pilgrim"].includes(c.type)) {
            for (let i = 0; i < 4; i++) {
              const a = c.angle + i * 1.7;
              Art.ellipse(
                ctx,
                Math.cos(a) * 18,
                Math.sin(a) * 18,
                4,
                2,
                i % 2 ? "#79202b" : "#aaa999",
              );
              Art.line(
                ctx,
                [
                  [Math.cos(a) * 18, Math.sin(a) * 18],
                  [Math.cos(a) * 23, Math.sin(a) * 23],
                ],
                2,
                "#a41925",
              );
            }
          }
          if (["trebuchet", "pilgrim", "merchant"].includes(c.type)) {
            ctx.rotate(c.angle + 0.2);
            Art.rect(
              ctx,
              -15,
              -16,
              30,
              34,
              c.type === "pilgrim" ? "#b49b73" : "#866d47",
              "#5b4b32",
            );
            Art.line(
              ctx,
              [
                [-17, -13],
                [9, 20],
              ],
              4,
              "#bda06a",
            );
            Art.line(
              ctx,
              [
                [11, -20],
                [-4, 21],
              ],
              3,
              "#755936",
            );
            for (const [x, y] of [
              [-20, -15],
              [19, 12],
              [-18, 19],
            ])
              Art.ellipse(ctx, x, y, 4, 6, "#5e4c33");
            if (c.type === "pilgrim") Art.cross(ctx, 0, 0, 7, "#8f4637");
          } else if (c.t < 0.3) {
            ctx.rotate(c.t * 4);
            drawUnit(
              ctx,
              {
                ...c,
                moving: false,
                anim: 0,
                strike: 0,
                carry: 0,
                deployment: "packed",
              },
              time,
            );
          } else {
            ctx.rotate(c.angle + 0.4);
            Art.ellipse(
              ctx,
              0,
              0,
              14,
              6,
              c.type === "worker"
                ? "#b6a07a"
                : c.team === 1
                  ? "#516c52"
                  : "#a65c40",
            );
            Art.ellipse(ctx, -12, 0, 5, 4, "#a4ac94");
            Art.line(
              ctx,
              [
                [7, 0],
                [17, 4],
              ],
              3,
              "#695840",
            );
            Art.line(
              ctx,
              [
                [7, 0],
                [15, -5],
              ],
              3,
              "#695840",
            );
            Art.line(
              ctx,
              [
                [1, 3],
                [8, 13],
              ],
              1.5,
              "#d1d3b8",
            );
          }
          ctx.restore();
        }
    }
    const knownBuildings = state.buildings
      .map((b) => (b.team === 0 || playerSees(b) ? b : fog.known[b.id]))
      .filter(Boolean);
    for (const b of knownBuildings)
      if (onScreen(b)) {
        Art.structure(ctx, b, time);
        if (selectedBuilding === b.id && b.rally) {
          Art.banner(ctx, b.rally.x, b.rally.y, 0, time);
          ctx.save();
          ctx.setLineDash([6, 8]);
          ctx.strokeStyle = "#edc57888";
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.rally.x, b.rally.y);
          ctx.stroke();
          ctx.restore();
        }
        if (selectedBuilding === b.id) {
          ctx.strokeStyle = "#eed5a0";
          ctx.lineWidth = 2;
          ctx.strokeRect(
            b.x - b.w / 2 - 6,
            b.y - b.h / 2 - 6,
            b.w + 12,
            b.h + 12,
          );
        }
        if (
          b.hp > 0 &&
          (b.hp < b.maxHp || selectedBuilding === b.id || b.team === 1)
        )
          healthBar(
            ctx,
            b.x,
            b.y + b.h / 2 + 10,
            b.hp / b.maxHp,
            Math.min(90, b.w),
            b.team,
          );
        if (b.progress < 1 && b.hp > 0) {
          healthBar(ctx, b.x, b.y - b.h / 2 - 12, b.progress, 70, 0);
        }
      }
    for (const u of state.units.filter(
      (u) => u.team === 0 && u.type === "trebuchet" && selected.has(u.id),
    )) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(u.x, u.y, 690, 0, Math.PI * 2);
      ctx.arc(u.x, u.y, 180, 0, Math.PI * 2, true);
      ctx.fillStyle = "#d0b25d10";
      ctx.fill();
      ctx.setLineDash([10, 8]);
      for (const range of [180, 690]) {
        ctx.beginPath();
        ctx.arc(u.x, u.y, range, 0, Math.PI * 2);
        ctx.strokeStyle = range === 180 ? "#d16a5288" : "#f1cd82aa";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = "12px Georgia";
      ctx.fillStyle = "#f5d497";
      ctx.fillText("Siege range 180-690", u.x + 190, u.y);
      if (u.fireTarget) {
        Art.line(
          ctx,
          [
            [u.fireTarget.x - 12, u.fireTarget.y],
            [u.fireTarget.x + 12, u.fireTarget.y],
          ],
          2,
          "#f2aa4e",
        );
        Art.line(
          ctx,
          [
            [u.fireTarget.x, u.fireTarget.y - 12],
            [u.fireTarget.x, u.fireTarget.y + 12],
          ],
          2,
          "#f2aa4e",
        );
      }
      ctx.restore();
    }
    for (const s of state.sites)
      if (onScreen(s)) {
        ctx.strokeStyle = s.captured ? "#e1c47b88" : "#b4976270";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        Art.banner(
          ctx,
          s.x - 15,
          s.y - 45,
          s.team ?? (s.captured ? 0 : 2),
          time,
        );
        if (s.team === 2 || s.claimProgress > 0)
          healthBar(ctx, s.x, s.y + s.r + 10, s.claimProgress || 0, 70);
      }
    const visible = state.units
      .filter(
        (u) => u.hp > 0 && onScreen(u, 45) && (u.team === 0 || playerSees(u)),
      )
      .sort((a, b) => a.y - b.y);
    for (const u of visible) {
      Art.ellipse(
        ctx,
        u.x + 3,
        u.y + 4,
        u.type === "knight"
          ? 16
          : u.type === "trebuchet"
            ? 26
            : u.type === "pilgrim" || u.type === "merchant"
              ? 24
              : 12,
        u.type === "knight" ? 22 : 12,
        "#31402930",
      );
      if (selected.has(u.id)) {
        ctx.strokeStyle = "#ede1ae";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(
          u.x,
          u.y,
          u.type === "trebuchet" ? 24 : u.type === "knight" ? 18 : 12,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      if (u.blessed > 0) {
        ctx.strokeStyle = "#ebcb78aa";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(u.x, u.y, 22, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(u.x, u.y);
      drawUnit(ctx, u, time, u.visualAngle ?? u.angle);
      ctx.restore();
      if (selected.has(u.id) || u.hp < u.maxHp)
        healthBar(
          ctx,
          u.x,
          u.y - 32,
          u.hp / u.maxHp,
          u.type === "trebuchet" ? 40 : 28,
          u.team,
        );
      if (
        u.type === "trebuchet" &&
        (u.deployment === "setting-up" || u.deployment === "packing")
      )
        healthBar(
          ctx,
          u.x,
          u.y + 35,
          1 - u.deployTimer / (u.deployment === "setting-up" ? 6 : 4),
          42,
        );
      if (u.type === "pilgrim" || u.type === "merchant") {
        ctx.fillStyle = "#433d28";
        ctx.font = "8px Georgia";
        ctx.textAlign = "center";
        ctx.fillText(
          u.escortWaiting ? "AWAITING ESCORT" : "ON THE ROAD",
          u.x,
          u.y + 42,
        );
      }
    }
    for (const a of state.arrows)
      if (onScreen(a)) {
        const angle = Math.atan2(a.ty - a.y, a.tx - a.x),
          total = Math.hypot(a.tx - (a.sx ?? a.x), a.ty - (a.sy ?? a.y)),
          progress = total
            ? clamp(1 - Math.hypot(a.tx - a.x, a.ty - a.y) / total, 0, 1)
            : 0,
          arc = Math.sin(progress * Math.PI) * Math.min(65, total * 0.22);
        // Projectiles travel above walls; ground navigation only governs troops.
        Art.line(
          ctx,
          [
            [a.x - Math.cos(angle) * 12, a.y - arc - Math.sin(angle) * 12],
            [a.x, a.y - arc],
          ],
          1.5,
          "#594a30",
        );
      }
    for (const b of state.boulders) {
      const t = b.t / b.duration,
        x = b.sx + (b.tx - b.sx) * t,
        y = b.sy + (b.ty - b.sy) * t;
      ctx.strokeStyle = "#b99a6477";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.tx, b.ty, b.r, 0, Math.PI * 2);
      ctx.stroke();
      Art.ellipse(ctx, x, y, 7, 6, "#44513955");
      const height = Math.sin(t * Math.PI) * 150,
        fy = y - height;
      const glow = ctx.createRadialGradient(x, fy, 1, x, fy, 21);
      glow.addColorStop(0, "#fff3b3aa");
      glow.addColorStop(1, "#ef642900");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 21, fy - 21, 42, 42);
      Art.ellipse(ctx, x, fy, 8, 8, "#c8451c");
      Art.ellipse(ctx, x - 1, fy - 1, 6, 6, "#f5a23b");
      Art.ellipse(ctx, x - 2, fy - 2, 3, 3, "#ffe6a0");
    }
    for (const u of state.units)
      if (
        u.moving &&
        onScreen(u, 30) &&
        (u.team === 0 || playerSees(u)) &&
        (biome === 0 || biome === 1)
      ) {
        for (let i = 0; i < 7; i++) {
          const a = i * 2.399 + u.id,
            r = 7 + (i % 3) * 3,
            x = u.x + Math.cos(a) * r,
            y = u.y + Math.sin(a) * r;
          const bend = Math.sin(time * 6 + i) * 2 + Math.cos(u.angle) * 4;
          ctx.strokeStyle = i % 2 ? "#abc77999" : "#3f632a99";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + bend, y - 3, x + bend * 1.5, y - 6);
          ctx.stroke();
        }
      }
    for (const p of state.particles)
      if (onScreen(p, 20)) {
        ctx.globalAlpha = 1 - p.t / p.life;
        Art.ellipse(ctx, p.x, p.y, p.r, p.r, p.color);
      }
    ctx.globalAlpha = 1;
    for (const ring of state.rings)
      if (onScreen(ring)) {
        ctx.globalAlpha = 1 - ring.t;
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r * (0.5 + ring.t), 0, Math.PI * 2);
        ctx.stroke();
      }
    ctx.globalAlpha = 1;
    if (!state.cheats?.reveal || !DEBUG_MODE) fog.paint(ctx, W, H);
    if (drag && distance(drag.start, drag.end) > 4) {
      ctx.fillStyle = "#eed7a122";
      ctx.strokeStyle = "#efdaa7";
      ctx.lineWidth = 1.5;
      ctx.fillRect(
        drag.start.x,
        drag.start.y,
        drag.end.x - drag.start.x,
        drag.end.y - drag.start.y,
      );
      ctx.strokeRect(
        drag.start.x,
        drag.start.y,
        drag.end.x - drag.start.x,
        drag.end.y - drag.start.y,
      );
    }
    const wallPreview =
      wallDrag ||
      (wallAnchor && placement === "wall"
        ? { start: wallAnchor, end: mouse }
        : null);
    if (wallPreview) {
      for (const p of wallLine(wallPreview.start, wallPreview.end)) {
        if (
          state.buildings.some(
            (b) =>
              b.team === 0 &&
              b.kind === "wall" &&
              b.hp > 0 &&
              distance(b, p) < 12,
          )
        )
          continue;
        const valid = validSite("wall", p);
        ctx.fillStyle = valid ? "#dac39299" : "#b3333388";
        ctx.fillRect(p.x - 16, p.y - 16, 32, 32);
        ctx.strokeStyle = valid ? "#fff1bd" : "#ff786b";
        ctx.strokeRect(p.x - 16, p.y - 16, 32, 32);
      }
      const count = wallLine(wallPreview.start, wallPreview.end).filter((p) =>
        validSite("wall", p),
      ).length;
      ctx.font = "bold 14px Georgia";
      ctx.fillStyle = "#fff1c9";
      ctx.fillText(
        `${count} sections / ${count * 12} stone / ${count * 3} wood`,
        wallPreview.end.x + 24,
        wallPreview.end.y - 24,
      );
    }
    if (placement && !wallPreview) {
      const spec = placementSpec(placement),
        valid = validSite(placement, mouse);
      ctx.save();
      ctx.globalAlpha = 0.6;
      Art.structure(
        ctx,
        {
          kind: placement,
          rotation: placementRotation,
          team: 0,
          x: mouse.x,
          y: mouse.y,
          w: spec.w,
          h: spec.h,
          hp: spec.hp,
          maxHp: spec.hp,
          progress: 1,
        },
        time,
      );
      ctx.fillStyle = valid ? "#a4cc6422" : "#d63a3555";
      ctx.fillRect(mouse.x - spec.w / 2, mouse.y - spec.h / 2, spec.w, spec.h);
      ctx.strokeStyle = valid ? "#d8e5a2" : "#ae3229";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        mouse.x - spec.w / 2 - 5,
        mouse.y - spec.h / 2 - 5,
        spec.w + 10,
        spec.h + 10,
      );
      ctx.restore();
    }
    canvas.style.cursor =
      mode === "build" || mode === "attack" ? "crosshair" : "default";
    drawMinimap();
  }
  function drawMinimap() {
    mc.drawImage(terrain, 0, 0, mini.width, mini.height);
    const sx = mini.width / W,
      sy = mini.height / H;
    for (const n of state.nodes)
      if (n.remaining > 0) {
        mc.fillStyle = {
          wood: "#566d35",
          food: "#c9ae61",
          gold: "#edd070",
          stone: "#a1a391",
        }[n.kind];
        mc.fillRect(n.x * sx - 1, n.y * sy - 1, 2, 2);
      }
    for (const b of state.buildings
      .map((b) => (b.team === 0 || playerSees(b) ? b : fog.known[b.id]))
      .filter(Boolean))
      if (b.hp > 0) {
        mc.fillStyle =
          b.team === 1 ? "#843d2d" : b.team === 2 ? "#9a8c67" : "#eadbb0";
        mc.fillRect(
          b.x * sx - (b.w * sx) / 2,
          b.y * sy - (b.h * sy) / 2,
          Math.max(3, b.w * sx),
          Math.max(3, b.h * sy),
        );
      }
    for (const u of state.units) {
      if (u.team !== 0 && !playerSees(u)) continue;
      mc.fillStyle =
        u.team === 1
          ? "#ac3b29"
          : u.team === 2
            ? "#c8b581"
            : selected.has(u.id)
              ? "#fffbe5"
              : u.type === "worker"
                ? "#85b47b"
                : "#e8d79c";
      mc.fillRect(u.x * sx - 1, u.y * sy - 1, 2, 2);
    }
    if (!state.cheats?.reveal || !DEBUG_MODE)
      fog.paint(mc, mini.width, mini.height);
    mc.strokeStyle = "#fbefc6";
    mc.lineWidth = 1.2;
    mc.strokeRect(view.x * sx, view.y * sy, view.w * sx, view.h * sy);
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerenter", () => (pointerOnMap = true));
  canvas.addEventListener("pointerleave", () => (pointerOnMap = false));
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 0.1 : -0.1, e);
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (e) => {
    if (!playable()) return;
    mouse = point(e);
    canvas.focus();
    if (e.button === 1) {
      e.preventDefault();
      middleDrag = { x: e.clientX, y: e.clientY, button: 1 };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2) {
      if (mode === "build") cancel();
      else if (!selected.size && !selectedBuilding && !selectedBuildings.size) {
        e.preventDefault();
        middleDrag = { x: e.clientX, y: e.clientY, button: 2 };
        canvas.setPointerCapture(e.pointerId);
      } else issueOrder(mouse.x, mouse.y, mode === "attack", e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (mode === "build") {
      if (placement === "wall") {
        wallDrag = { start: wallAnchor || mouse, end: mouse };
        canvas.setPointerCapture(e.pointerId);
      } else placeBuild(mouse, e.shiftKey);
      return;
    }
    if (mode === "attack") {
      issueOrder(mouse.x, mouse.y, true);
      return;
    }
    if (
      e.pointerType === "touch" &&
      selected.size &&
      !friendUnits().some((u) => distance(u, mouse) < 26)
    ) {
      issueOrder(mouse.x, mouse.y);
      return;
    }
    drag = { start: mouse, end: mouse, shift: e.shiftKey, buildings: e.altKey };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    mouse = point(e);
    if (middleDrag) {
      pan(
        (middleDrag.x - e.clientX) / view.scale,
        (middleDrag.y - e.clientY) / view.scale,
      );
      middleDrag = { ...middleDrag, x: e.clientX, y: e.clientY };
    }
    if (drag) drag.end = mouse;
    if (wallDrag) wallDrag.end = mouse;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (wallDrag && e.button === 0) {
      placeWallLine(wallDrag.start, wallDrag.end, e.shiftKey);
      return;
    }
    if (middleDrag && e.button === middleDrag.button) {
      middleDrag = null;
      return;
    }
    if (!drag || e.button !== 0) return;
    const d = drag;
    drag = null;
    const clickedNode =
      distance(d.start, d.end) < 8 && playerRemembers(d.end)
        ? resourceAt(d.end)
        : null;
    selectedNode = clickedNode?.id || null;
    if (!d.shift && !clickedNode) {
      selected.clear();
      selectedBuilding = null;
      selectedBuildings.clear();
    }
    if (distance(d.start, d.end) < 8) {
      const u = friendUnits()
        .filter((u) => distance(u, d.end) < 27)
        .sort((a, b) => distance(a, d.end) - distance(b, d.end))[0];
      if (u) {
        if (d.shift && selected.has(u.id)) selected.delete(u.id);
        else selected.add(u.id);
        if (u.type === "worker") setTab("settlement");
      } else {
        const b = state.buildings.find(
          (b) =>
            b.hp > 0 &&
            (b.team === 0 || playerSees(b)) &&
            Math.abs(b.x - d.end.x) < b.w / 2 &&
            Math.abs(b.y - d.end.y) < b.h / 2,
        );
        if (!b && playerRemembers(d.end))
          selectedNode = resourceAt(d.end)?.id || null;
        if (b) {
          selectedBuilding = b.id;
          if (d.shift && selectedBuildings.has(b.id))
            selectedBuildings.delete(b.id);
          else selectedBuildings.add(b.id);
          selected.clear();
          if (
            [
              "towncenter",
              "barracks",
              "stable",
              "chapel",
              "siegeworkshop",
            ].includes(b.kind)
          )
            setTab("army");
        }
      }
    } else {
      const x = Math.min(d.start.x, d.end.x),
        right = Math.max(d.start.x, d.end.x),
        y = Math.min(d.start.y, d.end.y),
        bottom = Math.max(d.start.y, d.end.y);
      const inside = (o) =>
        o.x >= x && o.x <= right && o.y >= y && o.y <= bottom;
      const troops = friendUnits().filter(inside);
      if (troops.length && !d.buildings)
        troops.forEach((u) => selected.add(u.id));
      else {
        selected.clear();
        state.buildings
          .filter((b) => b.team === 0 && b.hp > 0 && inside(b))
          .forEach((b) => selectedBuildings.add(b.id));
        selectedBuilding = [...selectedBuildings][0] || null;
        if (selectedBuilding) setTab("army");
      }
    }
    sound("select");
    updateUI();
  });
  canvas.addEventListener("pointercancel", () => {
    drag = null;
    wallDrag = null;
    middleDrag = null;
  });
  function panMinimap(e) {
    const r = mini.getBoundingClientRect();
    camera.x = clamp((e.clientX - r.left) / r.width, 0, 1) * W;
    camera.y = clamp((e.clientY - r.top) / r.height, 0, 1) * H;
    updateView();
  }
  mini.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    minimapDrag = e.pointerId;
    mini.setPointerCapture(e.pointerId);
    panMinimap(e);
  });
  mini.addEventListener("pointermove", (e) => {
    if (minimapDrag === e.pointerId) panMinimap(e);
  });
  const endMinimap = (e) => {
    if (minimapDrag === e.pointerId) minimapDrag = null;
  };
  mini.addEventListener("pointerup", endMinimap);
  mini.addEventListener("pointercancel", endMinimap);
  mini.addEventListener("lostpointercapture", endMinimap);
  mini.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const r = mini.getBoundingClientRect();
    issueOrder(
      ((e.clientX - r.left) / r.width) * W,
      ((e.clientY - r.top) / r.height) * H,
      mode === "attack",
    );
  });
  $("rotate-placement").addEventListener("click", rotatePlacement);
  window.addEventListener("keydown", (e) => {
    if (
      document.querySelector("dialog[open]") ||
      ($("front-menu") && !$("front-menu").hidden) ||
      /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)
    )
      return;
    if (
      e.code.startsWith("Arrow") ||
      ["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)
    ) {
      e.preventDefault();
      panKeys.add(e.code);
      return;
    }
    if (
      [
        "Space",
        "Escape",
        "KeyF",
        "KeyH",
        "KeyB",
        "KeyT",
        "KeyE",
        "KeyV",
        "KeyQ",
        "KeyX",
        "KeyG",
        "KeyR",
        "Digit1",
        "Digit2",
        "Digit3",
        "Digit4",
        "Digit5",
        "Digit6",
        "Digit7",
        "Digit8",
        "Digit9",
      ].includes(e.code)
    )
      e.preventDefault();
    if (e.code === "Escape") {
      if (mode !== "move") cancel();
      else togglePause();
      return;
    }
    if (!playable()) return;
    const actions = {
      Space: selectArmy,
      KeyF: setAttack,
      KeyH: hold,
      KeyG: autoScout,
      KeyR: rotatePlacement,
      KeyB: bless,
      KeyT: toggleDeployment,
      KeyE: selectWorkers,
      KeyV: idleWorker,
      KeyQ: home,
      KeyX: cancel,
    };
    actions[e.code]?.();
    const keys = [
      "sword",
      "archer",
      "knight",
      "chaplain",
      "worker",
      "standard",
      "trebuchet",
    ];
    if (/^Digit[1-9]$/.test(e.code)) {
      const group = e.code.slice(-1);
      if (e.ctrlKey || e.metaKey) {
        state.controlGroups[group] = [...selected];
        toast(`Company ${group} assigned (${selected.size} troops).`);
      } else if (e.shiftKey && Number(group) <= 7) {
        recruit(keys[Number(group) - 1]);
      } else {
        const living = new Set(
          state.units.filter((u) => u.team === 0 && u.hp > 0).map((u) => u.id),
        );
        selected = new Set(
          (state.controlGroups[group] || []).filter((id) => living.has(id)),
        );
        selectedBuilding = null;
        if (!selected.size)
          toast(
            `Company ${group} is empty. Select troops and press Ctrl+${group}.`,
          );
        updateUI();
      }
    }
  });
  window.addEventListener("keyup", (e) => panKeys.delete(e.code));
  window.addEventListener("blur", () => panKeys.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playable()) {
      saveGame();
      togglePause();
    }
  });
  window.addEventListener("pagehide", () => {
    if (state && !TEST) saveGame();
  });
  for (const [id, fn] of [
    ["select-all", selectArmy],
    ["workers-button", selectWorkers],
    ["idle-button", idleWorker],
    [
      "town-button",
      () => {
        home();
        selected.clear();
        selectedBuilding = state.buildings[0].id;
        updateUI();
      },
    ],
    ["home-view", home],
    ["attack-button", setAttack],
    ["hold-button", hold],
    ["scout-button", autoScout],
    ["bless-button", bless],
    ["deploy-button", toggleDeployment],
    ["cancel-button", cancel],
    ["pause-button", togglePause],
    ["save-button", () => saveGame(true)],
    ["restart-button", () => startLevel(state.level)],
  ])
    $(id).addEventListener("click", fn);
  for (const [id, dx, dy] of [
    ["pan-left", -220, 0],
    ["pan-right", 220, 0],
    ["pan-up", 0, -180],
    ["pan-down", 0, 180],
  ])
    $(id).addEventListener("click", () => pan(dx, dy));
  $("zoom-in").addEventListener("click", () => zoom(0.15));
  $("zoom-out").addEventListener("click", () => zoom(-0.15));
  for (const name of ["army", "settlement", "research"])
    $(name + "-tab").addEventListener("click", () => setTab(name));
  for (const name of ["help", "settings"]) {
    $(name + "-button").addEventListener("click", () => {
      wasPaused = state.paused;
      modalState = state;
      state.paused = true;
      $(name + "-dialog").showModal();
    });
    $(name + "-dialog")
      .querySelector(".close-dialog")
      .addEventListener("click", () => $(name + "-dialog").close());
    $(name + "-dialog").addEventListener("close", () => {
      if (state === modalState) state.paused = wasPaused;
      updateUI();
    });
  }
  window.CruciataAudio.setEnabled(settings.sound);
  window.CruciataAudio.setVolumes(settings.effectsVolume, settings.musicVolume);
  for (const name of ["music", "effects"]) {
    const input = $(name + "-volume"),
      output = $(name + "-volume-label");
    input.value = Math.round(settings[name + "Volume"] * 100);
    output.value = input.value + "%";
    input.addEventListener("input", () => {
      settings[name + "Volume"] = Number(input.value) / 100;
      output.value = input.value + "%";
      window.CruciataAudio.setVolumes(
        settings.effectsVolume,
        settings.musicVolume,
      );
      persistPrefs();
    });
  }
  $("skip-track").addEventListener("click", () =>
    window.CruciataAudio.nextTrack(),
  );
  $("sound-toggle").checked = settings.sound;
  $("gore-toggle").checked = settings.gore;
  $("sound-toggle").addEventListener("change", (e) => {
    settings.sound = e.target.checked;
    window.CruciataAudio.setEnabled(settings.sound);
    persistPrefs();
  });
  $("gore-toggle").addEventListener("change", (e) => {
    settings.gore = e.target.checked;
    if (!settings.gore) {
      state.corpses = [];
      state.marks = [];
      state.particles = state.particles.filter((p) => !p.blood);
    }
    persistPrefs();
  });
  $("reset-progress").addEventListener("click", () => {
    unlocked = 0;
    completed.clear();
    persistPrefs();
    try {
      localStorage.removeItem(CHECKPOINT);
      localStorage.removeItem("cruciata-checkpoint-v2");
    } catch {}
    $("settings-dialog").close();
    startLevel(0);
  });
  function frame(now) {
    const dt = Math.min(0.12, (now - lastTime) / 1000 || 0);
    lastTime = now;
    if ($("front-menu") && !$("front-menu").hidden) {
      accumulator = 0;
      requestAnimationFrame(frame);
      return;
    }
    if (playable()) {
      const speed = (450 * dt) / camera.zoom;
      for (const [key, dx, dy] of [
        ["KeyA", -speed, 0],
        ["KeyD", speed, 0],
        ["KeyW", 0, -speed],
        ["KeyS", 0, speed],
        ["ArrowLeft", -speed, 0],
        ["ArrowRight", speed, 0],
        ["ArrowUp", 0, -speed],
        ["ArrowDown", 0, speed],
      ])
        if (panKeys.has(key)) pan(dx, dy);
    }
    accumulator += dt;
    while (accumulator >= STEP) {
      if (!TEST) update(STEP * (DEBUG_MODE ? state.cheats?.speed || 1 : 1));
      accumulator -= STEP;
    }
    uiClock += dt;
    if (uiClock > 0.2) {
      uiClock = 0;
      updateUI();
    }
    render();
    requestAnimationFrame(frame);
  }
  initActions();
  startLevel(0, false);
  sessionActive = false;
  state.paused = true;
  requestAnimationFrame(frame);
  function cheat(action) {
    if (!DEBUG_MODE || !sessionActive || state.result) return;
    state.cheats ||= {};
    if (action === "resources") {
      for (const r of Object.keys(state.resources)) state.resources[r] += 10000;
      state.faith = 250;
    }
    if (action === "heal")
      for (const o of [...state.units, ...state.buildings])
        if (o.team === 0 && o.hp > 0) o.hp = o.maxHp;
    if (action === "invulnerable")
      state.cheats.invulnerable = !state.cheats.invulnerable;
    if (action === "instant") state.cheats.instant = !state.cheats.instant;
    if (action === "speed")
      state.cheats.speed = state.cheats.speed === 4 ? 1 : 4;
    if (action === "reveal") state.cheats.reveal = !state.cheats.reveal;
    if (action === "army") {
      const base = state.buildings.find(
        (b) => b.team === 0 && b.kind === "towncenter",
      );
      for (let i = 0; i < 48; i++) {
        const p = findFree({
          x: base.x + 260 + (i % 8) * 28,
          y: base.y + 210 + Math.floor(i / 8) * 28,
        });
        const u = makeUnit(
          ["sword", "archer", "knight", "standard", "chaplain", "trebuchet"][
            i % 6
          ],
          0,
          p.x,
          p.y,
        );
        applyRank(u, rankFor(u.type));
        state.units.push(u);
      }
    }
    if (action === "peace") {
      for (const u of state.units)
        if (u.team === 1 && TYPES[u.type].damage > 0) u.hp = 0;
      state.arrows = [];
      state.boulders = [];
    }
    if (action === "victory") {
      $("debug-menu")?.close();
      finish(true);
    }
    updateUI();
    toast("Debug: " + action);
    document.querySelectorAll("[data-cheat]").forEach((b) => {
      const flag = b.dataset.cheat;
      b.classList.toggle(
        "active",
        flag === "speed" ? state.cheats.speed === 4 : !!state.cheats[flag],
      );
    });
  }
  if (DEBUG_MODE) {
    const button = document.createElement("button");
    button.id = "debug-button";
    button.textContent = "Debug";
    button.title = "Playtesting cheats (F2)";
    document.querySelector(".header-actions").prepend(button);
    const panel = document.createElement("dialog");
    panel.id = "debug-menu";
    panel.innerHTML = `<div class="eyebrow">PLAYTESTING / DEBUG MODE</div><h2>Command the battlefield</h2><p>Cheats affect this session. Toggle buttons stay active until switched off.</p><div class="debug-actions">${[
      ["resources", "Grant 10,000 of every resource"],
      ["army", "Raise 48 troops"],
      ["heal", "Heal all your people & structures"],
      ["invulnerable", "Toggle invulnerability"],
      ["instant", "Toggle instant building & training"],
      ["reveal", "Toggle map reveal"],
      ["speed", "Toggle 4x simulation speed"],
      ["peace", "Remove enemy combat troops"],
      ["victory", "Win this battle"],
    ]
      .map(([id, label]) => `<button data-cheat="${id}">${label}</button>`)
      .join("")}</div><button id="debug-close">Return to battle</button>`;
    document.body.append(panel);
    let pausedBeforeDebug = false;
    button.onclick = () => {
      if (sessionActive) {
        pausedBeforeDebug = state.paused;
        state.paused = true;
        panKeys.clear();
        panel.querySelectorAll("[data-cheat]").forEach((b) => {
          const flag = b.dataset.cheat;
          b.classList.toggle(
            "active",
            flag === "speed"
              ? state.cheats?.speed === 4
              : !!state.cheats?.[flag],
          );
        });
        panel.showModal();
      } else toast("Start a battle to use cheats.");
    };
    panel.addEventListener("close", () => {
      if (!state.result) state.paused = pausedBeforeDebug;
      updateUI();
    });
    panel
      .querySelectorAll("[data-cheat]")
      .forEach((b) => (b.onclick = () => cheat(b.dataset.cheat)));
    panel.querySelector("#debug-close").onclick = () => panel.close();
    document.addEventListener("keydown", (e) => {
      if (e.code === "F2") {
        e.preventDefault();
        panel.open ? panel.close() : button.click();
      }
    });
  }
  window.cruciata = {
    debugMode: DEBUG_MODE,
    cheat,
    campaign: () => ({
      unlocked,
      completed: [...completed],
      nextLevel: Math.min(5, Math.max(-1, ...completed) + 1),
      activeLevel:
        sessionActive && state.mode !== "quickmatch" && !state.result
          ? state.level
          : null,
      lastVictory:
        state.mode !== "quickmatch" && state.result === "victory"
          ? { level: state.level, text: LEVELS[state.level].win }
          : null,
      levels: LEVELS.map((l) => ({ name: l.name, sub: l.sub, story: l.story })),
    }),
    launch: (level, config = null, slot = null) => {
      quickConfig = config;
      quickSlot = slot;
      startLevel(level, true);
    },
    resume: (slot) => restoreGame(slot),
    menu: () => {
      if (!state.result && state.time > 0) saveGame();
      state.paused = true;
      panKeys.clear();
    },
    clearPatch: () => {
      const n = getObject(selectedNode);
      const pool = workers().filter((u) => selected.has(u.id));
      const chosen = pool.length
        ? pool
        : workers()
            .filter((u) => !u.job && !u.order)
            .sort((a, b) => distance(a, n) - distance(b, n))
            .slice(0, 3);
      if (!n || !chosen.length) {
        toast("Select villagers or free an idle villager to clear this patch.");
        return;
      }
      for (const u of chosen) {
        u.job = { kind: "clear", target: n.id, resource: n.kind };
        u.order = null;
      }
      toast(
        "Villagers assigned to clear this patch; no resources are recovered.",
      );
    },
    gate: () => {
      const b = getObject(selectedBuilding);
      if (b?.kind === "gate") {
        b.closed = !b.closed;
        state.navDirty = true;
        updateUI();
      }
    },
    project: (x, y) => {
      updateView();
      const r = canvas.getBoundingClientRect();
      return {
        x: r.left + (x - view.x) * view.scale,
        y: r.top + (y - view.y) * view.scale,
      };
    },
    snapshot: () =>
      JSON.parse(
        JSON.stringify({
          ...state,
          gold: state.resources.gold,
          food: state.resources.food,
          wood: state.resources.wood,
          stone: state.resources.stone,
          selected: [...selected],
          selectedBuilding,
          selectedBuildings: [...selectedBuildings],
          unlocked,
          completed: [...completed],
          camera,
          view,
          world: { width: W, height: H },
          population: population(),
          navigation: { revision: nav.revision, searches: nav.searches },
          objective: objectiveState(),
        }),
      ),
    step: (seconds) => {
      if (TEST)
        for (let i = 0; i < Math.ceil(seconds / STEP); i++) update(STEP);
      updateUI();
    },
    start: (level) => {
      if (TEST && LEVELS[level]) startLevel(level, false);
    },
    supply: (amount) => {
      if (TEST) {
        if (typeof amount === "number")
          state.resources.gold += clamp(amount, 0, 10000);
        else
          for (const [r, n] of Object.entries(amount || {}))
            if (r in state.resources) state.resources[r] += clamp(n, 0, 10000);
      }
      updateUI();
    },
    camera: (x, y) => {
      if (TEST) {
        camera.x = x;
        camera.y = y;
        updateView();
      }
    },
    scenario: (fn) => {
      if (TEST && typeof fn === "function") {
        fn(state);
        rebuildNavigation();
        rebuildSpatial();
        fog.update(state.units, state.buildings);
        enemyFog.update(state.units, state.buildings);
        updateUI();
      }
    },
    vision: (p) => ({ visible: playerSees(p), explored: playerRemembers(p) }),
    audio: () => window.CruciataAudio.status(),
    site: (kind, p) => (TEST && BUILDINGS[kind] ? validSite(kind, p) : false),
    free: (p) => (TEST ? groundFree(p.x, p.y, 8) : false),
    route: (a, b) => (TEST ? nav.find(a, b) : []),
    save: () => saveGame(true),
  };
})();
