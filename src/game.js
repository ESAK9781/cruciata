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
  const visibleFacing = new WeakSet();
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
  TYPES.ram = {
    name: "Battering ram",
    cost: { wood: 280, gold: 100 },
    hp: 900,
    speed: 38,
    range: 38,
    damage: 95,
    cooldown: 3,
    producer: "siegeworkshop",
    train: 40,
    rank: 0,
  };
  TYPES.ballista = {
    name: "Ballista",
    cost: { wood: 200, gold: 140 },
    hp: 220,
    speed: 48,
    range: 380,
    damage: 42,
    cooldown: 4,
    producer: "siegeworkshop",
    train: 30,
    rank: 2,
  };
  TYPES.merchant = {
    ...TYPES.pilgrim,
    name: "Supply caravan",
    hp: 280,
    speed: 50,
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
      name: "Defense tower",
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
  BUILDINGS.watchtower = {
    name: "Observation tower",
    cost: { wood: 35 },
    w: 38,
    h: 38,
    hp: 320,
    time: 10,
    vision: 1100,
    description:
      "Cheap timber lookout. Reveals distant terrain (1100 range), but cannot attack or train troops.",
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
  BUILDINGS.bastionwall = {
    ...BUILDINGS.wall,
    name: "Bastion wall",
    cost: { stone: 48, wood: 12 },
    hp: 11000,
    time: 16,
  };
  BUILDINGS.bastiongate = {
    ...BUILDINGS.gate,
    name: "Bastion gatehouse",
    cost: { stone: 260, wood: 120 },
    hp: 18000,
    time: 40,
  };
  BUILDINGS.greatengine = {
    name: "Great siege engine",
    cost: { wood: 1200, stone: 650, gold: 500 },
    w: 203,
    h: 175,
    hp: 6000,
    time: 180,
    range: 2200,
    minRange: 320,
    damage: 650,
    description:
      "Massive permanent counterweight engine. Villagers build it on site. Range 320-2200; huge blasts also hit nearby friendly troops.",
  };
  for (const [key, b] of Object.entries(BUILDINGS)) {
    if (!["wall", "gate", "bastionwall"].includes(key)) {
      b.w = Math.round(b.w * 0.8);
      b.h = Math.round(b.h * 0.8);
    }
  }
  BUILDINGS.house.pop = 12;
  BUILDINGS.towncenter.pop = 32;
  BUILDINGS.towncenter.cost = { wood: 500, stone: 350, gold: 200 };
  BUILDINGS.towncenter.time = 100;
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
      desc: "Complete four farms, gather 1,000 food, and wrest the coastal outpost from its defenders.",
      story:
        "The cross standards rise on the Levantine shore. Your Christian host needs more than courage: send villagers to the orchards and forests, build four farms, gather a thousand provisions, and supply the army before securing the neutral coastal outpost with at least three soldiers.",
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
      desc: "Fortify the bridge and escort two caravans across the long contested road to the northeast refuge.",
      story:
        "The Orontes cuts the road in two. Four enemy camps guard the bridge and the long road to the distant refuge. Establish a watchtower near the crossing and escort your three pilgrim caravans; they march only while soldiers are close and the way is safe.",
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
      desc: "Endure sustained attacks for 10 to 15 minutes and complete a chapel. Winter slows food gathering.",
      story:
        "Winter closes around Antioch. Attacks will come from several directions, and the harvest is meagre. Fortify your settlement, keep food stores healthy, and build a chapel to sustain the defenders through a prolonged siege from six surrounding enemy camps.",
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
      desc: "Hold both distant road villages for 3 to 5 minutes and deliver two escorted supply caravans.",
      story:
        "The road south runs through two abandoned villages. Secure both settlements and hold them while two supply caravans cross the contested road. Keep the villagers alive and protect the supply road while the opposing host scouts for a weakness.",
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
      desc: "Destroy all three reinforced gatehouses. Use deployed trebuchets to strike the fortifications.",
      story:
        "Jerusalem rises behind its outer walls. Build a siege workshop, bring timber and stone to the engines, and break all three reinforced gatehouses. Trebuchets must set up before firing; their stones spare neither friend nor foe near the impact.",
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
      desc: "Take the citadel, secure both holy sites, and withstand 4 to 6 minutes of counterattacks.",
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
    militiaFog,
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
    objectIndex = new Map(),
    combatStructures = null,
    combatStructureRadius = 0;
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
    const reach =
      kind.startsWith("great-") || kind === "explosion" ? 3600 : 1000;
    const volume = point ? clamp(1 - distance(point, camera) / reach, 0, 1) : 1;
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
      const copy = {
        ...state,
        groundCover: undefined,
        fog: fog?.save(),
        enemyFog: enemyFog?.save(),
        militiaFog: militiaFog?.save(),
        units: state.units.map((u) => ({
          ...u,
          path: [],
          pathGoal: null,
          pathRequest: null,
          pathTimer: 0,
        })),
      };
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
        520,
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
      stance: "fight",
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
      kind: kind === "bastionwall" ? "wall" : kind,
      fortified: kind === "bastionwall",
      architecture: team === 1 ? "islamic" : undefined,
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
  function landFree(x, y, margin = 0, allowBridge = true) {
    if (
      x < 24 + margin ||
      y < 24 + margin ||
      x > W - 24 - margin ||
      y > H - 24 - margin
    )
      return false;
    const l = LEVELS[state.level];
    if (
      state.mode !== "quickmatch" &&
      l.terrain === 0 &&
      x < coastX(y) + 25 + margin
    )
      return false;
    if (
      (state.config ? state.config.biome === 1 : l.terrain === 1) &&
      Math.abs(x - riverX(y)) < 60 + margin &&
      (!allowBridge || Math.abs(y - bridgeY()) > 56 - margin)
    )
      return false;
    return true;
  }
  function insideContour(x, y, contour) {
    let inside = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const a = contour[i],
        b = contour[j];
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    return inside;
  }
  function fillRockHoles(tiles, valid) {
    let added = 0;
    // Flood from the exterior: enclosed, inaccessible pockets become solid rock.
    const cells = [...tiles.values()];
    if (!cells.length) return 0;
    const x0 = Math.min(...cells.map((p) => p.x)) - 1,
      x1 = Math.max(...cells.map((p) => p.x)) + 1,
      y0 = Math.min(...cells.map((p) => p.y)) - 1,
      y1 = Math.max(...cells.map((p) => p.y)) + 1,
      exterior = new Set(),
      queue = [{ x: x0, y: y0 }];
    exterior.add(x0 + "," + y0);
    for (let i = 0; i < queue.length; i++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = queue[i].x + dx,
          y = queue[i].y + dy,
          key = x + "," + y;
        if (
          x < x0 ||
          x > x1 ||
          y < y0 ||
          y > y1 ||
          tiles.has(key) ||
          exterior.has(key)
        )
          continue;
        exterior.add(key);
        queue.push({ x, y });
      }
    for (let y = y0 + 1; y < y1; y++)
      for (let x = x0 + 1; x < x1; x++)
        if (
          !tiles.has(x + "," + y) &&
          !exterior.has(x + "," + y) &&
          valid(x, y)
        ) {
          tiles.set(x + "," + y, { x, y });
          added++;
        }
    return added;
  }
  function traceRockContours(tiles, cell) {
    const edges = [];
    for (const { x, y } of tiles.values()) {
      const a = { x: x * cell, y: y * cell },
        b = { x: (x + 1) * cell, y: y * cell },
        c = { x: (x + 1) * cell, y: (y + 1) * cell },
        d = { x: x * cell, y: (y + 1) * cell };
      for (const [dx, dy, start, end] of [
        [0, -1, a, b],
        [1, 0, b, c],
        [0, 1, c, d],
        [-1, 0, d, a],
      ])
        if (!tiles.has(x + dx + "," + (y + dy)))
          edges.push({ start, end, used: false });
    }
    const starts = new Map();
    for (const edge of edges) {
      const key = edge.start.x + "," + edge.start.y;
      if (!starts.has(key)) starts.set(key, []);
      starts.get(key).push(edge);
    }
    const contours = [];
    for (const edge of edges) {
      if (edge.used) continue;
      const contour = [],
        first = edge.start;
      let next = edge;
      while (next && !next.used) {
        next.used = true;
        contour.push(next.start);
        const end = next.end;
        if (end.x === first.x && end.y === first.y) break;
        next = (starts.get(end.x + "," + end.y) || []).find((e) => !e.used);
      }
      if (contour.length > 3)
        contours.push(
          contour.filter((p, i) => {
            const a = contour[(i + contour.length - 1) % contour.length],
              b = contour[(i + 1) % contour.length];
            return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x);
          }),
        );
    }
    return contours;
  }
  function makeRockClusters(random) {
    const cell = 64,
      count = Math.min(24, Math.ceil((W * H) / 10000000));
    state.terrainFeatures = [];
    for (let cluster = 0; cluster < count; cluster++) {
      const flank = cluster === 0 ? state.cities?.[0] : null;
      const cx = Math.floor(
          (flank ? flank.x - 600 : 550 + random() * (W - 1100)) / cell,
        ),
        cy = Math.floor(
          (flank ? flank.y - 384 : 450 + random() * (H - 900)) / cell,
        ),
        tiles = new Map();
      const valid = (x, y) => {
        const px = (x + 0.5) * cell,
          py = (y + 0.5) * cell;
        if (
          state.nodes.some(
            (n) =>
              n.remaining > 0 &&
              Math.abs(n.x - px) < cell / 2 + n.r + 24 &&
              Math.abs(n.y - py) < cell / 2 + n.r + 24,
          )
        )
          return false;
        if (
          state.buildings.some(
            (b) =>
              !(
                flank &&
                b.city === flank.id &&
                b.kind === "wall" &&
                b.y < flank.y - 250
              ) &&
              Math.abs(b.x - px) < b.w / 2 + cell &&
              Math.abs(b.y - py) < b.h / 2 + cell,
          )
        )
          return false;
        for (const dx of [-cell / 2, 0, cell / 2])
          for (const dy of [-cell / 2, 0, cell / 2])
            if (!landFree(px + dx, py + dy, 20, false)) return false;
        return !decorations.some(
          (d) =>
            d.kind === "rockmass" &&
            Math.abs(d.x - px) < d.rx + cell &&
            Math.abs(d.y - py) < d.ry + cell,
        );
      };
      if (!valid(cx, cy)) continue;
      tiles.set(cx + "," + cy, { x: cx, y: cy });
      // A winding spine with uneven shoulders creates long, connected escarpments.
      const heading = flank ? 0 : random() * Math.PI * 2,
        length = flank ? 20 : 24 + Math.floor(random() * 23),
        bend = flank ? 0 : (random() - 0.5) * 1.1,
        width = flank ? 1.7 : 1.5 + random() * 1.7;
      let spineX = cx,
        spineY = cy,
        angle = heading;
      for (let step = 0; step < length; step++) {
        angle +=
          (flank ? 0 : Math.sin(step * 0.27 + cluster) * 0.035) + bend / length;
        const centerX = Math.round(spineX),
          centerY = Math.round(spineY),
          shoulder = width + Math.sin(step * 0.43 + cluster) * 0.9;
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const x = centerX + dx,
              y = centerY + dy;
            if (Math.hypot(dx, dy) <= shoulder && valid(x, y))
              tiles.set(x + "," + y, { x, y });
          }
        spineX += Math.cos(angle);
        spineY += Math.sin(angle);
      }
      fillRockHoles(tiles, valid);
      if (tiles.size < 12) continue;
      const contours = traceRockContours(tiles, cell);
      const points = contours.flat(),
        minX = Math.min(...points.map((p) => p.x)),
        maxX = Math.max(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y)),
        maxY = Math.max(...points.map((p) => p.y));
      const mass = {
        kind: "rockmass",
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        rx: (maxX - minX) / 2 + 24,
        ry: (maxY - minY) / 2 + 24,
        r: 0,
        block: true,
        contours,
        cell,
        tiles: [...tiles.values()],
        biome:
          state.config?.biome ??
          (LEVELS[state.level].terrain === 2
            ? 3
            : LEVELS[state.level].terrain >= 3
              ? 2
              : 0),
        seed: state.seed + cluster * 91,
      };
      decorations.push(mass);
      state.terrainFeatures.push(mass);
    }
  }
  const rockCollision = new WeakMap();
  function rockBlocks(d, x, y, margin) {
    if (!d.tiles?.length) {
      let interior = false;
      for (const contour of d.contours) {
        if (insideContour(x, y, contour)) interior = !interior;
        for (let i = 0; i < contour.length; i++)
          if (
            segmentDistance(
              { x, y },
              contour[i],
              contour[(i + 1) % contour.length],
            ) <
            14 + margin
          )
            return true;
      }
      return interior;
    }
    let rows = rockCollision.get(d);
    if (!rows) {
      rows = new Map();
      for (const p of d.tiles) {
        if (!rows.has(p.y)) rows.set(p.y, new Set());
        rows.get(p.y).add(p.x);
      }
      rockCollision.set(d, rows);
    }
    const radius = 14 + margin,
      cell = d.cell,
      minX = Math.floor((x - radius) / cell),
      maxX = Math.floor((x + radius) / cell),
      minY = Math.floor((y - radius) / cell),
      maxY = Math.floor((y + radius) / cell);
    for (let ty = minY; ty <= maxY; ty++) {
      const row = rows.get(ty);
      if (!row) continue;
      for (let tx = minX; tx <= maxX; tx++) {
        if (!row.has(tx)) continue;
        const dx = Math.max(tx * cell - x, 0, x - (tx + 1) * cell),
          dy = Math.max(ty * cell - y, 0, y - (ty + 1) * cell);
        if (dx * dx + dy * dy < radius * radius) return true;
      }
    }
    return false;
  }
  const wallArmCache = new WeakMap();
  function wallArms(b, fallbackAngle = 0) {
    const angle = b.wallAngle ?? fallbackAngle;
    const cached = wallArmCache.get(b);
    if (cached && cached.links === b.links && cached.angle === angle)
      return cached.arms;
    const arms = Object.values(b.links || {});
    if (arms.length === 1) arms.push({ x: -arms[0].x, y: -arms[0].y });
    if (!arms.length) {
      const length =
        Math.abs(Math.sin(angle) * Math.cos(angle)) > 0.1
          ? Math.sqrt(2) * 16
          : 16;
      arms.push(
        { x: Math.cos(angle) * length, y: Math.sin(angle) * length },
        { x: -Math.cos(angle) * length, y: -Math.sin(angle) * length },
      );
    }
    wallArmCache.set(b, { links: b.links, angle, arms });
    return arms;
  }
  function curtainBlocks(b, x, y, margin, fallbackAngle = 0) {
    const dx = x - b.x,
      dy = y - b.y,
      r = (b.fortified ? 24 : 15) + margin,
      r2 = r * r;
    for (const arm of wallArms(b, fallbackAngle)) {
      const t = clamp(
        (dx * arm.x + dy * arm.y) / (arm.x * arm.x + arm.y * arm.y || 1),
        0,
        1,
      );
      const rx = dx - arm.x * t,
        ry = dy - arm.y * t;
      if (rx * rx + ry * ry < r2) return true;
    }
    return false;
  }
  function groundFree(x, y, margin = 10, ignore = null, adjacentWalls = false) {
    if (!landFree(x, y, margin)) return false;
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
      if (b.gateSegments) {
        for (const part of b.gateSegments)
          if (curtainBlocks(part, x, y, margin, b.gateAngle || 0)) return false;
        continue;
      }
      if (b.kind === "wall" && Number.isFinite(b.wallAngle)) {
        if (curtainBlocks(b, x, y, margin)) return false;
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
      if (d.kind === "rockmass") {
        if (rockBlocks(d, x, y, margin)) return false;
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
    state.navDirty = false;
    objectIndex.clear();
    obstacleIndex = {
      buildings: new Map(),
      decorations: new Map(),
      nodes: new Map(),
    };
    combatStructures = new Map();
    combatStructureRadius = 0;
    for (const b of state.buildings)
      if (b.hp > 0 && b.team !== 2) {
        let map = combatStructures.get(b.team);
        if (!map) {
          map = new Map();
          combatStructures.set(b.team, map);
        }
        const key = Math.floor(b.x / 256) + "," + Math.floor(b.y / 256);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(b);
        combatStructureRadius = Math.max(combatStructureRadius, b.r || 0);
      }
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
          Math.max(32, b.w / 2, b.r || 0),
          Math.max(32, b.h / 2, b.r || 0),
        );
    for (const d of decorations)
      if (d.block)
        insert(
          obstacleIndex.decorations,
          d,
          d.kind === "rockmass" ? d.rx : d.r,
          d.kind === "rockmass" ? d.ry : d.r,
        );
    for (const n of state.nodes)
      if (n.remaining > 0)
        insert(
          obstacleIndex.nodes,
          n,
          n.kind === "wood" ? 14 : 23,
          n.kind === "wood" ? 14 : 23,
        );
    const curtain = state.buildings.flatMap((other) =>
      other.gateSegments && other.hp > 0
        ? other.gateSegments.map((part, i) => ({
            ...other,
            ...part,
            id: other.id + ":" + i,
            kind: "wall",
          }))
        : other.wallAttachment
          ? [{ ...other, ...other.wallAttachment, kind: "wall" }]
          : [other],
    );
    const curtainBuckets = new Map();
    for (const segment of curtain)
      if (segment.hp > 0 && ["wall", "gate"].includes(segment.kind))
        insert(curtainBuckets, segment, segment.w / 2, segment.h / 2);
    for (const b of state.buildings) {
      const neighbors =
        curtainBuckets.get(
          Math.floor(b.x / 128) + "," + Math.floor(b.y / 128),
        ) || [];
      if (b.kind === "wall" && b.hp > 0)
        b.links = wallConnections(b, neighbors);
      if (b.wallAttachment && b.hp > 0)
        b.wallAttachment.links = wallConnections(
          { ...b, ...b.wallAttachment, kind: "wall" },
          neighbors,
        );
    }
    const waypoints = [];
    for (const b of state.buildings)
      if (b.hp > 0 && !(BUILDINGS[b.kind].passable && !b.closed))
        for (const dx of [-b.w / 2 - 6.25, b.w / 2 + 6.25])
          for (const dy of [-b.h / 2 - 6.25, b.h / 2 + 6.25])
            waypoints.push({ x: b.x + dx, y: b.y + dy });
    for (const obstacle of [
      ...state.nodes.filter((n) => n.remaining > 0 && n.kind !== "food"),
      ...decorations.filter((d) => d.block && d.kind !== "rockmass"),
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
    for (const d of decorations.filter((d) => d.kind === "rockmass"))
      for (const contour of d.contours)
        for (const p of contour)
          for (const dx of [-21, 21])
            for (const dy of [-21, 21])
              waypoints.push({ x: p.x + dx, y: p.y + dy });
    // Only resample changed footprints; retain an exact full-map connectivity pass.
    const footprints = new Map();
    for (const b of state.buildings)
      if (b.hp > 0 && !(BUILDINGS[b.kind].passable && !b.closed)) {
        const pad = b.kind === "wall" || b.gateSegments ? 96 : 24,
          w = b.w + pad * 2,
          h = b.h + pad * 2;
        footprints.set("b" + b.id, {
          x: b.x - w / 2,
          y: b.y - h / 2,
          w,
          h,
          key: [
            b.x,
            b.y,
            b.w,
            b.h,
            b.closed,
            b.wallAngle,
            JSON.stringify(b.links),
            JSON.stringify(b.gateSegments),
          ].join(";"),
        });
      }
    for (const n of state.nodes)
      if (n.remaining > 0 && n.kind !== "food")
        footprints.set("n" + n.id, {
          x: n.x - 40,
          y: n.y - 40,
          w: 80,
          h: 80,
          key: [n.x, n.y, n.kind].join(";"),
        });
    const previous = nav.footprints,
      regions = [];
    if (previous)
      for (const key of new Set([...previous.keys(), ...footprints.keys()])) {
        const old = previous.get(key),
          current = footprints.get(key);
        if (old?.key === current?.key) continue;
        if (old) regions.push(old);
        if (current) regions.push(current);
      }
    const incremental = previous && nav.decorations === decorations;
    const changed = nav.rebuild(
      (x, y) => groundFree(x, y, 6),
      waypoints,
      incremental ? regions : null,
    );
    nav.footprints = footprints;
    nav.decorations = decorations;
    if (!changed) return;
    for (const u of state.units) {
      const points = [u, ...(u.path || []), u.pathGoal || u];
      const affected =
        !incremental ||
        regions.some((area) =>
          points.some((p, i) => {
            const a = points[Math.max(0, i - 1)];
            return (
              Math.max(a.x, p.x) >= area.x &&
              Math.min(a.x, p.x) <= area.x + area.w &&
              Math.max(a.y, p.y) >= area.y &&
              Math.min(a.y, p.y) <= area.y + area.h
            );
          }),
        );
      if (affected) {
        u.path = [];
        u.pathTimer = 0;
      } else u.pathRevision = nav.revision;
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
  function routePossible(u, p) {
    const route = nav.query(u, p);
    // Pending is distinct from unreachable: retain the assignment while searching.
    return route === null || route.length > 0;
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
        !routePossible(u, point)
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
    const roadNav = new window.CruciataNavigation(W, H, 32);
    roadNav.rebuild((x, y) => groundFree(x, y, 22));
    const hubs = [
      state.buildings[0],
      state.buildings[1],
      ...state.buildings.filter((b) => b.team === 1 && b.kind === "towncenter"),
      ...state.sites,
    ]
      .map((p) => {
        const cell = roadNav.nearest(p.x, p.y);
        return cell
          ? {
              x: (cell.x + 0.5) * roadNav.cell,
              y: (cell.y + 0.5) * roadNav.cell,
            }
          : null;
      })
      .filter(Boolean);
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
        route = roadNav.find(best.a, b);
      if (route.length) roads.push([best.a, ...route]);
      reached.push(b);
    }
    return roads;
  }
  function makeWorld(generate = true) {
    const savedRockMasses =
      !generate &&
      Array.isArray(state.terrainFeatures) &&
      state.terrainFeatures.every((feature) => feature.kind === "rockmass")
        ? state.terrainFeatures
        : null;
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
        if (
          landFree(d.x, d.y, d.r + 12, false) &&
          groundFree(d.x, d.y, 12) &&
          !road.some((p) => distance(d, p) < 180)
        )
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
      if (landFree(d.x, d.y, 16, false) && groundFree(d.x, d.y, 0))
        decorations.push(d);
    }
    if (savedRockMasses) {
      state.terrainFeatures = savedRockMasses;
      for (const mass of savedRockMasses) {
        const tiles = new Map(
            (mass.tiles || []).map((p) => [p.x + "," + p.y, p]),
          ),
          cell = mass.cell || 64;
        const added = fillRockHoles(
          tiles,
          (x, y) =>
            !state.buildings.some(
              (b) =>
                b.hp > 0 &&
                Math.abs(b.x - (x + 0.5) * cell) < b.w / 2 + cell / 2 &&
                Math.abs(b.y - (y + 0.5) * cell) < b.h / 2 + cell / 2,
            ),
        );
        if (added) {
          mass.tiles = [...tiles.values()];
          mass.contours = traceRockContours(tiles, cell);
        }
      }
      decorations.push(...savedRockMasses);
      // An enclosed deposit from an older map moves to the nearby rim, preserving its stores.
      for (const n of state.nodes)
        if (
          n.remaining > 0 &&
          savedRockMasses.some((d) => rockBlocks(d, n.x, n.y, 8))
        ) {
          const origin = { x: n.x, y: n.y };
          let found = false;
          for (let radius = 64; radius <= 1600 && !found; radius += 64)
            for (let i = 0; i < 24; i++) {
              const p = {
                x: origin.x + Math.cos((i * Math.PI) / 12) * radius,
                y: origin.y + Math.sin((i * Math.PI) / 12) * radius,
              };
              if (groundFree(p.x, p.y, n.kind === "wood" ? 24 : 32)) {
                n.x = p.x;
                n.y = p.y;
                found = true;
                break;
              }
            }
        }
    } else makeRockClusters(random);
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
            remaining:
              c.kind === "wood" ? 660 : c.kind === "food" ? 1500 : 3900,
            max: c.kind === "wood" ? 660 : c.kind === "food" ? 1500 : 3900,
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
          if (
            !landFree(n.x, n.y, n.kind === "wood" ? 52 : 35, false) ||
            !groundFree(n.x, n.y, 28)
          )
            continue;
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
  function addSiegeCity(x, y, name) {
    x = Math.round(x / 32) * 32;
    y = Math.round(y / 32) * 32;
    const city = {
      id: ++uid,
      x,
      y,
      name,
      radius: 1100,
      capture: 0,
      captured: false,
      reward: { food: 1800, wood: 2400, stone: 1800, gold: 2200 },
    };
    state.cities.push(city);
    const extra = { city: city.id };
    const center = makeBuilding("towncenter", 3, x, y, 1, {
      ...extra,
      cityCenter: true,
      w: 280,
      h: 240,
      r: 185,
      hp: 16000,
      maxHp: 16000,
    });
    city.center = center.id;
    state.buildings.push(center);
    for (let i = 0; i < 32; i++) {
      const angle = i * 2.399,
        r = 300 + Math.floor(i / 8) * 120;
      const kind =
        i < 20
          ? "house"
          : ["barracks", "stable", "chapel", "siegeworkshop", "farm", "mill"][
              i % 6
            ];
      state.buildings.push(
        makeBuilding(
          kind,
          3,
          x + Math.cos(angle) * r,
          y + Math.sin(angle) * r,
          1,
          extra,
        ),
      );
    }
    for (const p of defensivePlots(city, 960))
      state.buildings.push(
        makeBuilding(p.kind, 3, p.x, p.y, 1, {
          ...extra,
          ...p,
          kind: p.kind === "bastionwall" ? "wall" : p.kind,
          closed: true,
        }),
      );
    for (let i = 0; i < 16; i++)
      state.units.push(
        makeUnit(
          "civilian",
          3,
          x - 190 + (i % 8) * 48,
          y + 210 + Math.floor(i / 8) * 40,
          { ...extra, home: { x, y: y + 220 }, wander: 6 + i },
        ),
      );
    for (
      let i = 0;
      i < 72 + (state.mode === "campaign" ? state.level * 8 : 0);
      i++
    ) {
      const type =
        i % 11 === 0
          ? "knight"
          : i % 3 === 0
            ? "archer"
            : i === 70
              ? "chaplain"
              : i === 71
                ? "standard"
                : "sword";
      const angle = i * 2.399,
        r = i < 20 ? 200 : i < 44 ? 480 : 810,
        p = { x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r };
      state.units.push(
        makeUnit(type, 3, p.x, p.y, {
          ...extra,
          cityDefender: true,
          home: p,
          hold: type === "archer",
          rank: 1,
        }),
      );
    }
  }
  function observerSees(observer, target) {
    if (observer.team === 3) return !!militiaFog?.sees(target);
    return (observer.team === 0 ? fog : enemyFog).sees(target);
  }
  function captureCities(dt) {
    for (const city of state.cities || []) {
      if (city.captured) continue;
      const capital = state.buildings.find((b) => b.id === city.center);
      const soldiers = state.units.filter(
        (u) =>
          u.hp > 0 &&
          u.team === 0 &&
          ["sword", "archer", "knight", "standard"].includes(u.type) &&
          (capital
            ? surfaceDistance(u, capital) < 35
            : distance(u, city) < 100),
      );
      if (!soldiers.length) continue;
      city.capture = 12;
      city.captured = true;
      if (!city.rewardClaimed) {
        const reward = city.reward || {
          food: 1800,
          wood: 2400,
          stone: 1800,
          gold: 2200,
        };
        for (const [resource, amount] of Object.entries(reward))
          state.resources[resource] += amount;
        city.rewardClaimed = true;
        city.reward = reward;
        state.stats.citiesCaptured = (state.stats.citiesCaptured || 0) + 1;
      }
      for (const b of state.buildings.filter(
        (b) => b.city === city.id && b.hp > 0,
      )) {
        b.team = 0;
        if (b.kind === "gate") b.closed = false;
      }
      for (const u of state.units.filter(
        (u) => u.city === city.id && u.hp > 0,
      )) {
        u.team = 0;
        if (u.type === "civilian") {
          u.type = "worker";
          u.maxHp = TYPES.worker.hp;
          u.hp = u.maxHp;
        }
        u.cityDefender = false;
        u.target = null;
        u.order = null;
        u.hold = false;
        u.path = [];
        u.home = null;
      }
      state.navDirty = true;
      fog.update(state.units, state.buildings);
      toast(
        city.name +
          " captured! +1,800 food, +2,400 wood, +1,800 stone, +2,200 gold. Surviving defenders and buildings join your host.",
      );
      sound("horn");
    }
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
      groundFree(p.x, p.y, 10) &&
      !state.buildings.some(
        (b) =>
          Math.abs(b.x - p.x) < b.w / 2 + 18 &&
          Math.abs(b.y - p.y) < b.h / 2 + 18,
      ) &&
      !occupied.some((u) => distance(u, p) < 24);
    for (const team of [0, 1, 2, 3]) {
      const capital = state.buildings.find(
        (b) =>
          b.id === (team === 0 ? state.capitals.player : state.capitals.enemy),
      );
      const base =
        team >= 2
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
          index >= 0 &&
          team < 2 &&
          !u.campaignPost &&
          !u.castleGuard &&
          !["pilgrim", "merchant"].includes(u.type)
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
  function stationCurtainArchers() {
    const groups = [
      ...state.cities.map((city) => ({ team: 3, city: city.id, center: city })),
      {
        team: 1,
        center: state.buildings.find((b) => b.id === state.capitals.enemy),
      },
    ];
    if (LEVELS[state.level].kind === "survival" && state.mode === "campaign")
      groups.push({ team: 0, center: state.buildings[0] });
    for (const group of groups) {
      const walls = state.buildings
        .filter(
          (b) =>
            b.team === group.team &&
            b.kind === "wall" &&
            b.defenceLayer === 0 &&
            (group.city ? b.city === group.city : !b.city),
        )
        .sort(
          (a, b) =>
            Math.atan2(a.y - group.center.y, a.x - group.center.x) -
            Math.atan2(b.y - group.center.y, b.x - group.center.x),
        );
      const archers = state.units.filter(
        (u) =>
          u.team === group.team &&
          u.type === "archer" &&
          (group.city ? u.city === group.city : !u.city && !u.campaignPost),
      );
      archers.forEach((u, i) => {
        const wall = walls[Math.floor((i * walls.length) / archers.length)];
        if (!wall) return;
        const a = Math.atan2(group.center.y - wall.y, group.center.x - wall.x),
          p = findFree({
            x: wall.x + Math.cos(a) * 55,
            y: wall.y + Math.sin(a) * 55,
          });
        u.x = p.x;
        u.y = p.y;
        u.home = p;
        u.curtainGuard = true;
        u.hold = true;
        u.stance = "hold";
      });
    }
  }
  function campaignRules(level, difficulty) {
    const scale = difficulty === "hard" ? 1.3 : difficulty === "easy" ? 0.8 : 1;
    return {
      version: 2,
      farms: 4,
      food: 1000,
      survival: difficulty === "easy" ? 600 : difficulty === "hard" ? 900 : 720,
      hold:
        level === 5
          ? difficulty === "easy"
            ? 240
            : difficulty === "hard"
              ? 360
              : 300
          : difficulty === "easy"
            ? 180
            : difficulty === "hard"
              ? 300
              : 240,
      gates: 3,
      deliveries: level === 3 ? 2 : 0,
      strength: scale,
      interval: Math.round((95 - level * 7) / scale),
      grace: level === 0 ? 110 : 75,
      attacks: 0,
      posts: [],
    };
  }
  function prepareCampaign() {
    const rules = state.campaignRules,
      l = LEVELS[state.level],
      camp = state.buildings[0];
    if (l.kind === "survival") {
      for (const u of fighters(0)) u.castleGuard = true;
      Object.assign(camp, {
        w: 240,
        h: 210,
        r: 160,
        hp: 6500,
        maxHp: 6500,
        castle: true,
      });
      for (const plot of defensivePlots(camp, 720))
        state.buildings.push(
          makeBuilding(plot.kind, 0, plot.x, plot.y, 1, {
            ...plot,
            kind: plot.kind === "bastionwall" ? "wall" : plot.kind,
            closed: false,
            defence: true,
          }),
        );
      for (let i = 0; i < 12; i++) {
        const angle = i * 2.399,
          r = 230 + Math.floor(i / 6) * 100;
        state.buildings.push(
          makeBuilding(
            i < 8
              ? "house"
              : i === 8
                ? "watchtower"
                : i === 9
                  ? "stable"
                  : i === 10
                    ? "siegeworkshop"
                    : "barracks",
            0,
            camp.x + Math.cos(angle) * r,
            camp.y + Math.sin(angle) * r,
          ),
        );
      }
      for (let i = 0; i < 36; i++) {
        const angle = i * 2.399,
          r = 280 + (i % 3) * 90;
        state.units.push(
          makeUnit(
            i % 7 === 0
              ? "knight"
              : i % 3 === 0
                ? "archer"
                : i === 35
                  ? "standard"
                  : "sword",
            0,
            camp.x + Math.cos(angle) * r,
            camp.y + Math.sin(angle) * r,
            {
              castleGuard: true,
              home: {
                x: camp.x + Math.cos(angle) * r,
                y: camp.y + Math.sin(angle) * r,
              },
            },
          ),
        );
      }
      rebuildNavigation();
    }
    if (l.kind === "escort") {
      const route = [
        { x: 1100, y: 1420 },
        { x: riverX(1150) - 130, y: 1150 },
        { x: riverX(1150) + 210, y: 1150 },
        { x: 3200, y: 1800 },
        { x: 5900, y: 3900 },
        { x: 6900, y: 4100 },
        { x: 9000, y: 2800 },
        { x: 11200, y: 1600 },
      ];
      for (const u of state.units.filter((u) => u.type === "pilgrim")) {
        u.route = route.map((p) => findFree(p));
        u.routeIndex = 0;
        u.hp = u.maxHp = 300;
      }
      const refuge = state.sites.find((p) => p.name === "Pilgrim refuge");
      Object.assign(refuge, route.at(-1));
      rules.route = route;
    }
    if (["liberation", "occupation"].includes(l.kind)) {
      const sites = state.sites.filter(
        (p) => !p.optional && p.name !== "Pilgrim refuge",
      );
      sites.forEach((site, i) => {
        const goal = { x: i ? 9400 : 5600, y: i ? 4900 : 3300 },
          dx = goal.x - site.x,
          dy = goal.y - site.y;
        Object.assign(site, goal);
        for (const b of state.buildings.filter((b) => b.site === site.id)) {
          b.x += dx;
          b.y += dy;
        }
        for (const u of state.units.filter((u) => u.site === site.id)) {
          u.x += dx;
          u.y += dy;
          if (u.home) {
            u.home.x += dx;
            u.home.y += dy;
          }
        }
      });
      if (l.kind === "liberation")
        for (let i = 0; i < 3; i++)
          state.units.push(
            makeUnit("merchant", 0, camp.x + 250 + i * 50, camp.y + 180, {
              route: [
                { x: 1100, y: 1420 },
                { x: riverX(1150) + 240, y: 1150 },
                { x: 5600, y: 3300 },
                { x: 9400, y: 4900 },
              ],
              routeIndex: 0,
              missionSupply: true,
            }),
          );
    }
    if (l.kind === "siege")
      for (const b of state.buildings.filter((b) => b.gate)) {
        b.hp = b.maxHp = 16000;
      }
    const anchors =
      l.kind === "escort"
        ? [
            { x: riverX(1150) + 340, y: 1370 },
            { x: 4900, y: 3700 },
            { x: 8650, y: 3000 },
            { x: 10500, y: 1950 },
          ]
        : l.kind === "survival"
          ? Array.from({ length: 6 }, (_, i) => ({
              x: camp.x + Math.cos((i * Math.PI) / 3) * 1150,
              y: camp.y + Math.sin((i * Math.PI) / 3) * 1150,
            }))
          : l.kind === "settlement"
            ? [{ x: state.buildings[1].x + 300, y: state.buildings[1].y + 350 }]
            : [
                { x: 5950, y: 3500 },
                { x: 9750, y: 5100 },
                { x: camp.x + 950, y: camp.y + 650 },
              ];
    if (state.level >= 3) {
      anchors.push({ x: 7800, y: 4000 });
      if (state.level >= 4) anchors.push({ x: 9000, y: 2200 });
      if (state.level >= 5) anchors.push({ x: 9300, y: 6600 });
    }
    for (const [j, raw] of anchors.entries()) {
      let p = findFree(raw);
      for (let i = 0; i < 48; i++) {
        const a = i * 2.399,
          r = Math.floor(i / 8) * 70,
          q = { x: raw.x + Math.cos(a) * r, y: raw.y + Math.sin(a) * r };
        if (
          [-55, 0, 55].every((dx) =>
            [-50, 0, 50].every((dy) => groundFree(q.x + dx, q.y + dy, 10)),
          )
        ) {
          p = q;
          break;
        }
      }
      const post = makeBuilding("barracks", 1, p.x, p.y, 1, {
        campaignPost: true,
        hp: 2200,
        maxHp: 2200,
      });
      state.buildings.push(post);
      for (const sign of [-1, 1]) {
        const q = findFree({ x: p.x + sign * 160, y: p.y - 120 });
        state.buildings.push(
          makeBuilding("tower", 1, q.x, q.y, 1, {
            campaignPost: post.id,
            hp: 1800,
            maxHp: 1800,
          }),
        );
      }
      const goal =
        l.kind === "escort"
          ? rules.route[Math.min(rules.route.length - 2, 2 + j * 2)]
          : l.kind === "survival"
            ? { x: camp.x, y: camp.y }
            : l.kind === "settlement"
              ? { x: state.buildings[1].x, y: state.buildings[1].y }
              : { x: p.x - 350, y: p.y - 200 };
      rules.posts.push({ id: post.id, x: p.x, y: p.y, goal });
      const count = Math.round((8 + state.level * 2) * rules.strength);
      for (let i = 0; i < count; i++) {
        const type =
          i === count - 1 && state.level >= 2
            ? "trebuchet"
            : i === count - 2 && state.level >= 2
              ? "ram"
              : i % 4 === 0
                ? "archer"
                : i % 7 === 0
                  ? "knight"
                  : "sword";
        const q = findFree({
          x: p.x - 150 + (i % 5) * 35,
          y: p.y + 130 + Math.floor(i / 5) * 35,
        });
        state.units.push(
          makeUnit(type, 1, q.x, q.y, {
            campaignPost: post.id,
            garrisonBase: post.id,
            home: q,
            stance: "fight",
          }),
        );
      }
      if (state.level >= 2)
        for (const u of state.units.filter(
          (u) =>
            u.campaignPost === post.id && ["trebuchet", "ram"].includes(u.type),
        ))
          applyRank(
            u,
            u.type === "trebuchet"
              ? 2
              : Math.min(2, Math.floor(state.level / 2)),
          );
      if (state.level >= 3)
        for (const u of state.units.filter(
          (u) =>
            u.campaignPost === post.id &&
            !["trebuchet", "ram"].includes(u.type),
        ))
          applyRank(u, Math.min(2, Math.floor(state.level / 2)));
      rebuildNavigation();
    }
    state.waveTimer = rules.grace;
  }
  function campaignPressure(dt) {
    const rules = state.campaignRules;
    if (!rules || state.mode !== "campaign") return;
    rules.think = (rules.think || 0) - dt;
    if (rules.think > 0) return;
    rules.think = 1;
    for (const post of rules.posts) {
      const building = getObject(post.id);
      if (!building || building.team !== 1) continue;
      const local = fighters(1).filter(
        (u) =>
          !u.fixedDefense &&
          !u.curtainGuard &&
          !u.scout &&
          !u.order?.formation &&
          distance(u, post) < 650 &&
          (!u.campaignPost || u.campaignPost === post.id),
      );
      for (const u of local) {
        u.campaignPost = post.id;
        u.garrisonBase = post.id;
        u.home ||= findFree({
          x: post.x - 120 + (u.id % 5) * 40,
          y: post.y + 160,
        });
      }
      if (state.waveTimer > 0 || local.length < 6) continue;
      const visible = state.units
        .filter(
          (u) => u.team === 0 && enemyFog.sees(u) && distance(u, post) < 1800,
        )
        .sort(
          (a, b) =>
            (["pilgrim", "merchant"].includes(a.type) ? 0 : 1) -
              (["pilgrim", "merchant"].includes(b.type) ? 0 : 1) ||
            distance(a, post) - distance(b, post),
        )[0];
      const defense =
        LEVELS[state.level].kind === "survival"
          ? state.buildings
              .filter(
                (b) =>
                  b.team === 0 &&
                  b.hp > 0 &&
                  b.progress >= 1 &&
                  enemyFog.sees(b),
              )
              .sort((a, b) => distance(a, post) - distance(b, post))[0]
          : null;
      const members = local.slice(0, Math.max(4, local.length - 3)),
        destination = findFree(
          defense
            ? routePossible(post, edgePoint(post, state.buildings[0], 40))
              ? edgePoint(post, state.buildings[0], 40)
              : edgePoint(post, defense, 40)
            : visible || post.goal,
        ),
        id = ++uid,
        center = members.reduce(
          (p, u) => ({
            x: p.x + u.x / members.length,
            y: p.y + u.y / members.length,
          }),
          { x: 0, y: 0 },
        );
      const facing = Math.atan2(
        destination.y - center.y,
        destination.x - center.x,
      );
      members.forEach((u, i) => {
        const rear =
            Math.floor(i / 5) * 45 + (u.type === "trebuchet" ? 400 : 0),
          side = ((i % 5) - 2) * 45;
        const goal = findFree({
          x: destination.x - Math.cos(facing) * rear - Math.sin(facing) * side,
          y: destination.y - Math.sin(facing) * rear + Math.cos(facing) * side,
        });
        const order = { ...goal, attack: true, formation: id };
        u.order = order;
        u.marchOffset = {
          x: goal.x - destination.x,
          y: goal.y - destination.y,
        };
        u.path = [];
        u.pathGoal = null;
        u.pathRequest = null;
        u.home = { ...destination };
        if (u.type === "trebuchet" && u.deployment !== "packed") {
          u.deployment = "packing";
          u.deployTimer = 4;
          u.pendingOrder = order;
          u.order = null;
        }
      });
      state.formations.push({
        id,
        members: members.map((u) => u.id),
        anchor: center,
        routeStart: findFree(center),
        destination,
        sharedRoute: true,
        routeReady: false,
        path: [],
        revision: nav.revision,
        speed: Math.min(...members.map((u) => TYPES[u.type].speed)),
        arrived: false,
        wait: 0,
      });
      rules.attacks++;
    }
    if (state.waveTimer <= 0) state.waveTimer = rules.interval;
  }
  function startLevel(index, intro = true) {
    actionTurns.clear();
    formationRoutes.clear();
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
      resourceScale: 3,
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
      cities: [],
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
      campaignRules: quickConfig
        ? null
        : campaignRules(
            index,
            quickConfig?.difficulty ||
              $("campaign-difficulty")?.value ||
              "normal",
          ),
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
      : { x: W - 2000, y: Math.floor(H * (index >= 4 ? 0.46 : 0.34)) };
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
          for (let i = 0; i < 4; i++)
            state.units.push(
              makeUnit("civilian", 2, b.x - 70 + i * 36, b.y + 135, {
                site: site.id,
                home: { x: b.x, y: b.y + 135 },
                wander: 6 + i,
              }),
            );
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
    if (!quickConfig) {
      const capital = state.buildings.find(
        (b) => b.kind === "towncenter" && b.team === 1,
      );
      if (index >= 4) {
        capital.fortressShape = {
          x: index === 5 ? 1.7 : 1.45,
          y: index === 5 ? 2.9 : 2.5,
          layers: 3,
        };
        Object.assign(capital, {
          w: 320,
          h: 280,
          r: 220,
          hp: index === 5 ? 16000 : 11000,
          maxHp: index === 5 ? 16000 : 11000,
          castle: true,
        });
      }
      for (const p of defensivePlots(capital, 896))
        state.buildings.push(
          makeBuilding(p.kind, 1, p.x, p.y, 1, {
            ...p,
            kind: p.kind === "bastionwall" ? "wall" : p.kind,
            defence: true,
          }),
        );
      for (let i = 0; i < 12; i++)
        state.buildings.push(
          makeBuilding(
            i < 8
              ? "house"
              : i === 8
                ? "stable"
                : i === 9
                  ? "siegeworkshop"
                  : i === 10
                    ? "chapel"
                    : "barracks",
            1,
            capital.x - 480 + (i % 4) * 220,
            capital.y - 420 + Math.floor(i / 4) * 190,
          ),
        );
    }
    if (!quickConfig && index >= 4) {
      const capital = state.buildings.find(
        (b) => b.kind === "towncenter" && b.team === 1,
      );
      for (let i = 0; i < 60; i++) {
        const angle = i * 2.399,
          r = 600 + (i % 4) * 270;
        state.buildings.push(
          makeBuilding(
            i < 42
              ? "house"
              : [
                  "barracks",
                  "stable",
                  "siegeworkshop",
                  "chapel",
                  "farm",
                  "mill",
                ][i % 6],
            1,
            capital.x + Math.cos(angle) * r * 0.8,
            capital.y + Math.sin(angle) * r * 1.6,
          ),
        );
      }
      for (let i = 0; i < 3; i++)
        state.buildings.push(
          makeBuilding(
            "towncenter",
            1,
            capital.x - 420 + (i % 2) * 850,
            capital.y - 1300 + i * 1250,
            1,
            { hp: 7000, maxHp: 7000, district: true },
          ),
        );
      for (let i = 0; i < 60; i++) {
        const angle = i * 2.399,
          r = 650 + (i % 3) * 300;
        state.units.push(
          makeUnit(
            i < 12
              ? "trebuchet"
              : i % 4 === 0
                ? "knight"
                : i % 3 === 0
                  ? "archer"
                  : "sword",
            1,
            capital.x + Math.cos(angle) * r * 0.8,
            capital.y + Math.sin(angle) * r * 1.6,
            {
              deployment: i < 12 ? "deployed" : "packed",
              fixedDefense: i < 12,
              garrisonBase: capital.id,
              home: {
                x: capital.x + Math.cos(angle) * r * 0.8,
                y: capital.y + Math.sin(angle) * r * 1.6,
              },
              rank: 2,
              castleGuard: true,
            },
          ),
        );
      }
    }
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
    addSiegeCity(W * 0.35, H * 0.26, "Castellum Petrae");
    addSiegeCity(W * 0.6, H * 0.66, "Civitas Fontis");
    state.capitals = {
      player: state.buildings[0].id,
      enemy: state.buildings.find(
        (b) => b.kind === "towncenter" && b.team === 1,
      ).id,
    };
    arrangeStartingBuildings();
    makeWorld();
    // The northern curtain meets solid terrain; masonry buried in rock is redundant.
    state.buildings = state.buildings.filter(
      (b) =>
        !(
          b.city === state.cities[0]?.id &&
          b.kind === "wall" &&
          b.y < state.cities[0].y - 250 &&
          state.terrainFeatures.some((d) => rockBlocks(d, b.x, b.y, 8))
        ),
    );
    rebuildNavigation();
    if (!quickConfig) prepareCampaign();
    musterStartingUnits();
    stationCurtainArchers();
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
    militiaFog = new window.CruciataFog(W, H, null, 3);
    fog.update(state.units, state.buildings);
    enemyFog.update(state.units, state.buildings);
    militiaFog ||= new window.CruciataFog(W, H, null, 3);
    militiaFog.update(state.units, state.buildings);
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
    for (const u of old.units) {
      u.stance ||= u.hold ? "hold" : "fight";
      u.pathRequest = null;
    }
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
      if (b.team === 1) b.architecture ||= "islamic";
      if (b.kind === "greatengine") {
        b.w = BUILDINGS.greatengine.w;
        b.h = BUILDINGS.greatengine.h;
        b.r = Math.max(b.w, b.h) / 2;
      }
      if (!["wall", "gate"].includes(b.kind) && !b.gate) continue;
      const reinforcedHp =
        b.kind === "wall" ? BUILDINGS.wall.hp : BUILDINGS.gate.hp;
      if (b.maxHp < reinforcedHp) {
        b.hp *= reinforcedHp / b.maxHp;
        b.maxHp = reinforcedHp;
      }
    }
    actionTurns.clear();
    formationRoutes.clear();
    sessionActive = true;
    quickConfig = state.config;
    quickSlot = state.slot;
    state.controlGroups ||= {};
    if (state.resourceScale !== 3) {
      for (const n of state.nodes) {
        n.remaining *= 3;
        n.max *= 3;
      }
      state.resourceScale = 3;
    }
    uid = saved.uid || 0;
    camera = saved.camera || {
      x: state.buildings[0].x,
      y: state.buildings[0].y,
      zoom: 1,
    };
    state.paused = true;
    selected.clear();
    selectedBuilding = null;
    selectedBuildings.clear();
    makeWorld(false);
    fog = new window.CruciataFog(W, H, state.fog);
    enemyFog = new window.CruciataFog(W, H, state.enemyFog, 1);
    militiaFog = new window.CruciataFog(W, H, state.militiaFog, 3);
    enemyFog.update(state.units, state.buildings);
    militiaFog ||= new window.CruciataFog(W, H, null, 3);
    militiaFog.update(state.units, state.buildings);
    fog.update(state.units, state.buildings);
    rebuildNavigation();
    state.roads = planRoads();
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
      state.armyTransitPending = state.level;
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
    for (const bucket of spatial.values()) bucket.length = 0;
    objectIndex.clear();
    for (const list of [state.units, state.buildings, state.nodes])
      for (const o of list) objectIndex.set(o.id, o);
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
  function nearbyStructures(p, r) {
    if (!combatStructures) return state.buildings;
    const out = [],
      reach = r + combatStructureRadius;
    for (const [team, map] of combatStructures)
      if (team !== p.team)
        for (
          let y = Math.floor((p.y - reach) / 256);
          y <= Math.floor((p.y + reach) / 256);
          y++
        )
          for (
            let x = Math.floor((p.x - reach) / 256);
            x <= Math.floor((p.x + reach) / 256);
            x++
          )
            for (const b of map.get(x + "," + y) || []) out.push(b);
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
  function assignDepotGather(u, depot) {
    const types = BUILDINGS[depot.kind].drop || [];
    const candidates = state.nodes.filter(
      (n) =>
        types.includes(n.kind) &&
        n.remaining > 0 &&
        (u.team === 0 ? fog : enemyFog).remembers(n),
    );
    if (types.includes("food"))
      candidates.push(...completeBuildings("farm", u.team));
    candidates.sort((a, b) => distance(a, depot) - distance(b, depot));
    const target = candidates.find((n) => !edgePoint(u, n, 16).unreachable);
    if (!target) return false;
    return assignGather(
      u,
      target.kind === "farm" ? "food" : target.kind,
      target,
      null,
      depot.id,
    );
  }
  function assignGather(
    u,
    resource,
    node = null,
    cluster = null,
    depot = null,
  ) {
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
      depot,
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
      .filter(
        (n) => n.remaining > 0 && playerRemembers(n) && Art.hitResource(n, p),
      )
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
      path: [],
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
  const formationRoutes = new Map();
  function updateFormations() {
    state.formations ||= [];
    const unitById = new Map(state.units.map((u) => [u.id, u]));
    const active = (u, f) =>
      u &&
      u.hp > 0 &&
      (u.order?.formation === f.id || u.pendingOrder?.formation === f.id);
    state.formations = state.formations.filter((f) => {
      const live = f.members.some((id) => active(unitById.get(id), f));
      if (!live) nav.cancelOwner("formation:" + f.id);
      return live;
    });
    formationRoutes.clear();
    for (const f of state.formations) {
      formationRoutes.set(f.id, f);
      const members = f.members
        .map((id) => unitById.get(id))
        .filter((u) => active(u, f));
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
      if (f.sharedRoute && !f.escortId) {
        if (f.revision !== nav.revision) {
          f.path = [];
          f.routeReady = false;
          f.routeStart = findFree(f.anchor);
          f.revision = nav.revision;
        }
        if (!f.routeReady) {
          const path = nav.query(
            f.routeStart || findFree(f.anchor),
            f.destination,
            { priority: f.team === 0 ? 2 : 0, owner: "formation:" + f.id },
          );
          if (path !== null) {
            f.path = path.length
              ? [f.routeStart || findFree(f.anchor), ...path]
              : [];
            f.routeReady = true;
          }
        }
      }
      // Arrival slots are stable goals; the shared route leads to their center.
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
  function reserveSlot(p, slots, anchor = null) {
    const available = (q) =>
      !slots.some((s) => distance(s, q) < 24) &&
      (!anchor || nav.clearLine(anchor, q));
    if (!available(p)) {
      let found = null;
      for (let radius = 32; radius <= 192 && !found; radius += 32)
        for (let i = 0; i < 16; i++) {
          const q = marchPoint({
            x: p.x + Math.cos((i * Math.PI) / 8) * radius,
            y: p.y + Math.sin((i * Math.PI) / 8) * radius,
          });
          if (available(q)) {
            found = q;
            break;
          }
        }
      if (!found && anchor)
        for (let radius = 0; radius <= 960 && !found; radius += 32)
          for (let i = 0; i < 32; i++) {
            const q = marchPoint({
              x: anchor.x + Math.cos((i * Math.PI) / 16) * radius,
              y: anchor.y + Math.sin((i * Math.PI) / 16) * radius,
            });
            if (available(q)) {
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
        if (available(p) && routePossible(u, p)) return p;
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
      if (
        formationRoutes.get(u.order.formation)?.escortId &&
        getObject(formationRoutes.get(u.order.formation).escortId)
      )
        return;
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
      u.path = [];
      u.pathGoal = null;
      u.pathRequest = null;
    }
    let p = {
      x: clamp(destination.x, 25, W - 25),
      y: clamp(destination.y, 25, H - 25),
    };
    const distToGoal = distance(u, p);
    if (distToGoal < stop) {
      u.moving = false;
      u.vx = 0;
      u.vy = 0;
      return true;
    }

    const unitR = ["knight", "trebuchet", "ram", "ballista"].includes(u.type)
      ? 26
      : 14;
    const reachDist = Math.max(20, unitR * 1.15);

    const company = formationRoutes.get(u.order?.formation);
    const shared =
      company?.sharedRoute &&
      !company.escortId &&
      distance(destination, u.order) < 1;
    if (shared && distToGoal >= 220) {
      if (!company.routeReady || !company.path.length) {
        u.moving = false;
        return false;
      }
      if (
        u.sharedRouteRevision !== company.revision ||
        !u.path?.length ||
        !u.pathGoal ||
        distance(u.pathGoal, p) > 24
      ) {
        // The first point is the company origin; join the nearest visible route entry.
        let entry = 0;
        while (
          entry + 1 < company.path.length &&
          nav.clearLine(u, company.path[entry + 1])
        )
          entry++;
        const route = company.path.slice(entry);
        if (route.length && !nav.clearLine(u, route[0])) {
          if (
            !u.pathRequest ||
            u.pathRequest.revision !== company.revision ||
            distance(u.pathRequest.goal, route[0]) > 1
          )
            u.pathRequest = {
              start: { x: u.x, y: u.y },
              goal: route[0],
              revision: company.revision,
            };
          const connector = nav.query(u.pathRequest.start, u.pathRequest.goal, {
            priority: u.team === 0 ? 2 : 0,
            owner: "unit:" + u.id,
          });
          if (connector === null) {
            u.moving = false;
            return false;
          }
          if (!connector.length) {
            u.moving = false;
            return false;
          }
          route.unshift(...connector.slice(0, -1));
        }
        u.path = [...route, p];
        u.pathGoal = p;
        u.pathRevision = company.revision;
        u.sharedRouteRevision = company.revision;
        u.pathRequest = null;
        u.stuck = 0;
      }
    }
    // Direct line-of-sight shortcuts directly to destination
    if (distToGoal < 220 && nav.clearLine(u, p)) {
      u.path = [p];
      u.pathGoal = p;
      u.pathRequest = null;
      u.pathRevision = nav.revision;
      u.stuck = 0;
    }

    // Only query a new path when genuinely needed (no periodic repathing destroying working paths)
    const hasValidPath = u.path && u.path.length > 0;
    const sameGoal = u.pathGoal && distance(p, u.pathGoal) <= 24;
    const sameRevision = u.pathRevision === nav.revision;
    const notStuck = (u.stuck || 0) < 0.8;
    const needsNewPath =
      !hasValidPath || !sameGoal || !sameRevision || (!notStuck && !shared);

    if (needsNewPath) {
      if (
        !u.pathRequest ||
        u.pathRequest.revision !== nav.revision ||
        distance(u.pathRequest.goal, p) > 24
      )
        u.pathRequest = {
          start: { x: u.x, y: u.y },
          goal: p,
          revision: nav.revision,
        };
      const path = nav.query(u.pathRequest.start, u.pathRequest.goal, {
        priority: u.team === 0 ? (u.order ? 2 : 1) : 0,
        owner: "unit:" + u.id,
      });
      if (path === null) {
        // Keep valid existing route while replacement is being computed
        if (u.pathRevision !== nav.revision || !u.path?.length) {
          u.moving = false;
          return false;
        }
      } else {
        u.path = path;
        u.pathRequest = null;
        u.pathGoal = p;
        u.pathRevision = nav.revision;
        u.stuck = 0;

        // Immediately prune stale waypoints that are behind the unit or shortcutted
        while (u.path.length > 1) {
          const p0 = u.path[0],
            p1 = u.path[1];
          const segX = p1.x - p0.x,
            segY = p1.y - p0.y;
          const dot = (u.x - p0.x) * segX + (u.y - p0.y) * segY;
          if (
            (dot > 0 || distance(u, p0) < reachDist) &&
            nav.clearLine(u, p1)
          ) {
            u.path.shift();
          } else {
            break;
          }
        }
      }
    }

    // Advance waypoints along path smoothly
    while (u.path.length > 0) {
      const cur = u.path[0];
      const distToCur = distance(u, cur);
      if (
        distToCur < reachDist &&
        (u.path.length < 2 || nav.clearLine(u, u.path[1]))
      ) {
        u.path.shift();
        continue;
      }
      if (u.path.length >= 2) {
        const nextWp = u.path[1];
        const segX = nextWp.x - cur.x,
          segY = nextWp.y - cur.y;
        const dot = (u.x - cur.x) * segX + (u.y - cur.y) * segY;
        if (dot > 0 && nav.clearLine(u, nextWp)) {
          u.path.shift();
          continue;
        }
        if (distance(u, nextWp) < 220 && nav.clearLine(u, nextWp)) {
          u.path.shift();
          continue;
        }
      }
      break;
    }

    if (!u.path.length) {
      if (distToGoal < stop) {
        u.moving = false;
        u.vx = 0;
        u.vy = 0;
        return true;
      }
      if (groundFree(p.x, p.y, 6) && distToGoal < 75) {
        u.path = [p];
      } else {
        u.stuck = (u.stuck || 0) + dt;
        u.moving = false;
        return false;
      }
    }

    let next = u.path[0] || p;
    const d = distance(u, next);
    const baseSpeed = TYPES[u.type].speed;
    const speed = baseSpeed;

    // --- 1. Path Force (steer along navigation path toward next waypoint) ---
    const pDirX = d > 0.001 ? (next.x - u.x) / d : 0;
    const pDirY = d > 0.001 ? (next.y - u.y) / d : 0;
    const pathSpeed =
      u.path.length <= 1 && distToGoal < 30
        ? speed * Math.min(1, Math.max(0.35, distToGoal / 25))
        : speed;
    let fPathX = pDirX * pathSpeed;
    let fPathY = pDirY * pathSpeed;

    // --- 2. Cohesion Force (flock towards company center) ---
    let fCohX = 0,
      fCohY = 0;
    const formation = u.order?.formation
      ? state.formations.find((f) => f.id === u.order.formation)
      : null;
    const cohTarget = formation?.anchor;
    if (cohTarget && distToGoal > 220 && nav.clearLine(u, cohTarget)) {
      const cdx = cohTarget.x - u.x,
        cdy = cohTarget.y - u.y,
        cd = Math.hypot(cdx, cdy);
      if (cd > 24) {
        const cohFade = Math.min(1, Math.max(0, (distToGoal - 35) / 50));
        const cohStrength = Math.min(speed * 0.35, cd * 0.4) * cohFade;
        fCohX = (cdx / cd) * cohStrength;
        fCohY = (cdy / cd) * cohStrength;
      }
    }

    // --- 3. Alignment Force (match headings with moving flockmates) ---
    let fAlignX = 0,
      fAlignY = 0,
      alignCount = 0;
    for (const other of nearby(u, 90)) {
      if (
        other.id !== u.id &&
        other.team === u.team &&
        other.hp > 0 &&
        other.moving &&
        (other.vx !== undefined || other.vy !== undefined)
      ) {
        fAlignX += other.vx || 0;
        fAlignY += other.vy || 0;
        alignCount++;
      }
    }
    if (alignCount > 0 && distToGoal > 30) {
      const avgVx = fAlignX / alignCount,
        avgVy = fAlignY / alignCount;
      fAlignX = (avgVx - (u.vx || 0)) * 0.3;
      fAlignY = (avgVy - (u.vy || 0)) * 0.3;
    } else {
      fAlignX = 0;
      fAlignY = 0;
    }

    // --- 4. Separation Force (maintain space between nearby units) ---
    let fSepX = 0,
      fSepY = 0;
    const myR = ["knight", "trebuchet", "ram", "ballista"].includes(u.type)
      ? 26
      : 14;
    for (const other of nearby(u, myR + 28)) {
      if (other.id === u.id || other.hp <= 0) continue;
      const otherR = ["knight", "trebuchet", "ram", "ballista"].includes(
        other.type,
      )
        ? 26
        : 14;
      const sepDist = (myR + otherR) * 0.92;
      const odx = u.x - other.x,
        ody = u.y - other.y,
        od = Math.hypot(odx, ody);
      if (
        u.order &&
        !u.order.attack &&
        distToGoal > 30 &&
        distToGoal < 220 &&
        other.team === u.team &&
        !other.moving &&
        od < sepDist + 12 &&
        od > 0.1 &&
        -(odx * pDirX + ody * pDirY) > od * 0.4 &&
        nav.clearLine(u, p)
      ) {
        // Step around settled allies instead of balancing against their separation force.
        const cross = pDirX * ody - pDirY * odx;
        u.arrivalAvoidSide ||=
          Math.abs(cross) > 1 ? Math.sign(cross) : u.id % 2 ? 1 : -1;
        const side = u.arrivalAvoidSide;
        fSepX += -pDirY * side * speed * 0.8;
        fSepY += pDirX * side * speed * 0.8;
      }
      if (od < sepDist) {
        if (od > 0.1) {
          const rep = ((sepDist - od) / sepDist) * speed * 1.6;
          fSepX += (odx / od) * rep;
          fSepY += (ody / od) * rep;
        } else {
          fSepX += (u.id % 2 === 0 ? 1 : -1) * speed;
          fSepY += (u.id % 3 === 0 ? 1 : -1) * speed;
        }
      }
    }
    if (distToGoal < 24) {
      const f = Math.max(0.15, distToGoal / 24);
      fSepX *= f;
      fSepY *= f;
    }

    // --- 5. Obstacle Avoidance Force (avoid terrain boundaries & impassable obstacles) ---
    let fObsX = 0,
      fObsY = 0;
    if (u.x < 42) fObsX += ((42 - u.x) / 18) * speed * 1.8;
    else if (u.x > W - 42) fObsX -= ((u.x - (W - 42)) / 18) * speed * 1.8;
    if (u.y < 42) fObsY += ((42 - u.y) / 18) * speed * 1.8;
    else if (u.y > H - 42) fObsY -= ((u.y - (H - 42)) / 18) * speed * 1.8;

    const lookDist = Math.min(
      26,
      speed * 0.32 + 8,
      distToGoal < 30 && nav.clearLine(u, p)
        ? Math.max(0, distToGoal - stop)
        : Infinity,
    );
    const aheadX = u.x + pDirX * lookDist,
      aheadY = u.y + pDirY * lookDist;
    if (!groundFree(aheadX, aheadY, 6)) {
      const h = Math.atan2(pDirY, pDirX);
      const lx = u.x + Math.cos(h + 0.6) * lookDist,
        ly = u.y + Math.sin(h + 0.6) * lookDist;
      const rx = u.x + Math.cos(h - 0.6) * lookDist,
        ry = u.y + Math.sin(h - 0.6) * lookDist;
      const leftOk = groundFree(lx, ly, 6),
        rightOk = groundFree(rx, ry, 6);
      if (leftOk && !rightOk) {
        fObsX += -pDirY * speed * 1.4;
        fObsY += pDirX * speed * 1.4;
      } else if (rightOk && !leftOk) {
        fObsX += pDirY * speed * 1.4;
        fObsY += -pDirX * speed * 1.4;
      } else {
        fObsX += -pDirX * speed * 1.2;
        fObsY += -pDirY * speed * 1.2;
      }
    }

    // --- 6. Tactical / Stance Force (steer archers away from threats, melee towards enemies) ---
    let fTactX = 0,
      fTactY = 0;
    const stance = u.stance || (u.hold ? "hold" : "fight");
    if (stance === "fight" && !u.hold && !u.manualTarget) {
      if (u.type === "archer") {
        const threats = nearby(u, 170).filter(
          (e) =>
            e.team !== u.team &&
            e.team !== 2 &&
            e.hp > 0 &&
            e.type !== "civilian",
        );
        for (const threat of threats) {
          const tdx = u.x - threat.x,
            tdy = u.y - threat.y,
            td = Math.hypot(tdx, tdy);
          const kiteRange = threat.type === "knight" ? 170 : 135;
          if (td < kiteRange && td > 0.1) {
            const rep = ((kiteRange - td) / kiteRange) * speed * 1.5;
            fTactX += (tdx / td) * rep;
            fTactY += (tdy / td) * rep;
          }
        }
      } else if (u.type === "sword" || u.type === "knight") {
        let targetEnemy = u.target ? getObject(u.target) : null;
        if (
          !targetEnemy ||
          targetEnemy.team === u.team ||
          targetEnemy.hp <= 0
        ) {
          if (u.order?.attack || !u.order) {
            const foes = nearby(u, 220).filter(
              (e) =>
                e.team !== u.team &&
                e.team !== 2 &&
                e.hp > 0 &&
                e.type !== "civilian",
            );
            if (foes.length) {
              targetEnemy = foes.sort(
                (a, b) => distance(a, u) - distance(b, u),
              )[0];
            }
          }
        }
        if (targetEnemy) {
          const tdx = targetEnemy.x - u.x,
            tdy = targetEnemy.y - u.y,
            td = Math.hypot(tdx, tdy);
          const combatRange = TYPES[u.type].range + (targetEnemy.kind ? 15 : 6);
          if (td > combatRange && td < 240) {
            const pull = Math.min(
              speed * 1.3,
              speed * ((td - combatRange) / 80 + 0.3),
            );
            fTactX += (tdx / td) * pull;
            fTactY += (tdy / td) * pull;
          }
        }
      }
      if (u.order && !u.order.attack && distToGoal < 30) {
        const fade = distToGoal / 30;
        fTactX *= fade;
        fTactY *= fade;
      }
    }

    // --- Combine Forces into Smooth Velocity ---
    let desVx = fPathX + fSepX + fCohX + fAlignX + fObsX + fTactX;
    let desVy = fPathY + fSepY + fCohY + fAlignY + fObsY + fTactY;
    const desMag = Math.hypot(desVx, desVy);
    if (desMag > baseSpeed) {
      desVx = (desVx / desMag) * baseSpeed;
      desVy = (desVy / desMag) * baseSpeed;
    }
    u.vx = (u.vx || 0) * 0.5 + desVx * 0.5;
    u.vy = (u.vy || 0) * 0.5 + desVy * 0.5;
    const vMag = Math.hypot(u.vx, u.vy);
    if (vMag > baseSpeed) {
      u.vx = (u.vx / vMag) * baseSpeed;
      u.vy = (u.vy / vMag) * baseSpeed;
    }

    // --- Integrate Position with Slide on Collision ---
    let nx = u.x + u.vx * dt,
      ny = u.y + u.vy * dt;
    if (!groundFree(nx, ny, 6)) {
      if (groundFree(nx, u.y, 6)) {
        ny = u.y;
        u.vy = 0;
      } else if (groundFree(u.x, ny, 6)) {
        nx = u.x;
        u.vx = 0;
      } else {
        const heading = Math.atan2(u.vy || pDirY, u.vx || pDirX);
        const stepLen = Math.max(0.1, Math.min(d, speed * dt));
        let turned = false;
        for (const turn of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6]) {
          const tx = u.x + Math.cos(heading + turn) * stepLen;
          const ty = u.y + Math.sin(heading + turn) * stepLen;
          if (groundFree(tx, ty, 6)) {
            nx = tx;
            ny = ty;
            turned = true;
            break;
          }
        }
        if (!turned) {
          nx = u.x;
          ny = u.y;
          u.vx = 0;
          u.vy = 0;
        }
      }
    }

    if (groundFree(nx, ny, 6)) {
      if (nx !== u.x || ny !== u.y) {
        u.angle = Math.atan2(ny - u.y, nx - u.x);
        u.x = nx;
        u.y = ny;
      }
      u.moving = true;
      if (visualActive(u)) u.anim += dt * 10;
      u.stuck = 0;
      if (
        u.path[0] &&
        distance(u, u.path[0]) < reachDist &&
        (u.path.length < 2 || nav.clearLine(u, u.path[1]))
      )
        u.path.shift();
      if (distance(u, p) < stop) {
        u.moving = false;
        u.vx = 0;
        u.vy = 0;
        return true;
      }
    } else {
      u.stuck = (u.stuck || 0) + dt;
    }
    return false;
  }
  const actionTurns = new Map();
  function selectedStructures(predicate = () => true) {
    return state.buildings.filter(
      (b) =>
        b.team === 0 &&
        b.hp > 0 &&
        (selectedBuildings.has(b.id) || selectedBuilding === b.id) &&
        predicate(b),
    );
  }
  function nextStructure(key, buildings, advance = false) {
    if (!buildings.length) return null;
    const last = actionTurns.get(key);
    const index = buildings.findIndex((b) => b.id === last);
    let b = buildings[(index + 1) % buildings.length];
    if (
      index < 0 &&
      (selectedBuilding === last || selectedBuildings.has(last))
    ) {
      const lastPosition = state.buildings.findIndex(
        (item) => item.id === last,
      );
      b =
        buildings.find(
          (item) => state.buildings.indexOf(item) > lastPosition,
        ) || buildings[0];
    }
    if (advance) actionTurns.set(key, b.id);
    return b;
  }
  function producerFor(type) {
    const kind = TYPES[type].producer;
    const selectedProducer = nextStructure(
      "train:" + type,
      selectedStructures(
        (b) => b.kind === kind && b.progress >= 1 && b.queue.length < 8,
      ),
    );
    if (selectedStructures().length) return selectedProducer;
    return (
      selectedProducer ||
      completeBuildings(kind).sort((a, b) => a.queue.length - b.queue.length)[0]
    );
  }
  function recruit(type, assignedProducer = null) {
    if (!playable()) return false;
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
    actionTurns.set("train:" + type, b.id);
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
      b = nextStructure(
        "research",
        selectedStructures(
          (b) => b.kind === t.producer && b.progress >= 1 && b.queue.length < 8,
        ),
      );
    if (!b || !afford(t.cost)) {
      toast("Research needs its completed structure and the listed resources.");
      return false;
    }
    pay(t.cost);
    actionTurns.set("research", b.id);
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
    if (!playable() || kind === "gate") return;
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
      `Place ${BUILDINGS[kind].name.toLowerCase()} on clear, explored ground. Unfinished foundations provide no vision. ${["wall", "bastionwall"].includes(kind) ? "Drag to lay a continuous wall; bends join automatically. " : ""}Right-click or Escape cancels.`,
    );
    updateUI();
  }
  function placementSpec(
    kind,
    team = 0,
    rotation = team === 0 ? placementRotation : 0,
  ) {
    const spec = BUILDINGS[kind];
    return kind === "gate" && rotation === 90
      ? { ...spec, w: spec.h, h: spec.w }
      : spec;
  }
  function validSite(
    kind,
    p,
    team = 0,
    rotation = team === 0 ? placementRotation : 0,
    footprint = null,
  ) {
    if (team === 0 ? !playerRemembers(p) : !enemyFog.remembers(p)) return false;
    const t = footprint || placementSpec(kind, team, rotation);
    if (
      state.units.some(
        (u) =>
          u.hp > 0 &&
          Math.abs(u.x - p.x) < t.w / 2 + 10 &&
          Math.abs(u.y - p.y) < t.h / 2 + 10,
      )
    )
      return false;
    const minBorder = ["wall", "bastionwall"].includes(kind) ? 0 : 32;
    if (
      p.x - t.w / 2 < minBorder ||
      p.y - t.h / 2 < minBorder ||
      p.x + t.w / 2 > W - minBorder ||
      p.y + t.h / 2 > H - minBorder
    )
      return false;
    if (["wall", "bastionwall"].includes(kind)) {
      // A masonry end may meet a cliff or shore; its center must remain on land.
      if (!groundFree(p.x, p.y, 0, null, "all")) return false;
    } else {
      for (const dx of [-t.w / 2, 0, t.w / 2])
        for (const dy of [-t.h / 2, 0, t.h / 2])
          if (!groundFree(p.x + dx, p.y + dy, 13, null, "all")) return false;
    }
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
    const minX = 32,
      maxX = Math.max(minX, Math.floor((W - 16) / 32) * 32),
      minY = 32,
      maxY = Math.max(minY, Math.floor((H - 16) / 32) * 32);
    const snap = (p) => ({
      x: clamp(Math.round(p.x / 32) * 32, minX, maxX),
      y: clamp(Math.round(p.y / 32) * 32, minY, maxY),
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
    const wallKind = placement === "bastionwall" ? "bastionwall" : "wall";
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
      if (!validSite("wall", p) || !afford(BUILDINGS[wallKind].cost)) continue;
      pay(BUILDINGS[wallKind].cost);
      const next = points[i + 1] || points[i - 1] || { x: p.x + 32, y: p.y };
      const wall = makeBuilding(wallKind, 0, p.x, p.y, 0, {
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
    placement = append ? wallKind : null;
    mode = append ? "build" : "move";
    updateUI();
    toast(
      projects.length
        ? `${projects.length} wall sections planned. Villagers build along the line automatically.`
        : "No clear ground or insufficient stone for this wall.",
    );
  }
  function straightWall(b) {
    if (b.kind !== "wall" || b.progress < 1 || b.hp <= 0 || b.team !== 0)
      return false;
    const links = Object.values(b.links || {});
    if (links.length > 2) return false;
    return (
      links.length < 2 ||
      (Math.abs(links[0].x * links[1].y - links[0].y * links[1].x) < 1 &&
        links[0].x * links[1].x + links[0].y * links[1].y < 0)
    );
  }
  function availableWall(b) {
    return (
      b.kind === "wall" &&
      b.team === 0 &&
      b.hp > 0 &&
      b.progress >= 1 &&
      !b.queue.length &&
      !b.upgradeOwner
    );
  }
  function gatePartner(b, upgrading = false) {
    if (!straightWall(b) || (!upgrading && !availableWall(b))) return null;
    return state.buildings.find(
      (other) =>
        other.id !== b.id &&
        straightWall(other) &&
        (upgrading ? other.upgradeOwner === b.id : availableWall(other)) &&
        Math.abs(other.x - b.x) <= 40 &&
        Math.abs(other.y - b.y) <= 40 &&
        distance(other, b) >= 24 &&
        Object.values(b.links || {}).some(
          (p) =>
            Math.abs(p.x * 2 - (other.x - b.x)) < 1 &&
            Math.abs(p.y * 2 - (other.y - b.y)) < 1,
        ),
    );
  }
  function wallUpgradeCost(kind, first = null) {
    const walls =
      kind === "gate" ? [first, first ? gatePartner(first) : null] : [first];
    return Object.fromEntries(
      Object.entries(
        BUILDINGS[
          kind === "gate" && walls.some((b) => b?.fortified)
            ? "bastiongate"
            : kind
        ].cost,
      ).map(([r, n]) => [
        r,
        Math.max(
          0,
          n -
            walls.reduce(
              (sum, wall) =>
                sum +
                (BUILDINGS[wall?.fortified ? "bastionwall" : "wall"].cost[r] ||
                  0),
              0,
            ),
        ),
      ]),
    );
  }
  function queueWallUpgrade(kind) {
    if (!playable()) return;
    const first = nextStructure(
      "wall-upgrade:" + kind,
      selectedStructures(
        (b) => availableWall(b) && (kind !== "gate" || gatePartner(b)),
      ),
    );
    if (!first) return;
    const cost = wallUpgradeCost(kind, first);
    if (!afford(cost)) {
      toast("Not enough resources for this wall upgrade.");
      return;
    }
    const partner = kind === "gate" ? gatePartner(first) : null;
    pay(cost);
    first.queue.push({
      kind: "building-upgrade",
      targetKind: kind,
      targetSpec:
        kind === "gate" && (first.fortified || partner?.fortified)
          ? "bastiongate"
          : kind,
      partnerId: partner?.id || null,
      time: 0,
      duration:
        BUILDINGS[
          kind === "gate" && (first.fortified || partner?.fortified)
            ? "bastiongate"
            : kind
        ].time,
      cost,
    });
    if (partner) partner.upgradeOwner = first.id;
    actionTurns.set("wall-upgrade:" + kind, first.id);
    toast((kind === "gate" ? "Gatehouse" : "Guard tower") + " upgrade queued.");
    updateUI();
  }
  function releaseWallUpgrade(b, item) {
    const partner = getObject(item?.partnerId);
    if (partner?.upgradeOwner === b.id) delete partner.upgradeOwner;
  }
  function completeWallUpgrade(first, item) {
    if (item.targetKind === "tower") {
      const health = first.hp / first.maxHp;
      first.wallAttachment = {
        x: first.x,
        y: first.y,
        w: first.w,
        h: first.h,
        wallAngle: first.wallAngle,
        fortified: !!first.fortified,
        links: first.links,
      };
      Object.assign(first, {
        kind: "tower",
        w: BUILDINGS.tower.w,
        h: BUILDINGS.tower.h,
        r: Math.max(BUILDINGS.tower.w, BUILDINGS.tower.h) / 2,
        maxHp: Math.max(first.maxHp, BUILDINGS.tower.hp),
        guardCooldown: 1,
      });
      first.hp = first.maxHp * health;
      first.spent = { ...first.spent };
      for (const [r, n] of Object.entries(item.cost))
        first.spent[r] = (first.spent[r] || 0) + n;
      rebuildNavigation();
      updateUI();
      toast("Wall upgraded to a guard tower.");
      return;
    }
    const second = getObject(item.partnerId);
    if (
      !second ||
      second.hp <= 0 ||
      !straightWall(first) ||
      !straightWall(second)
    ) {
      releaseWallUpgrade(first, item);
      pay(item.cost, -1);
      return;
    }
    const segments = [first, second].map((b) => ({
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      wallAngle: b.wallAngle,
      fortified: !!b.fortified,
      links: JSON.parse(JSON.stringify(b.links || {})),
    }));
    const gate = makeBuilding(
      "gate",
      0,
      (first.x + second.x) / 2,
      (first.y + second.y) / 2,
      1,
      {
        gateSegments: segments,
        gateAngle: Math.atan2(second.y - first.y, second.x - first.x),
        closed: true,
        rotation: 0,
      },
    );
    gate.w = Math.abs(first.x - second.x) + 32;
    gate.h = Math.abs(first.y - second.y) + 32;
    gate.r = Math.hypot(gate.w, gate.h) / 2;
    gate.maxHp = Math.max(gate.maxHp, first.maxHp, second.maxHp);
    if (segments.some((part) => part.fortified)) {
      gate.bastionGate = true;
      gate.fortified = true;
      gate.maxHp = BUILDINGS.bastiongate.hp;
    }
    gate.hp =
      (gate.maxHp * (first.hp / first.maxHp + second.hp / second.maxHp)) / 2;
    state.buildings = state.buildings.filter(
      (b) => b.id !== first.id && b.id !== second.id,
    );
    state.buildings.push(gate);
    const wasSelected =
      selectedBuildings.has(first.id) ||
      selectedBuildings.has(second.id) ||
      selectedBuilding === first.id ||
      selectedBuilding === second.id;
    selectedBuildings.delete(first.id);
    selectedBuildings.delete(second.id);
    if (wasSelected) selectedBuildings.add(gate.id);
    if (selectedBuilding === first.id || selectedBuilding === second.id)
      selectedBuilding = gate.id;
    rebuildNavigation();
    updateUI();
    toast("Gatehouse upgrade complete.");
  }
  function destroySelectedBuilding() {
    if (!playable()) return;
    const b = nextStructure(
      "destroy",
      selectedStructures((b) => !b.cityCenter),
      true,
    );
    if (!b) return;
    // Use combat destruction so rubble, navigation, and capital victory rules agree.
    for (const item of b.queue) releaseWallUpgrade(b, item);
    damage(b, b.maxHp * 100, { team: 0 }, true);
    if (b.hp <= 0) {
      selectedBuildings.delete(b.id);
      selectedBuilding = [...selectedBuildings][0] || null;
    }
    rebuildNavigation();
    updateUI();
  }
  function wallConnections(b, curtain) {
    const links = {};
    for (const other of curtain)
      if (
        other.id !== b.id &&
        other.team === b.team &&
        other.hp > 0 &&
        ["wall", "gate"].includes(other.kind)
      ) {
        const dx = other.x - b.x,
          dy = other.y - b.y;
        // Reject distant walls before scanning for an intervening corner.
        if (
          Math.abs(dx) > Math.max(32, (b.w + other.w) / 2) + 8 ||
          Math.abs(dy) > Math.max(32, (b.h + other.h) / 2) + 8
        )
          continue;
        if (
          Math.abs(dx) > 12 &&
          Math.abs(dy) > 12 &&
          curtain.some(
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
          if (key)
            links[key] = {
              x: b.fortified && other.gateSegments ? 0 : dx / 2,
              y: b.fortified && other.gateSegments ? 0 : dy / 2,
            };
        }
      }
    const neighbors = Object.values(links);
    const directions =
      neighbors.length === 1
        ? [Math.atan2(-neighbors[0].y, -neighbors[0].x)]
        : neighbors.length === 0 && Number.isFinite(b.wallAngle)
          ? [b.wallAngle, b.wallAngle + Math.PI]
          : [];
    for (const angle of directions) {
      for (let length = 16; length <= 40; length += 2) {
        const x = b.x + Math.cos(angle) * length,
          y = b.y + Math.sin(angle) * length;
        const local = obstacleIndex
          ? obstacleIndex.decorations.get(
              Math.floor(x / 128) + "," + Math.floor(y / 128),
            ) || []
          : decorations;
        const terrainBlocked =
          !landFree(x, y, 0) ||
          local.some(
            (d) =>
              d.block &&
              (d.kind === "rockmass"
                ? rockBlocks(d, x, y, 0)
                : Math.hypot(x - d.x, y - d.y) < d.r),
          );
        if (!terrainBlocked) continue;
        const dx = Math.cos(angle) * length,
          dy = Math.sin(angle) * length;
        const key =
          (dy < -12 ? "n" : dy > 12 ? "s" : "") +
          (dx < -12 ? "w" : dx > 12 ? "e" : "");
        if (key) links[key] = { x: dx, y: dy, terrain: true };
        break;
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
  function cancelSiegeTargeting() {
    if (!playable()) return;
    for (const u of friendUnits().filter(
      (u) => selected.has(u.id) && u.type === "trebuchet",
    )) {
      u.fireTarget = null;
      u.target = null;
      u.manualTarget = false;
    }
    for (const b of selectedStructures(
      (b) => b.kind === "greatengine" && b.progress >= 1,
    )) {
      b.fireTarget = null;
      b.attackTarget = null;
    }
    updateUI();
    toast("Siege targeting cancelled. Engines resume watching for enemies.");
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
    const targets = [
      ...new Map(
        selectedStructures().map((b) => {
          const target = b.upgradeOwner ? getObject(b.upgradeOwner) || b : b;
          return [target.id, target];
        }),
      ).values(),
    ];
    const removed = new Set();
    let cancelled = 0;
    const cancellable = targets.filter((b) => b.progress < 1 || b.queue.length);
    const target = nextStructure("cancel", cancellable, true);
    for (const b of target ? [target] : []) {
      if (b.progress < 1) {
        for (const [r, n] of Object.entries(b.spent))
          state.resources[r] += n * (1 - b.progress) * 0.75;
        removed.add(b.id);
        cancelled++;
      } else if (b.queue.length) {
        const item = b.queue.shift();
        releaseWallUpgrade(b, item);
        pay(item.cost, -1);
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
          (b.team === 0 || playerSees(b)) &&
          Art.hitStructure(b, p, 6),
      ),
      enemy =
        state.units
          .filter(
            (u) =>
              u.team !== 0 &&
              u.team !== 2 &&
              u.hp > 0 &&
              playerSees(u) &&
              Art.hitUnit(u, p, state.time, 24),
          )
          .sort((a, b) => distance(a, p) - distance(b, p))[0] ||
        (building &&
        building.team !== 0 &&
        building.team !== 2 &&
        !building.cityCenter &&
        playerSees(building)
          ? building
          : null);
    const escort = friendUnits().find(
      (u) =>
        ["pilgrim", "merchant"].includes(u.type) &&
        Art.hitUnit(u, p, state.time, 35),
    );
    const units = friendUnits().filter(
      (u) => selected.has(u.id) && !["pilgrim", "merchant"].includes(u.type),
    );
    const greatEngines = selectedStructures(
      (b) => b.kind === "greatengine" && b.progress >= 1,
    );
    for (const engine of greatEngines) {
      const d = distance(engine, enemy || p),
        spec = BUILDINGS.greatengine;
      if (d < spec.minRange || d > spec.range) {
        toast("Outside great engine range (320-2200).");
        continue;
      }
      engine.attackTarget = enemy?.id || null;
      engine.fireTarget = enemy ? null : { x: p.x, y: p.y };
      sound("attack", engine);
      toast(
        "Great siege engine target set. The platform will turn and fire when ready.",
      );
    }
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
          : greatEngines.length
            ? "Right-click a target within great engine range (320-2200)."
            : "This building cannot train troops and has no rally point.",
      );
      return;
    }
    if (enemy && units.some((u) => TYPES[u.type].damage > 0))
      sound("attack", p);
    for (const u of units.filter(
      (u) => u.type === "trebuchet" && u.deployment !== "packed",
    )) {
      u.autoScout = null;
      u.target = null;
      u.manualTarget = false;
      if (enemy) u.stance = "fight";
      if (u.stance === "stand-down") {
        u.fireTarget = null;
        toast("This engine is standing down. Choose Hold or Fight to fire.");
        continue;
      }
      if (u.deployment === "deployed" || u.deployment === "setting-up") {
        const d = distance(u, enemy || p);
        if (d >= 180 && d <= 690) {
          u.fireTarget = enemy ? null : { ...p };
          u.target = enemy?.id || null;
          u.manualTarget = !!enemy;
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
          (u.type !== "worker" || (!node && !building)) &&
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
      cols = Math.max(1, Math.ceil(Math.sqrt(combat.length))),
      spacing = combat.some((u) =>
        ["knight", "trebuchet", "ram", "ballista"].includes(u.type),
      )
        ? 56
        : 32,
      sorted = [...combat].sort(
        (a, b) => TYPES[a.type].rank - TYPES[b.type].rank,
      ),
      formationId = ++uid,
      slots = [];
    sorted.forEach((u, i) => {
      u.autoScout = null;
      u.fireTarget = null;
      if (u.type === "worker") {
        u.job = null;
        if (!append) u.buildQueue = [];
      }
      const row = Math.floor(i / cols),
        column = (i % cols) - (cols - 1) / 2,
        extra =
          attack || enemy
            ? u.type === "chaplain"
              ? 100
              : u.type === "trebuchet"
                ? 170
                : 0
            : 0;
      let goal = marchPoint({
        x: p.x + side.x * column * spacing - front.x * (row * spacing + extra),
        y: p.y + side.y * column * spacing - front.y * (row * spacing + extra),
      });
      if (u.type === "knight" && (attack || enemy)) {
        const flank = i % 2 ? -1 : 1;
        goal = findFree({
          x: goal.x + side.x * flank * 55,
          y: goal.y + side.y * flank * 55,
        });
      }
      goal = reserveSlot(goal, slots, marchPoint(p));
      const order = {
        x: goal.x,
        y: goal.y,
        attack: attack || !!enemy || !!escort,
        formation: formationId,
      };
      u.target = u.type === "chaplain" ? null : enemy?.id || null;
      if (enemy) u.stance = "fight";
      u.manualTarget = !!enemy && u.type !== "chaplain";
      u.hold = false;
      u.path = [];
      u.pathGoal = null;
      u.pathRequest = null;
      u.stuck = 0;
      u.arrivalAvoidSide = null;
      u.formation = { id: formationId, x: goal.x, y: goal.y };
      u.marchOffset = { x: goal.x - p.x, y: goal.y - p.y };
      u.order = order;
    });
    // Nearby troops on the same clear ground form separate route-sharing companies.
    const remaining = new Set(sorted);
    while (remaining.size) {
      const members = [[...remaining][0]];
      remaining.delete(members[0]);
      for (let i = 0; i < members.length; i++)
        for (const other of remaining)
          if (
            distance(members[i], other) <= 240 &&
            nav.clearLine(members[i], other)
          ) {
            remaining.delete(other);
            members.push(other);
          }
      const id = ++uid;
      const mean = (points) =>
        points.reduce(
          (c, p) => ({
            x: c.x + p.x / points.length,
            y: c.y + p.y / points.length,
          }),
          { x: 0, y: 0 },
        );
      const anchor = mean(members),
        destination = marchPoint(p);
      for (const u of members) {
        u.order.formation = id;
        u.formation.id = id;
        u.sharedRouteRevision = null;
      }
      state.formations.push({
        id,
        members: members.map((u) => u.id),
        anchor,
        routeStart: findFree(anchor),
        destination: findFree(destination),
        path: [],
        sharedRoute: true,
        routeReady: false,
        revision: nav.revision,
        speed: Math.min(...members.map((u) => TYPES[u.type].speed)),
        arrived: false,
        wait: 0,
        escortId: escort?.id || null,
      });
    }
    for (const u of units.filter(
      (u) => u.type === "worker" && !combat.includes(u),
    )) {
      if (!append) u.buildQueue = [];
      u.hold = false;
      if (node && (!building || building.progress >= 1)) {
        assignGather(u, node.kind === "farm" ? "food" : node.kind, node);
      } else if (
        building?.team === 0 &&
        building.progress >= 1 &&
        BUILDINGS[building.kind].drop
      ) {
        if (!assignDepotGather(u, building)) {
          u.job = null;
          u.order = null;
          toast("No explored resource accepted by this depot is available.");
        }
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
    if (!enemy) sound("order");
    updateUI();
  }
  function selectArmy() {
    selected = new Set(fighters().map((u) => u.id));
    selectedBuilding = null;
    selectedBuildings.clear();
    setTab("army");
    updateUI();
  }
  function selectWorkers() {
    selected = new Set(workers().map((u) => u.id));
    selectedBuilding = null;
    selectedBuildings.clear();
    setTab("settlement");
    updateUI();
  }
  function idleWorker() {
    const u = workers().find((u) => !u.job && !u.order);
    if (u) {
      selected = new Set([u.id]);
      selectedBuilding = null;
      selectedBuildings.clear();
      camera.x = u.x;
      camera.y = u.y;
      setTab("settlement");
      updateView();
      updateUI();
    } else toast("All villagers are working.");
  }
  function setStance(value) {
    if (!playable() || !["fight", "hold", "stand-down"].includes(value)) return;
    for (const u of fighters().filter((u) => selected.has(u.id))) {
      u.stance = value;
      u.hold = false;
      u.target = null;
      u.manualTarget = false;
      if (value === "stand-down") u.fireTarget = null;
    }
    updateUI();
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
        u.stance = u.type === "worker" ? u.stance : "hold";
        u.hold = u.type === "worker";
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
    if (target.kind === "wall" && Number.isFinite(target.wallAngle))
      return Math.max(
        0,
        Math.min(
          ...wallArms(target).map((arm) =>
            segmentDistance(u, target, {
              x: target.x + arm.x,
              y: target.y + arm.y,
            }),
          ),
        ) - (target.fortified ? 24 : 15),
      );
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
    if (!BUILDINGS[b.kind].drop) {
      const next = state.buildings
        .filter(
          (c) =>
            c.team === u.team &&
            c.hp > 0 &&
            c.progress < 1 &&
            distance(c, b) <= 420,
        )
        .sort((a, c) => distance(a, u) - distance(c, u))
        .find((c) => !edgePoint(u, c, 12).unreachable);
      if (next) {
        u.job = { kind: "build", target: next.id };
        u.pathTimer = 0;
        u.pathRequest = null;
        return;
      }
    }
    if (b.kind === "farm") {
      if (!assignGather(u, "food", b)) assignGather(u, "food");
      return;
    }
    if (BUILDINGS[b.kind].drop) assignDepotGather(u, b);
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
    if ((u.stance || "fight") !== "fight") {
      if (u.order) marchUnit(u, dt);
      return;
    }
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
          const arms =
            b.kind === "wall" && Number.isFinite(b.wallAngle)
              ? wallArms(b)
              : null;
          const halfW = arms
            ? Math.max(...arms.map((a) => Math.abs(a.x))) +
              (b.fortified ? 24 : 15)
            : b.w / 2;
          const halfH = arms
            ? Math.max(...arms.map((a) => Math.abs(a.y))) +
              (b.fortified ? 24 : 15)
            : b.h / 2;
          for (let i = 0; i < 24; i++) {
            const angle = (i * Math.PI) / 12,
              cx = Math.cos(angle),
              cy = Math.sin(angle);
            const radius =
              Math.min(
                halfW / Math.max(0.01, Math.abs(cx)),
                halfH / Math.max(0.01, Math.abs(cy)),
              ) + 10;
            const p = { x: b.x + cx * radius, y: b.y + cy * radius };
            if (groundFree(p.x, p.y, 6)) candidates.push(p);
          }
          candidates.sort((a, b) => distance(u, a) - distance(u, b));
          const point = candidates.find((p) => routePossible(u, p));
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
          emitParticle({
            x: u.x + Math.cos(u.angle) * 15,
            y: u.y + Math.sin(u.angle) * 15,
            vx: Math.cos(i * 2) * 24,
            vy: Math.sin(i * 2) * 24,
            t: 0,
            life: 0.55,
            sprite: "spark_01",
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
        const progress = Math.min(
          1 - b.progress,
          dt / BUILDINGS[b.fortified ? "bastionwall" : b.kind].time,
        );
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
          assignGather(u, job.resource, null, job.cluster, job.depot);
          return;
        }
      }
      const capacity = 16;
      if (job.phase === "deliver" || u.carry >= capacity) {
        job.phase = "deliver";
        const preferred = getObject(job.depot);
        const drop =
          preferred?.team === u.team &&
          preferred.hp > 0 &&
          preferred.progress >= 1 &&
          BUILDINGS[preferred.kind].drop?.includes(
            u.carryType || job.resource,
          ) &&
          !edgePoint(u, preferred, 20).unreachable
            ? preferred
            : completeBuildings(null, u.team)
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
        assignGather(u, job.resource, null, job.cluster, job.depot);
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
          if (visualActive(u)) u.anim += dt * 10;
          return;
        }
        if (farm || surfaceDistance(u, target) > 60) {
          moveUnit(u, farm ? workSpot : edgePoint(u, target, 12), dt);
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
            emitParticle({
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
    if (u.stance === "stand-down") return null;
    const mayPursue = (u.stance || "fight") === "fight" && !u.hold;
    const enemies = nearby(u, r).filter(
      (e) =>
        e.team !== u.team &&
        e.team !== 2 &&
        e.type !== "civilian" &&
        (mayPursue || surfaceDistance(u, e) <= TYPES[u.type].range + 5) &&
        observerSees(u, e),
    );
    let best = null,
      score = Infinity;
    for (const e of enemies) {
      if (
        (u.team === 1 || u.cityDefender) &&
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
      nearbyStructures(u, r)
        .filter(
          (b) =>
            b.team !== u.team &&
            b.team !== 2 &&
            !b.cityCenter &&
            b.hp > 0 &&
            distance(u, b) < r + b.r &&
            observerSees(u, b) &&
            (mayPursue || surfaceDistance(u, b) <= TYPES[u.type].range + 15),
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
      siege: u.type === "ballista",
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
    if (
      target.cityCenter &&
      !state.cities?.find((c) => c.id === target.city)?.captured
    )
      return;
    const fortified =
      target.kind === "wall" ||
      target.kind === "gate" ||
      target.gate ||
      target.wallAttachment;
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
      sound("collapse", target);
      for (let i = 0; i < 24; i++)
        emitParticle({
          x: target.x,
          y: target.y,
          vx: (Math.random() - 0.5) * 190,
          vy: (Math.random() - 0.5) * 190,
          t: 0,
          life: 1,
          sprite: "dirt_01",
          growth: 1.2,
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
        rank: target.rank || 0,
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
        emitParticle({
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
      emitParticle({
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
    if (u.stance === "stand-down") {
      u.target = null;
      u.fireTarget = null;
      if (u.deployment === "packed" && u.order) marchUnit(u, dt);
      return;
    }
    const commanded = u.manualTarget ? getObject(u.target) : null;
    if (
      u.manualTarget &&
      (!commanded || commanded.team === u.team || commanded.team === 2)
    ) {
      u.manualTarget = false;
      u.target = null;
      u.order = null;
      u.pendingOrder = null;
      u.fireTarget = null;
    }
    let target = u.target ? getObject(u.target) : null;
    if (
      target?.team === u.team ||
      target?.team === 2 ||
      (target && !u.manualTarget && !observerSees(u, target))
    )
      target = null;
    if (u.deployment === "deployed") {
      if (u.hold) return;
      if (u.fireTarget) target = u.fireTarget;
      if (
        target &&
        u.manualTarget &&
        (distance(u, target) < 180 || distance(u, target) > 690)
      ) {
        if (u.team === 0) return;
        u.deployment = "packing";
        u.deployTimer = 4;
        u.pendingOrder = { x: target.x, y: target.y, attack: true };
        return;
      }
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
                observerSees(u, b) &&
                distance(u, b) < TYPES.trebuchet.range &&
                distance(u, b) > 180,
            )
            .sort((a, b) => distance(a, u) - distance(b, u))[0] ||
          nearby(u, 690)
            .filter(
              (e) =>
                e.team !== u.team &&
                e.team !== 2 &&
                observerSees(u, e) &&
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
      if (
        u.order.attack &&
        (u.team === 1 || u.manualTarget) &&
        (u.stance || "fight") === "fight"
      ) {
        target = target || acquire(u, 690);
        if (
          target &&
          distance(u, target) < 620 &&
          distance(u, target) > 210 &&
          u.team !== 0
        ) {
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
    if (
      u.stance === "stand-down" &&
      !["chaplain", "trebuchet"].includes(u.type)
    ) {
      u.target = null;
      u.manualTarget = false;
      if (u.order) marchUnit(u, dt);
      return;
    }
    if (u.type === "chaplain") {
      supportAI(u, dt);
      return;
    }
    if (u.type === "trebuchet") {
      siegeAI(u, dt);
      return;
    }
    const commanded = u.manualTarget ? getObject(u.target) : null;
    if (
      u.manualTarget &&
      (!commanded || commanded.team === u.team || commanded.team === 2)
    ) {
      u.manualTarget = false;
      u.target = null;
      u.order = null;
      u.pendingOrder = null;
      u.fireTarget = null;
    }
    let target = u.target ? getObject(u.target) : null;
    if (
      target &&
      (target.team === u.team ||
        target.team === 2 ||
        (!u.manualTarget && !observerSees(u, target)) ||
        (distance(u, target) > 650 && !u.manualTarget))
    )
      target = null;
    const autonomous = (u.stance || "fight") === "fight" && !u.hold;
    if (
      !autonomous &&
      !u.manualTarget &&
      target &&
      surfaceDistance(u, target) > TYPES[u.type].range + (target.kind ? 15 : 5)
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
        target = acquire(u, !autonomous ? TYPES[u.type].range + 35 : r);
      if (
        !autonomous &&
        target &&
        surfaceDistance(u, target) >
          TYPES[u.type].range + (target.kind ? 15 : 5)
      )
        target = null;
    }
    if (target && u.type === "archer")
      u.aimAngle = Math.atan2(target.y - u.y, target.x - u.x);
    if (target && u.type === "archer" && autonomous && !u.manualTarget) {
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
      } else if (autonomous || u.manualTarget) {
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
    } else if (
      autonomous &&
      (u.team === 1 || u.cityDefender) &&
      u.home &&
      distance(u, u.home) > 60
    )
      moveUnit(u, u.home, dt);
  }
  function fire(u, target) {
    if (u.stance === "stand-down") return;
    u.aimAngle = Math.atan2(target.y - u.y, target.x - u.x);
    u.angle = u.aimAngle;
    u.cooldown = TYPES[u.type].cooldown;
    u.strike = 0.35;
    let n = TYPES[u.type].damage * (1 + (u.rank || 0) * 0.25);

    if (u.blessed > 0) n *= 1.25;
    if (stock(u.team).food < 1) n *= 0.75;
    if (nearby(u, 180).some((a) => a.team === u.team && a.type === "standard"))
      n *= 1.12;
    if (u.type === "archer" || u.type === "ballista") projectile(u, target, n);
    else damage(target, n, u, u.type === "ram" || u.type === "ballista");
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
  function defensivePlots(base, radius = 640) {
    const plots = [],
      seen = new Set(),
      snap = (n) => Math.round(n / 32) * 32;
    const phase = ((base.id || 0) % 7) * 0.035;
    for (const [layer, scale] of (base.fortressShape?.layers === 3
      ? [1, 0.72, 0.44]
      : radius >= 600
        ? [1, 0.64]
        : [1]
    ).entries()) {
      const ring = Array.from({ length: 16 }, (_, i) => {
        const angle = (i * Math.PI) / 8 + phase,
          bulge = i % 4 === 0 ? 1.13 : i % 2 ? 0.94 : 1.04;
        return {
          x: snap(
            clamp(
              base.x +
                Math.cos(angle) *
                  radius *
                  scale *
                  bulge *
                  (base.fortressShape?.x || 1),
              128,
              W - 128,
            ),
          ),
          y: snap(
            clamp(
              base.y +
                Math.sin(angle) *
                  radius *
                  scale *
                  bulge *
                  (base.fortressShape?.y || 1),
              128,
              H - 128,
            ),
          ),
        };
      });
      for (let edge = 0; edge < ring.length; edge++) {
        const a = ring[edge],
          b = ring[(edge + 1) % ring.length],
          points = wallLine(a, b),
          angle = Math.atan2(b.y - a.y, b.x - a.x),
          middle = Math.floor(points.length / 2);
        for (let i = 0; i < points.length; i++) {
          const p = points[i],
            key = p.x + "," + p.y;
          if (seen.has(key)) continue;
          seen.add(key);
          if (edge % 4 === 1 && i === middle && points[i + 1]) {
            const q = points[++i];
            seen.add(q.x + "," + q.y);
            plots.push({
              kind: "gate",
              hp: 18000,
              maxHp: 18000,
              bastionGate: true,
              x: (p.x + q.x) / 2,
              y: (p.y + q.y) / 2,
              gateAngle: angle,
              gateSegments: [p, q].map((part) => ({
                ...part,
                w: 32,
                h: 32,
                wallAngle: angle,
                fortified: true,
                links: {
                  forward: { x: (q.x - p.x) / 2, y: (q.y - p.y) / 2 },
                  backward: { x: (p.x - q.x) / 2, y: (p.y - q.y) / 2 },
                },
              })),
              w: Math.abs(q.x - p.x) + 32,
              h: Math.abs(q.y - p.y) + 32,
              closed: false,
              defenceLayer: layer,
            });
          } else if (
            i === 0 ||
            (i % 10 === 5 && !(edge % 4 === 1 && Math.abs(i - middle) < 4))
          )
            plots.push({
              kind: "tower",
              ...p,
              hp: 11000,
              maxHp: 11000,
              w: 48,
              h: 48,
              wallAttachment: {
                ...p,
                w: 32,
                h: 32,
                fortified: true,
                wallAngle: angle,
                links: {},
              },
              defenceLayer: layer,
            });
          else
            plots.push({
              kind: "bastionwall",
              ...p,
              wallAngle: angle,
              defenceLayer: layer,
            });
        }
      }
    }
    return plots;
  }
  function enemyFortifications(base, ws) {
    const ai = state.enemy;
    ai.fortifications ||= {};
    ai.fortifications[base.id] ||= {
      plots: defensivePlots(
        base,
        state.mode !== "quickmatch" && base.id === state.capitals?.enemy
          ? 896
          : 640,
      ),
    };
    const fortification = ai.fortifications[base.id];
    const active = state.buildings.filter(
      (b) => b.team === 1 && b.defence && b.hp > 0 && b.progress < 1,
    );
    const builders = ws
      .filter(
        (u) =>
          !["build", "repair"].includes(u.job?.kind) &&
          u.fleeUntil <= state.time,
      )
      .sort((a, b) => distance(a, base) - distance(b, base))
      .slice(0, Math.max(1, Math.floor(ws.length / 4)));
    if (!builders.length || active.length >= 8) return;
    const ids = [];
    for (const p of fortification.plots) {
      if (ids.length >= 3 || ids.length + active.length >= 8) break;
      if (
        state.buildings.some(
          (b) => b.team === 1 && b.hp > 0 && distance(b, p) < 4,
        )
      )
        continue;
      if (!afford(BUILDINGS[p.kind].cost, 1)) continue;
      const spec = BUILDINGS[p.kind];
      if (
        !validSite(
          p.wallAttachment ? "wall" : p.kind,
          p,
          1,
          p.rotation || 0,
          p.w ? p : null,
        )
      )
        continue;
      pay(spec.cost, 1, 1);
      const b = makeBuilding(p.kind, 1, p.x, p.y, 0, {
        ...p,
        kind: p.kind === "bastionwall" ? "wall" : p.kind,
        defence: true,
      });
      if (p.maxHp) {
        b.maxHp = p.maxHp;
        b.hp = p.maxHp * 0.2;
      }
      state.buildings.push(b);
      ids.push(b.id);
      state.navDirty = true;
    }
    if (ids.length) queueConstruction(builders, ids, false);
    else {
      const survey = fortification.plots.find((p) => !enemyFog.remembers(p));
      const worker = builders.find((u) => !u.order);
      if (survey && worker) {
        const angle = Math.atan2(base.y - survey.y, base.x - survey.x);
        worker.job = null;
        worker.order = {
          ...findFree({
            x: survey.x + Math.cos(angle) * 80,
            y: survey.y + Math.sin(angle) * 80,
          }),
          attack: false,
        };
        worker.pathTimer = 0;
      }
    }
  }
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
    for (const u of army)
      if (u.garrisonBase && !getObject(u.garrisonBase)) {
        delete u.garrisonBase;
        u.home = null;
      }
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
    function build(kind, settlement = base) {
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
          p = {
            x: settlement.x + Math.cos(a) * r,
            y: settlement.y + Math.sin(a) * r,
          };
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
    if (
      state.time > 180 &&
      completeBuildings("towncenter", 1).length < 4 &&
      !state.buildings.some(
        (b) => b.team === 1 && b.kind === "towncenter" && b.progress < 1,
      ) &&
      ws.length >= 8
    ) {
      const resource = state.nodes
        .filter(
          (n) =>
            n.remaining > 0 &&
            enemyFog.remembers(n) &&
            completeBuildings("towncenter", 1).every(
              (b) => distance(b, n) > 1500,
            ),
        )
        .sort((a, b) => distance(a, base) - distance(b, base))[0];
      if (resource && afford(BUILDINGS.towncenter.cost, 1)) {
        for (let i = 0; i < 32; i++) {
          const p = {
            x: resource.x + Math.cos(i * 2.399) * 300,
            y: resource.y + Math.sin(i * 2.399) * 300,
          };
          if (!validSite("towncenter", p, 1)) continue;
          pay(BUILDINGS.towncenter.cost, 1, 1);
          const outpost = makeBuilding("towncenter", 1, p.x, p.y, 0);
          state.buildings.push(outpost);
          state.navDirty = true;
          queueConstruction(
            ws.filter((u) => u.job?.kind !== "build").slice(0, 3),
            [outpost.id],
            false,
          );
          break;
        }
      }
    }
    if (pop.cap - pop.used - pop.queued < 5) build("house");
    if (ws.length < plan.workers) train("worker");
    for (const kind of ["lumbercamp", "miningcamp", "mill"])
      if (!completeBuildings(kind, 1).length) build(kind);
    const farms = completeBuildings("farm", 1).filter((b) => b.remaining > 0);
    if (farms.length < Math.ceil(ws.length / 7)) build("farm");
    if (state.time > 45 && ws.length >= 6)
      for (const settlement of completeBuildings("towncenter", 1))
        enemyFortifications(settlement, ws);
    for (const kind of ["barracks", "stable", "chapel", "siegeworkshop"])
      if (
        !completeBuildings(kind, 1).length &&
        (kind !== "siegeworkshop" || state.time > 150)
      )
        build(kind);
    for (const settlement of completeBuildings("towncenter", 1).slice(1)) {
      if (
        !completeBuildings("barracks", 1).some(
          (b) => distance(b, settlement) < 900,
        )
      )
        build("barracks", settlement);
      const stationed = army.filter((u) => u.garrisonBase === settlement.id);
      for (const u of army
        .filter((u) => !u.scout && !u.garrisonBase && !u.order && !u.target)
        .slice(0, Math.max(0, 6 - stationed.length))) {
        u.garrisonBase = settlement.id;
        u.home = findFree({
          x: settlement.x + ((u.id % 3) - 1) * 90,
          y: settlement.y + 190,
        });
        u.order = { ...u.home, attack: true };
        u.pathTimer = 0;
      }
    }
    const damaged = completeBuildings(null, 1).filter(
      (b) =>
        b.hp < b.maxHp * (b.defence ? 0.9 : 0.7) &&
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
    const desired = { food: 0.3, wood: 0.3, gold: 0.2, stone: 0.2 },
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
      "ram",
      "ballista",
    ];
    for (let i = 0; i < (state.difficulty === "hard" ? 4 : 2); i++)
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
      .filter(
        (u) =>
          !u.scout && !u.garrisonBase && ["knight", "archer"].includes(u.type),
      )
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
        (u) =>
          u.team === 0 &&
          enemyFog.sees(u) &&
          completeBuildings("towncenter", 1).some((b) => distance(u, b) < 950),
      );
    if (visibleThreats.length) {
      const target = visibleThreats.sort(
        (a, b) => distance(a, base) - distance(b, base),
      )[0];
      const defenders = active.filter(
        (u) => !u.order?.formation && distance(u, target) < 1200,
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
          u.path = [];
          u.pathGoal = null;
          u.pathRequest = null;
          u.stuck = 0;
        });
        state.formations.push({
          id,
          members: defenders.map((u) => u.id),
          anchor: center,
          routeStart: findFree(center),
          sharedRoute: true,
          routeReady: false,
          destination,
          path: [],
          revision: nav.revision,
          speed: Math.min(...defenders.map((u) => TYPES[u.type].speed)),
          arrived: false,
          wait: 0,
        });
      }
      return;
    }
    const healthy = active.filter(
      (u) =>
        !u.garrisonBase &&
        !u.campaignPost &&
        !u.fixedDefense &&
        !u.curtainGuard &&
        !u.regionalMission &&
        !u.order?.formation &&
        u.hp / u.maxHp > plan.retreat &&
        distance(u, base) < 1200,
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
      state.time - ai.attack > 65
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
        u.path = [];
        u.pathGoal = null;
        u.pathRequest = null;
        u.stuck = 0;
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
          routeStart: findFree(center),
          sharedRoute: true,
          routeReady: false,
          destination,
          path: [],
          revision: nav.revision,
          speed: Math.min(...group.map((u) => TYPES[u.type].speed)),
          arrived: false,
          wait: 0,
        });
    }
  }
  function regionalCompany(members, destination, base) {
    if (!members.length) return;
    const id = ++uid,
      center = members.reduce(
        (p, u) => ({
          x: p.x + u.x / members.length,
          y: p.y + u.y / members.length,
        }),
        { x: 0, y: 0 },
      ),
      goal = findFree(destination),
      angle = Math.atan2(goal.y - center.y, goal.x - center.x);
    members.forEach((u, i) => {
      const rear = Math.floor(i / 5) * 48 + (u.type === "trebuchet" ? 380 : 0),
        side = ((i % 5) - 2) * 48,
        p = findFree({
          x: goal.x - Math.cos(angle) * rear - Math.sin(angle) * side,
          y: goal.y - Math.sin(angle) * rear + Math.cos(angle) * side,
        });
      const order = { ...p, attack: true, formation: id };
      u.regionalMission = base.id;
      u.order = order;
      u.marchOffset = { x: p.x - goal.x, y: p.y - goal.y };
      u.path = [];
      u.pathGoal = null;
      u.pathRequest = null;
      if (u.type === "trebuchet" && u.deployment !== "packed") {
        u.deployment = "packing";
        u.deployTimer = 4;
        u.pendingOrder = order;
        u.order = null;
      }
    });
    state.formations.push({
      id,
      members: members.map((u) => u.id),
      anchor: center,
      routeStart: findFree(center),
      destination: goal,
      sharedRoute: true,
      routeReady: false,
      path: [],
      revision: nav.revision,
      speed: Math.min(...members.map((u) => TYPES[u.type].speed)),
      arrived: false,
      wait: 0,
    });
  }
  function regionalAI(dt) {
    state.regionalThink = (state.regionalThink || 0) - dt;
    if (state.regionalThink > 0) return;
    state.regionalThink = 5;
    state.regions ||= {};
    state.cityEconomies ||= {};
    const level = state.mode === "campaign" ? state.level : 0,
      scale = DIFFICULTIES[state.difficulty]?.think || 6;
    for (const base of state.buildings.filter(
      (b) =>
        b.kind === "towncenter" &&
        [1, 3].includes(b.team) &&
        b.hp > 0 &&
        b.progress >= 1,
    )) {
      const city =
        base.team === 3 ? state.cities.find((c) => c.id === base.city) : null;
      if (base.team === 3 && (!city || city.captured)) continue;
      const sight = base.team === 3 ? militiaFog : enemyFog;
      if (!sight) continue;
      const region = (state.regions[base.id] ||= {
        patrolAt: state.time + 70 + (base.id % 4) * 12,
        invasionAt: state.time + Math.max(80, 180 - level * 17),
        phase: 0,
        patrols: 0,
        invasions: 0,
      });
      const troops = fighters(base.team).filter(
        (u) =>
          (base.team === 3 ? u.city === city.id : !u.campaignPost) &&
          !u.fixedDefense &&
          !u.curtainGuard &&
          !u.scout &&
          distance(u, base) < (city?.radius || 1400),
      );
      for (const u of troops)
        if (
          u.regionalMission === base.id &&
          !u.order &&
          !u.pendingOrder &&
          !u.target
        )
          delete u.regionalMission;
      const available = troops.filter(
        (u) =>
          !u.order?.formation &&
          !u.pendingOrder &&
          !u.regionalMission &&
          u.hp / u.maxHp > 0.55,
      );
      if (city) {
        const economy = (state.cityEconomies[city.id] ||= {
          food: 700,
          wood: 700,
          gold: 900,
          stone: 500,
          time: state.time,
          cycle: 0,
        });
        const elapsed = Math.min(10, state.time - economy.time),
          citizens = state.units.filter(
            (u) => u.city === city.id && u.type === "civilian" && u.hp > 0,
          ).length;
        economy.time = state.time;
        for (const [resource, share] of Object.entries({
          food: 0.4,
          wood: 0.25,
          gold: 0.25,
          stone: 0.1,
        }))
          economy[resource] = Math.min(
            3000,
            economy[resource] + elapsed * citizens * 0.8 * share,
          );
        if (
          state.units.filter(
            (u) => u.city === city.id && u.team === 3 && u.hp > 0,
          ).length <
          110 + level * 8
        ) {
          const cycle = ["sword", "archer", "sword", "knight", "archer"],
            type = cycle[economy.cycle % cycle.length],
            spec = TYPES[type];
          const producer = state.buildings
            .filter(
              (b) =>
                b.city === city.id &&
                b.team === 3 &&
                b.kind === spec.producer &&
                b.progress >= 1 &&
                b.hp > 0,
            )
            .sort((a, b) => a.queue.length - b.queue.length)[0];
          if (
            producer &&
            producer.queue.length < 2 &&
            Object.entries(spec.cost).every(([r, n]) => economy[r] >= n)
          ) {
            for (const [r, n] of Object.entries(spec.cost)) economy[r] -= n;
            producer.queue.push({
              kind: "unit",
              type,
              time: 0,
              duration: spec.train,
              cost: { ...spec.cost },
            });
            economy.cycle++;
          }
        }
      }
      const known = Object.values(sight.known)
        .filter((b) => b.team === 0 && b.hp > 0 && distance(b, base) < 6000)
        .sort((a, b) => distance(a, base) - distance(b, base));
      const reserve = city ? 28 + level * 4 : 8;
      if (
        state.time >= region.invasionAt &&
        known.length &&
        available.length >= reserve + 8
      ) {
        const size = Math.min(24, available.length - reserve),
          target = known[0];
        regionalCompany(
          available
            .sort((a, b) => distance(a, target) - distance(b, target))
            .slice(0, size),
          target,
          base,
        );
        region.invasions++;
        region.invasionAt =
          state.time + Math.max(65, 150 - level * 10) * (scale / 6);
        continue;
      }
      if (state.time >= region.patrolAt && available.length >= reserve + 4) {
        const angle = region.phase++ * 1.91 + base.id * 0.17,
          radius =
            (city?.radius || 700) + 250 + Math.min(1800, region.phase * 220),
          destination = {
            x: clamp(base.x + Math.cos(angle) * radius, 250, W - 250),
            y: clamp(base.y + Math.sin(angle) * radius, 250, H - 250),
          };
        const gate = state.buildings
          .filter(
            (b) =>
              b.team === base.team &&
              b.kind === "gate" &&
              b.hp > 0 &&
              (city ? b.city === city.id : distance(b, base) < 1800),
          )
          .sort(
            (a, b) => distance(a, destination) - distance(b, destination),
          )[0];
        regionalCompany(
          available
            .sort(
              (a, b) =>
                distance(a, gate || destination) -
                distance(b, gate || destination),
            )
            .slice(0, 4),
          destination,
          base,
        );
        region.patrols++;
        region.patrolAt =
          state.time + Math.max(55, 110 - level * 9) * (scale / 6);
      }
    }
  }
  function strategicAI(dt) {
    enemyEconomy(dt);
    regionalAI(dt);
  }
  function civilianAI(u, dt) {
    const threats = nearby(u, 180).filter(
      (e) => e.team !== u.team && e.team !== 2 && TYPES[e.type].damage > 0,
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
      danger =
        nearby(u, 260).some(
          (a) => a.team !== 0 && a.team !== 2 && TYPES[a.type].damage > 0,
        ) ||
        state.buildings.some(
          (b) =>
            b.team !== 0 &&
            b.team !== 2 &&
            b.hp > 0 &&
            b.progress >= 1 &&
            BUILDINGS[b.kind].damage &&
            distance(b, u) < BUILDINGS[b.kind].range + 50 &&
            playerSees(b),
        );
    u.escortWaiting = !escort || danger;
    if (u.escortWaiting) return;
    const goal = u.route[u.routeIndex];
    if (!goal) return;
    if (moveUnit(u, goal, dt, 35)) {
      u.routeIndex++;
      u.pathTimer = 0;
      if (u.routeIndex >= u.route.length) {
        if (u.type === "merchant")
          state.stats.delivered = (state.stats.delivered || 0) + 1;
        else state.stats.rescued++;
        toast(
          u.type === "merchant"
            ? "A supply caravan has reached the road settlement."
            : "A pilgrim caravan has reached the refuge.",
        );
        u.evacuated = true;
        u.hp = 0;
      }
    }
  }
  function objectiveState() {
    const l = LEVELS[state.level],
      rules = state.campaignRules,
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
          (Math.min(rules?.farms || 2, farms) / (rules?.farms || 2) +
            Math.min(rules?.food || 200, food) / (rules?.food || 200) +
            (fort.team === 0 ? 1 : 0)) /
          3,
        text: `Farms ${Math.min(rules?.farms || 2, farms)}/${rules?.farms || 2} · food gathered ${Math.floor(Math.min(rules?.food || 200, food))}/${rules?.food || 200} · outpost ${fort.team === 0 ? "secured" : "unclaimed"}`,
        won:
          farms >= (rules?.farms || 2) &&
          food >= (rules?.food || 200) &&
          fort.team === 0,
      };
    }
    if (l.kind === "escort") {
      const tower = completeBuildings(null)
          .filter((b) => ["tower", "watchtower"].includes(b.kind))
          .some((b) => distance(b, { x: riverX(1150), y: 1150 }) < 280),
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
        progress:
          (Math.min(rules?.survival || 360, state.time) /
            (rules?.survival || 360) +
            (chapel ? 1 : 0)) /
          2,
        text: `Hold ${Math.floor(Math.min(state.time, rules?.survival || 360))}/${rules?.survival || 360}s · chapel ${chapel ? "complete" : "needed"}`,
        won: state.time >= (rules?.survival || 360) && chapel,
      };
    }
    if (l.kind === "liberation") {
      const sites = state.sites.filter((s) => !s.optional && s.captured).length;
      return {
        progress:
          (sites / 2 +
            Math.min(rules?.hold || 90, state.occupation) /
              (rules?.hold || 90)) /
          2,
        text: `Supplies ${state.stats.delivered || 0}/${rules?.deliveries || 0} | villages ${sites}/2 · hold ${Math.floor(state.occupation)}/${rules?.hold || 90}s`,
        won:
          sites === 2 &&
          state.occupation >= (rules?.hold || 90) &&
          (state.stats.delivered || 0) >= (rules?.deliveries || 0),
      };
    }
    if (l.kind === "siege") {
      const gates = state.buildings.filter((b) => b.gate && b.hp <= 0).length;
      return {
        progress:
          (Math.min(rules?.gates || 2, gates) / (rules?.gates || 2) +
            (state.stats.siegeHits > 0 ? 1 : 0)) /
          2,
        text: `Gatehouses ${gates}/${rules?.gates || 2} · siege hits ${state.stats.siegeHits}`,
        won: gates >= (rules?.gates || 2) && state.stats.siegeHits > 0,
      };
    }
    const sites = state.sites.filter((s) => !s.optional && s.captured).length;
    return {
      progress:
        ((state.citadelTaken ? 1 : 0) +
          sites / 2 +
          Math.min(rules?.hold || 90, state.occupation) / (rules?.hold || 90)) /
        3,
      text: `Sites ${sites}/2 · citadel ${state.citadelTaken ? "taken" : "standing"} · hold ${Math.floor(state.occupation)}/${rules?.hold || 90}s`,
      won:
        state.citadelTaken &&
        sites === 2 &&
        state.occupation >= (rules?.hold || 90),
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
        !state.campaignRules &&
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
      militiaFog ||= new window.CruciataFog(W, H, null, 3);
      militiaFog.update(state.units, state.buildings);
      visionTimer = 0.2;
    }
    state.waveTimer -= dt;
    campaignPressure(dt);
    state.screenShake = Math.max(0, (state.screenShake || 0) - dt * 16);
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
    state.gateTimer = (state.gateTimer || 0) - dt;
    if (state.gateTimer <= 0) {
      state.gateTimer = 0.25;
      for (const gate of state.buildings) {
        if (
          gate.kind !== "gate" ||
          gate.hp <= 0 ||
          gate.progress < 1 ||
          gate.team === 2
        )
          continue;
        const passage =
          gate.team === 3 &&
          nearby(gate, 280).some(
            (u) =>
              u.team === 3 &&
              u.regionalMission &&
              u.hp > 0 &&
              distance(u, gate) < 280,
          );
        if (gate.team === 3 && passage && gate.closed) {
          gate.closed = false;
          gate.militiaPassage = true;
          state.navDirty = true;
        } else if (gate.team === 3 && gate.militiaPassage && !passage) {
          gate.closed = true;
          delete gate.militiaPassage;
          state.navDirty = true;
        }
        const threat = nearby(gate, gate.autoClosed ? 200 : 145).some(
          (u) =>
            u.hp > 0 &&
            u.team !== gate.team &&
            u.team !== 2 &&
            TYPES[u.type].damage > 0 &&
            observerSees(gate, u),
        );
        if (threat && !gate.closed) {
          gate.closed = true;
          gate.autoClosed = true;
          state.navDirty = true;
        } else if (!threat && gate.autoClosed) {
          gate.closed = false;
          gate.autoClosed = false;
          state.navDirty = true;
        } else if (gate.team === 1 && gate.defence && !threat && gate.closed) {
          gate.closed = false;
          state.navDirty = true;
        }
      }
    }
    updateScouting(dt);
    updateFormations(dt);
    strategicAI(dt);
    for (const b of state.buildings) {
      if (b.upgradeOwner) {
        const owner = getObject(b.upgradeOwner);
        if (
          !owner ||
          owner.hp <= 0 ||
          !owner.queue.some((q) => q.partnerId === b.id)
        )
          delete b.upgradeOwner;
      }
      if (b.hp <= 0 || b.progress < 1) continue;
      const item = b.queue[0];
      if (item?.kind === "building-upgrade" && item.targetKind === "gate") {
        const partner = getObject(item.partnerId);
        if (
          !partner ||
          partner.hp <= 0 ||
          !straightWall(b) ||
          !straightWall(partner)
        ) {
          b.queue.shift();
          releaseWallUpgrade(b, item);
          pay(item.cost, -1);
          continue;
        }
      }
      if (item) {
        item.time += dt;
        if (item.time >= item.duration) {
          b.queue.shift();
          if (item.kind === "building-upgrade") {
            completeWallUpgrade(b, item);
          } else if (item.kind === "research") {
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
            if (b.team === 3 && b.city) {
              u.city = b.city;
              u.cityDefender = true;
              u.home = { ...p };
            }
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
          let locked =
            b.kind === "greatengine" ? getObject(b.attackTarget) : null;
          if (locked && (locked.team === b.team || locked.team === 2)) {
            b.attackTarget = null;
            locked = null;
          }
          const target =
            b.kind === "greatengine"
              ? b.fireTarget
                ? distance(b, b.fireTarget) >= spec.minRange &&
                  distance(b, b.fireTarget) <= spec.range
                  ? b.fireTarget
                  : null
                : locked
                  ? distance(b, locked) >= spec.minRange &&
                    distance(b, locked) <= spec.range
                    ? locked
                    : null
                  : state.buildings
                      .filter(
                        (e) =>
                          e.team !== b.team &&
                          e.team !== 2 &&
                          e.hp > 0 &&
                          distance(b, e) >= spec.minRange &&
                          distance(b, e) <= spec.range &&
                          observerSees(b, e),
                      )
                      .sort((a, c) => distance(a, b) - distance(c, b))[0]
              : nearby(b, spec.range)
                  .filter(
                    (u) =>
                      u.team !== b.team && u.team !== 2 && observerSees(b, u),
                  )
                  .sort((a, c) => distance(a, b) - distance(c, b))[0];
          if (target) {
            if (b.kind === "greatengine") {
              const aim = Math.atan2(target.y - b.y, target.x - b.x);
              b.aimAngle ??= -Math.PI / 2;
              const delta = Math.atan2(
                Math.sin(aim - b.aimAngle),
                Math.cos(aim - b.aimAngle),
              );
              b.aimAngle += clamp(delta, -0.85 * dt, 0.85 * dt);
              if (Math.abs(delta) > 0.06) continue;
              b.guardCooldown = 18;
              b.lastShot = state.time;
              sound("great-launch", { x: b.x, y: b.y, team: b.team });
              state.boulders.push({
                x: b.x,
                y: b.y,
                tx: target.x,
                ty: target.y,
                sx: b.x,
                sy: b.y,
                t: 0,
                duration: 3.6 + distance(b, target) / 1500,
                heavy: true,
                team: b.team,
                source: b.id,
                damage: spec.damage,
                r: 230,
              });
              continue;
            }
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
    // Local crowd separation prevents overlapping and preserves spacing without pushing units through walls.
    for (const u of state.units) {
      if (u.hp <= 0 || !u.moving) continue;
      const myR = ["knight", "trebuchet", "ram", "ballista"].includes(u.type)
        ? 26
        : 14;
      for (const other of nearby(u, myR + 28)) {
        if (other.id <= u.id || other.hp <= 0) continue;
        const otherR = ["knight", "trebuchet", "ram", "ballista"].includes(
          other.type,
        )
          ? 26
          : 14;
        const d = distance(u, other),
          minDist = (myR + otherR) * 0.85;
        if (d < minDist && d > 0.1) {
          const push = (minDist - d) * Math.min(0.08, dt * 2.0),
            dx = ((u.x - other.x) / d) * push,
            dy = ((u.y - other.y) / d) * push;
          if (groundFree(u.x + dx, u.y + dy, 6)) {
            u.x += dx;
            u.y += dy;
          }
          if (other.moving && groundFree(other.x - dx, other.y - dy, 6)) {
            other.x -= dx;
            other.y -= dy;
          }
        }
      }
    }
    for (const u of state.units) {
      if (u.hp > 0 && u.type === "standard") {
        if (visualActive(u)) Art.updateStandard(u, dt);
        else Art.suspendStandard(u);
      }
      if (
        u.hp > 0 &&
        u.moving &&
        visualActive(u) &&
        state.time >= (u.dustAt || 0)
      ) {
        u.dustAt = state.time + 0.4 + (u.id % 5) * 0.05;
        emitParticle({
          x: u.x - Math.cos(u.angle) * 8,
          y: u.y - Math.sin(u.angle) * 8,
          vx: -Math.cos(u.angle) * 12,
          vy: -Math.sin(u.angle) * 12,
          t: 0,
          life: 0.8,
          color: "#b5a48288",
          r: u.type === "knight" ? 12 : 6,
          sprite: "dirt_01",
          growth: 1.1,
        });
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
          damage(
            target,
            a.damage,
            { id: 0, team: a.team, type: a.siege ? "ballista" : "archer" },
            !!a.siege,
          );
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
      const flight = clamp(
          Math.max(0, stone.t - dt * 2) / stone.duration,
          0,
          1,
        ),
        px = stone.sx + (stone.tx - stone.sx) * flight,
        py =
          stone.sy +
          (stone.ty - stone.sy) * flight -
          Math.sin(flight * Math.PI) * (stone.heavy ? 340 : 150);
      emitParticle({
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 20,
        vy: -12,
        t: 0,
        life: 0.45,
        sprite: stone.heavy ? "smoke_04" : "flame_01",
        trail: true,
        growth: 1.6,
        color: Math.random() < 0.5 ? "#f4a342" : "#4c433ecc",
        r: (stone.heavy ? 8 : 3) + Math.random() * (stone.heavy ? 10 : 4),
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
          emitParticle({
            x: stone.tx,
            y: stone.ty,
            vx: (Math.random() - 0.5) * 240,
            vy: (Math.random() - 0.5) * 240,
            t: 0,
            life: 0.6 + Math.random() * 1.4,
            sprite: i % 3 ? "dirt_01" : "spark_01",
            growth: i % 3 ? 1.4 : 0,
            color: ["#ffd778", "#ee8633", "#d0461d", "#594e42", "#88735a"][
              i % 5
            ],
            r: 6 + Math.random() * 16,
          });
        emitParticle({
          x: stone.tx,
          y: stone.ty,
          vx: 0,
          vy: 0,
          t: 0,
          life: 0.3,
          color: "#ffe6b3",
          r: stone.heavy ? 120 : 65,
          sprite: "light_02",
          glow: true,
          growth: 1.2,
        });
        if (stone.heavy) {
          state.screenShake = Math.max(
            state.screenShake || 0,
            13 *
              clamp(
                1 - distance({ x: stone.tx, y: stone.ty }, camera) / 1800,
                0,
                1,
              ),
          );
          state.rings.push({
            x: stone.tx,
            y: stone.ty,
            t: 0,
            color: "#ffe2a9",
            r: stone.r * 1.8,
          });
          for (let i = 0; i < 40; i++)
            emitParticle({
              x: stone.tx,
              y: stone.ty,
              vx: Math.cos(i * 2.399) * (80 + i * 5),
              vy: Math.sin(i * 2.399) * (80 + i * 5),
              t: 0,
              life: 2.2 + Math.random(),
              sprite: i % 3 ? "smoke_01" : "flame_01",
              growth: 2,
              color: i % 3 ? "#8a776588" : "#f2b458",
              r: 12 + Math.random() * 24,
            });
        }
        sound(stone.heavy ? "great-impact" : "explosion", {
          x: stone.tx,
          y: stone.ty,
          team: stone.team,
        });
      }
    }
    state.boulders = state.boulders.filter((s) => !s.hit);
    captureCities(dt);
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
          for (const u of state.units)
            if (u.site === s.id && u.hp > 0) {
              u.team = claimant;
              if (u.type === "civilian") {
                u.type = "worker";
                u.maxHp = TYPES.worker.hp;
                u.hp = u.maxHp;
              }
              u.home = null;
              u.order = null;
              u.job = null;
              u.target = null;
              u.path = [];
              u.hold = false;
            }
          toast(
            s.name +
              (claimant === 0
                ? " secured. Its residents now serve as villagers."
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
      if (!visualParticle(p)) {
        p.t = p.life;
        continue;
      }
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    state.particles = state.particles.filter((p) => p.t < p.life).slice(-800);
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
      state.campaignRules?.deliveries &&
      (state.stats.delivered || 0) +
        state.units.filter((u) => u.type === "merchant" && u.missionSupply)
          .length <
        state.campaignRules.deliveries
    ) {
      finish(false);
      return;
    }
    if (
      LEVELS[state.level].kind === "escort" &&
      state.stats.rescued +
        state.units.filter((u) => u.type === "pilgrim").length <
        2
    ) {
      finish(false);
      return;
    }
    if (TEST) nav.process(Infinity, 32);
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
    const paint = () => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
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
            kind: art.kind === "bastionwall" ? "wall" : art.kind,
            fortified: art.kind === "bastionwall",
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
    };
    paint();
    // Atlas pages decode asynchronously. Repaint menu previews once their
    // referenced page is available so first-open build cards are not blank.
    window.CruciataAtlas?.ready?.then(() => {
      if (c.isConnected) paint();
    });

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
  ROLES.ram = {
    label: "Armored siege assault",
    description:
      "Slow, durable engine that deals heavy siege damage to masonry. Escort it against enemy troops.",
  };
  ROLES.ballista = {
    label: "Direct-fire siege",
    description:
      "Mobile ranged engine that damages troops and fortifications. Fragile when surrounded.",
  };
  function initActions() {
    for (const key of [
      "worker",
      "sword",
      "archer",
      "knight",
      "chaplain",
      "standard",
      "trebuchet",
      "ram",
      "ballista",
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
    for (const [label, kinds] of [
      ["Settlement", ["towncenter", "house", "chapel"]],
      ["Economy", ["farm", "mill", "lumbercamp", "miningcamp"]],
      ["Military", ["barracks", "stable", "siegeworkshop"]],
      [
        "Fortification",
        ["watchtower", "tower", "wall", "bastionwall", "greatengine"],
      ],
    ]) {
      const group = document.createElement("section");
      group.className = "build-category";
      const heading = document.createElement("h3");
      heading.textContent = label;
      group.append(heading);
      for (const k of kinds) {
        const t = BUILDINGS[k];
        if (!t?.cost) continue;
        group.append(
          actionCard(
            "build-" + k,
            t.name,
            t.cost,
            { kind: k },
            () => beginBuild(k),
            `${t.name}: ${costText(t.cost)}. ${t.time}s per villager. ${t.description || ""}`,
          ),
        );
      }
      $("build-list").append(group);
    }
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

  const groupButtons = new Map();
  function updateUI() {
    if (!state) return;
    const stanceUnits = fighters().filter((u) => selected.has(u.id));
    for (const stance of ["fight", "hold", "stand-down"]) {
      const button = $("stance-" + stance);
      button.hidden = !stanceUnits.length;
      button.classList.toggle(
        "active",
        !!stanceUnits.length &&
          stanceUnits.every((u) => (u.stance || "fight") === stance),
      );
    }
    $("destroy-button").hidden = !selectedStructures((b) => !b.cityCenter)
      .length;
    $("upgrade-gate-button").hidden = !selectedStructures((b) => gatePartner(b))
      .length;
    $("upgrade-tower-button").hidden = !selectedStructures((b) =>
      availableWall(b),
    ).length;
    for (const kind of ["gate", "tower"]) {
      const button = $("upgrade-" + kind + "-button");
      const first = nextStructure(
        "wall-upgrade:" + kind,
        selectedStructures(
          (b) => availableWall(b) && (kind !== "gate" || gatePartner(b)),
        ),
      );
      const cost = wallUpgradeCost(kind, first);
      const bastion =
        kind === "gate" &&
        (first?.fortified || gatePartner(first || {})?.fortified);
      const upgradeSpec = BUILDINGS[bastion ? "bastiongate" : kind];
      if (kind === "gate")
        button.textContent = bastion
          ? "Upgrade to bastion gate"
          : "Upgrade to gate";
      button.disabled = !afford(cost) || !!state.result;
      button.title =
        (kind === "gate"
          ? "Upgrade two straight wall sections to a gatehouse"
          : "Upgrade a wall section to an armed guard tower") +
        ": " +
        costText(cost) +
        ". " +
        upgradeSpec.time +
        "s. Cancel returns the upgrade resources.";
    }
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
    const groupOwned = new Map(
      [...state.units, ...state.buildings]
        .filter((o) => o.team === 0 && o.hp > 0)
        .map((o) => [o.id, o]),
    );
    const groupSelection = new Set(
      [...selected, ...selectedBuildings, selectedBuilding].filter((id) =>
        groupOwned.has(id),
      ),
    );
    for (const [group, button] of groupButtons) {
      const members = controlGroupMembers(group, groupOwned),
        buildings = members.filter((o) => o.kind).length;
      button.classList.toggle("assigned", members.length > 0);
      button.setAttribute(
        "aria-pressed",
        String(
          members.length > 0 &&
            members.length === groupSelection.size &&
            members.every((o) => groupSelection.has(o.id)),
        ),
      );
      button.title = `Group ${group}: ${members.length - buildings} units, ${buildings} buildings. Ctrl+${group} assigns; Ctrl+Shift+${group} adds; ${group} selects.`;
      button.setAttribute("aria-label", button.title);
    }
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
      $("selection-title").textContent = b.cityCenter
        ? state.cities.find((c) => c.id === b.city)?.name || "City center"
        : b.outpost
          ? state.sites.find((s) => s.id === b.site)?.name || "Outpost"
          : b.kind === "chapel" && b.team === 1
            ? "Prayer house"
            : b.kind === "wall" && b.fortified
              ? BUILDINGS.bastionwall.name
              : b.bastionGate
                ? BUILDINGS.bastiongate.name
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
      const artHeight = Art.visualHeight(b);
      const portraitScale = Math.min(
        54 / (b.w + 12),
        58 / (b.h + artHeight + 20),
      );
      icon.translate(0, artHeight * portraitScale * 0.45);
      icon.scale(portraitScale, portraitScale);
      Art.structure(icon, { ...b, x: 0, y: 0 }, state.time);
      if (b.queue.length || b.upgradeOwner) {
        const q = b.queue[0] || getObject(b.upgradeOwner)?.queue[0];
        if (q) {
          $("queue-detail").textContent =
            (q.kind === "unit"
              ? unitName({
                  type: q.type,
                  team: b.team,
                  rank: rankFor(q.type, b.team),
                })
              : q.kind === "building-upgrade"
                ? q.targetKind === "gate"
                  ? "Gatehouse upgrade"
                  : "Guard tower upgrade"
                : b.team === 1
                  ? ENEMY_VARIANTS[TECHS[q.tech].type]?.[TECHS[q.tech].rank] ||
                    TECHS[q.tech].name
                  : TECHS[q.tech].name) +
            " · " +
            Math.ceil(q.duration - q.time) +
            "s · " +
            (b.queue.length || (b.upgradeOwner ? 1 : 0)) +
            " queued";
        }
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
      const machinePortrait = ["ram", "ballista", "trebuchet"].includes(
        single.type,
      );
      const mountedPortrait = ["knight", "pilgrim", "merchant"].includes(
        single.type,
      );
      const caravanPortrait = ["pilgrim", "merchant"].includes(single.type);
      const unitScale = machinePortrait
        ? 0.5
        : single.type === "standard"
          ? 0.6
          : caravanPortrait
            ? 0.7
            : mountedPortrait
              ? 0.85
              : 1.3;
      icon.translate(
        0,
        machinePortrait
          ? 15
          : single.type === "standard"
            ? 0
            : caravanPortrait
              ? 7
              : mountedPortrait
                ? 17
                : 12,
      );
      icon.scale(unitScale, unitScale);
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
      "ram",
      "ballista",
    ])
      $("recruit-" + key).hidden = !state.buildings.some(
        (b) =>
          (selectedBuildings.has(b.id) || selectedBuilding === b.id) &&
          b.team === 0 &&
          b.hp > 0 &&
          b.progress >= 1 &&
          b.kind === TYPES[key].producer,
      );
    for (const [key, t] of Object.entries(TECHS))
      $("research-" + key).hidden =
        !state.buildings.some(
          (c) =>
            c.team === 0 &&
            c.hp > 0 &&
            c.progress >= 1 &&
            (c.id === selectedBuilding || selectedBuildings.has(c.id)) &&
            c.kind === t.producer,
        ) || rankFor(t.type) !== t.rank - 1;
    $("research-tab").hidden = !state.buildings.some(
      (c) =>
        c.team === 0 &&
        c.hp > 0 &&
        c.progress >= 1 &&
        (c.id === selectedBuilding || selectedBuildings.has(c.id)) &&
        Object.values(TECHS).some((t) => t.producer === c.kind),
    );
    $("gate-button") &&
      ($("gate-button").hidden = !selectedStructures(
        (b) => b.kind === "gate" && b.progress >= 1,
      ).length);
    $("clear-patch") && ($("clear-patch").hidden = !selectedNode);
    if (selectedBuildings.size > 1) {
      const buildings = state.buildings.filter(
        (b) => selectedBuildings.has(b.id) && b.hp > 0,
      );
      $("selection-title").textContent =
        buildings.length + " selected structures";
      $("selection-detail").textContent =
        "Training and building actions take turns among compatible selected structures.";
      $("queue-detail").textContent =
        buildings.reduce((n, b) => n + b.queue.length, 0) + " total queued";
    }
    if (units.length && selectedBuildings.size) {
      $("selection-title").textContent =
        `${units.length} units + ${selectedBuildings.size} structures`;
      $("selection-detail").textContent =
        "Orders command the units; training and cancellation apply to selected buildings.";
    }
    if (b)
      $("selection-role").textContent =
        b.progress < 1
          ? "Foundation: assign villagers to build by right-clicking. This project provides no vision until completed."
          : b.kind === "watchtower"
            ? BUILDINGS.watchtower.description
            : b.outpost
              ? "Capturable outpost: hold three soldiers inside its ring for 18 seconds. Its buildings and resident villagers transfer to the capturing army. Neutral outposts provide neither army with vision."
              : BUILDINGS[b.kind].drop
                ? "Depot: villagers deliver " +
                  BUILDINGS[b.kind].drop.join(", ") +
                  " here. Right-click this depot with villagers to gather and deliver here. New builders automatically gather after completion."
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
    if (b?.city && !state.cities?.find((c) => c.id === b.city)?.captured) {
      const city = state.cities.find((c) => c.id === b.city);
      $("selection-role").textContent =
        city.name +
        ": fortified city. Reach the capital with a combat troop to capture it immediately. Claim 1,800 food, 2,400 wood, 1,800 stone, 2,200 gold, and all surviving buildings and defenders.";
    }
    if (b?.kind === "greatengine")
      $("selection-role").textContent =
        "Permanent siege engine. Range 320-2200. Right-click ground to bombard it, or an enemy to lock bombardment. Reload: " +
        Math.ceil(Math.max(0, b.guardCooldown || 0)) +
        "s. Keep friendly troops outside the huge impact zone.";
    if (isCapital(b))
      $("selection-role").textContent =
        "Capital and resource depot. Its destruction decides the battle immediately, regardless of other objectives. Trains villagers and accepts every resource.";
    icon.restore();
    $("selection-health").style.width = health * 100 + "%";
    $("scout-button").hidden = !stanceUnits.length;
    $("deploy-button").hidden = !units.some((u) => u.type === "trebuchet");
    const selectedSiege = units.filter((u) => u.type === "trebuchet"),
      selectedGreat = selectedStructures(
        (b) => b.kind === "greatengine" && b.progress >= 1,
      );
    $("cancel-targeting-button").hidden =
      !selectedSiege.length && !selectedGreat.length;
    $("cancel-targeting-button").disabled =
      !selectedSiege.some((u) => u.fireTarget || u.manualTarget) &&
      !selectedGreat.some((b) => b.fireTarget || b.attackTarget);
    $("bless-button").hidden = !stanceUnits.length;
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
          (b.progress < 1 || b.queue.length || b.upgradeOwner),
      );
    $("cancel-button").hidden = $("cancel-button").disabled;
    for (const key of [
      "worker",
      "sword",
      "archer",
      "knight",
      "chaplain",
      "standard",
      "trebuchet",
      "ram",
      "ballista",
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
      if (t.cost && $("build-" + k)) {
        $("build-" + k).disabled = !afford(t.cost) || !!state.result;
        $("build-" + k).classList.toggle("active", placement === k);
      }
    for (const [k, t] of Object.entries(TECHS)) {
      $("research-" + k).disabled =
        !!state.techs[k] ||
        rankFor(t.type) !== t.rank - 1 ||
        state.buildings.some((b) => b.queue.some((q) => q.tech === k)) ||
        !selectedStructures(
          (b) => b.kind === t.producer && b.progress >= 1 && b.queue.length < 8,
        ).length ||
        !afford(t.cost) ||
        !!state.result;
      $("research-" + k).classList.toggle("completed", !!state.techs[k]);
    }
  }

  const siegeOverlay = {
    mask: document.createElement("canvas"),
    stamp: document.createElement("canvas"),
    edge: document.createElement("canvas"),
    key: "",
  };
  function drawSiegeUnion(engines) {
    const scale = view.scale,
      width = Math.ceil(view.w * scale),
      height = Math.ceil(view.h * scale),
      key = [
        view.x,
        view.y,
        scale,
        width,
        height,
        ...engines.flatMap((u) => [u.id, u.x, u.y]),
      ].join(",");
    if (siegeOverlay.key !== key) {
      siegeOverlay.key = key;
      for (const c of [
        siegeOverlay.mask,
        siegeOverlay.stamp,
        siegeOverlay.edge,
      ]) {
        if (c.width !== width || c.height !== height) {
          c.width = width;
          c.height = height;
        } else {
          const g = c.getContext("2d");
          g.globalCompositeOperation = "source-over";
          g.clearRect(0, 0, width, height);
        }
      }
      const mask = siegeOverlay.mask.getContext("2d"),
        stamp = siegeOverlay.stamp.getContext("2d"),
        edge = siegeOverlay.edge.getContext("2d");
      for (const u of engines) {
        stamp.clearRect(0, 0, width, height);
        stamp.beginPath();
        stamp.arc(
          (u.x - view.x) * scale,
          (u.y - view.y) * scale,
          690 * scale,
          0,
          Math.PI * 2,
        );
        stamp.arc(
          (u.x - view.x) * scale,
          (u.y - view.y) * scale,
          180 * scale,
          0,
          Math.PI * 2,
          true,
        );
        stamp.fillStyle = "#f1cd82";
        stamp.fill();
        mask.drawImage(siegeOverlay.stamp, 0, 0);
      }
      for (const [x, y] of [
        [-1.5, 0],
        [1.5, 0],
        [0, -1.5],
        [0, 1.5],
      ])
        edge.drawImage(siegeOverlay.mask, x, y);
      edge.globalCompositeOperation = "destination-out";
      edge.drawImage(siegeOverlay.mask, 0, 0);
    }
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.drawImage(siegeOverlay.mask, view.x, view.y, view.w, view.h);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(siegeOverlay.edge, view.x, view.y, view.w, view.h);
    ctx.restore();
  }
  function drawUnit(g, u, time, drawAngle = u.angle) {
    if (["ram", "ballista", "trebuchet"].includes(u.type)) {
      Art.siegeMachine(g, u, time, drawAngle);
      return;
    }
    g.scale(0.72, 0.72);
    if (u.type === "pilgrim" || u.type === "merchant") {
      Art.caravan(g, u, time, drawAngle);
      return;
    }
    Art.unit(g, u, time, drawAngle);
    if (u.type === "standard") {
      Art.armyStandard(g, u);
    }
  }
  function healthBar(g, x, y, ratio, w = 32, team = 0) {
    if (Art.deferOverlay(g, () => healthBar(g, x, y, ratio, w, team))) return;
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
  function visualActive(o) {
    return onScreen(o, 130) && (o.team === 0 || playerSees(o));
  }
  function visualParticle(p) {
    return onScreen(p, Math.max(32, (p.r || 1) * (1 + (p.growth || 0))));
  }
  function emitParticle(p) {
    if (visualParticle(p)) state.particles.push(p);
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
      (-view.x * view.scale +
        Math.sin(state.time * 83) * (state.screenShake || 0)) *
        dpr,
      (-view.y * view.scale +
        Math.cos(state.time * 97) * (state.screenShake || 0) * 0.7) *
        dpr,
    );
    ctx.clearRect(view.x - 40, view.y - 40, view.w + 80, view.h + 80);
    ctx.drawImage(terrain, 0, 0, W, H);
    const time = state.time;
    Art.beginFrame(ctx);
    for (const u of state.units) {
      if (!visualActive(u)) {
        visibleFacing.delete(u);
        continue;
      }
      const desired =
        u.type === "archer" &&
        (u.strike > 0 || u.target) &&
        Number.isFinite(u.aimAngle)
          ? u.aimAngle
          : u.angle;
      if (!visibleFacing.has(u)) u.visualAngle = desired;
      visibleFacing.add(u);
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
    ctx.save();
    Art.clipLand(
      ctx,
      view,
      biome,
      coastX,
      riverX,
      bridgeY(),
      state.mode !== "quickmatch" && LEVELS[state.level].terrain === 0,
    );
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
      Art.line(ctx, points, 38, "#827761");
      Art.line(ctx, points, 33, "#a89b7e");
      for (const offset of [-7, 7])
        Art.line(
          ctx,
          points.map(([x, y]) => [x + offset, y]),
          0.8,
          "#8d78493d",
        );
    }
    ctx.restore();
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
        if (d.kind === "rockmass") Art.rockMass(ctx, d);
        else if (d.kind === "cliff") Art.cliff(ctx, d);
        else if (d.kind === "rock") Art.boulder(ctx, d);
        else Art.tree(ctx, d.x, d.y, d.scale, LEVELS[state.level].terrain >= 3);
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
                "#62221d",
              );
            }
          }
          if (
            ["trebuchet", "ram", "ballista", "pilgrim", "merchant"].includes(
              c.type,
            )
          ) {
            Art.corpse(ctx, c);
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
            Art.corpse(ctx, c);
          }
          ctx.restore();
        }
    }
    const knownBuildings = state.buildings
      .map((b) => (b.team === 0 || playerSees(b) ? b : fog.known[b.id]))
      .filter(Boolean);
    for (const b of knownBuildings)
      if (onScreen(b, Math.max(120, Art.visualHeight(b) + b.h / 2))) {
        Art.structure(ctx, b, time);
        if (
          (selectedBuilding === b.id || selectedBuildings.has(b.id)) &&
          b.rally
        ) {
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
        if (selectedBuilding === b.id || selectedBuildings.has(b.id)) {
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
    const engines = state.units.filter(
      (u) => u.team === 0 && u.type === "trebuchet" && selected.has(u.id),
    );
    if (engines.length) {
      drawSiegeUnion(engines);
      ctx.font = "12px Georgia";
      ctx.fillStyle = "#f5d497";
      ctx.fillText(
        "Combined siege range 180-690",
        engines[0].x + 190,
        engines[0].y,
      );
    }
    for (const b of selectedStructures(
      (b) => b.kind === "greatengine" && b.progress >= 1,
    )) {
      ctx.save();
      ctx.strokeStyle = "#e8b64bcc";
      ctx.fillStyle = "#d7a34b10";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2200, 0, Math.PI * 2);
      ctx.arc(b.x, b.y, 320, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.stroke();
      ctx.setLineDash([14, 10]);
      ctx.strokeStyle = "#d96b4f99";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 320, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f5d497";
      ctx.font = "bold 13px Georgia";
      ctx.fillText("GREAT ENGINE | 320-2200", b.x + 140, b.y - 100);
      if (b.fireTarget) {
        Art.line(
          ctx,
          [
            [b.fireTarget.x - 14, b.fireTarget.y],
            [b.fireTarget.x + 14, b.fireTarget.y],
          ],
          2,
          "#f2aa4e",
        );
        Art.line(
          ctx,
          [
            [b.fireTarget.x, b.fireTarget.y - 14],
            [b.fireTarget.x, b.fireTarget.y + 14],
          ],
          2,
          "#f2aa4e",
        );
      }
      ctx.restore();
    }
    for (const u of engines) {
      ctx.save();
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
    for (const city of state.cities || [])
      if (onScreen(city, 1200) && playerRemembers(city)) {
        ctx.strokeStyle = city.captured ? "#e9cf8599" : "#d8ae5899";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(city.x, city.y, 100, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#f4e3b8";
        ctx.font = "bold 13px Georgia";
        ctx.textAlign = "center";
        ctx.fillText(city.name, city.x, city.y - 75);
        ctx.font = "10px Georgia";
        ctx.fillText(
          city.captured
            ? "CITY CAPTURED"
            : "REACH THE CAPITAL TO CAPTURE THE CITY",
          city.x,
          city.y + 90,
        );
        if (city.capture > 0 && !city.captured)
          healthBar(ctx, city.x, city.y + 108, city.capture / 12, 110);
      }
    const visible = state.units
      .filter(
        (u) => u.hp > 0 && onScreen(u, 130) && (u.team === 0 || playerSees(u)),
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
    Art.flushFrame();
    // Smoke and sparks remain behind arrowheads and boulders in the canvas stack.
    for (const p of state.particles)
      if (onScreen(p, Math.max(20, p.r * (1 + (p.growth || 0))))) {
        ctx.globalAlpha = 1 - p.t / p.life;
        Art.particle(ctx, p);
      }
    ctx.globalAlpha = 1;
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
        y = b.sy + (b.ty - b.sy) * t,
        height = Math.sin(t * Math.PI) * (b.heavy ? 340 : 150),
        fy = y - height;
      if (onScreen({ x: b.tx, y: b.ty }, b.r)) {
        ctx.strokeStyle = "#b99a6477";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.tx, b.ty, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (onScreen({ x, y }, 12)) Art.ellipse(ctx, x, y, 7, 6, "#44513955");
      if (!onScreen({ x, y: fy }, 55)) continue;
      const arcScale = 1 + Math.sin(t * Math.PI) * 0.3;
      const glowRadius = (b.heavy ? 42 : 17) * arcScale;
      const glow = ctx.createRadialGradient(x, fy, 1, x, fy, glowRadius);
      glow.addColorStop(0, "#fff3b3aa");
      glow.addColorStop(1, "#ef642900");
      ctx.fillStyle = glow;
      ctx.fillRect(
        x - glowRadius,
        fy - glowRadius,
        glowRadius * 2,
        glowRadius * 2,
      );
      if (b.heavy) {
        ctx.save();
        ctx.translate(x, fy);
        ctx.scale(arcScale, arcScale);
        Art.ellipse(ctx, 0, 0, 17, 15, "#2b2623");
        Art.ellipse(ctx, -3, -4, 14, 12, "#837b66");
        for (let i = 0; i < 5; i++)
          Art.line(
            ctx,
            [
              [-10 + i * 5, -10],
              [-12 + i * 5, 10],
            ],
            2,
            "#423d35",
          );
        Art.ellipse(ctx, -5, -6, 5, 3, "#d7c8a6");
        ctx.restore();
      } else Art.ellipse(ctx, x, fy, 6 * arcScale, 6 * arcScale, "#c8451c");
      if (!b.heavy) {
        Art.ellipse(
          ctx,
          x - 1,
          fy - 1,
          4.5 * arcScale,
          4.5 * arcScale,
          "#f5a23b",
        );
        Art.ellipse(
          ctx,
          x - 2,
          fy - 2,
          2.3 * arcScale,
          2.3 * arcScale,
          "#ffe6a0",
        );
      }
    }
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
      (wallAnchor && ["wall", "bastionwall"].includes(placement)
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
        `${count} sections / ${count * BUILDINGS[placement || "wall"].cost.stone} stone / ${count * BUILDINGS[placement || "wall"].cost.wood} wood`,
        wallPreview.end.x + 24,
        wallPreview.end.y - 24,
      );
    }
    const attackTargets = new Set([
      ...friendUnits()
        .filter((u) => selected.has(u.id) && u.manualTarget)
        .map((u) => u.target),
      ...selectedStructures((b) => b.kind === "greatengine").map(
        (b) => b.attackTarget,
      ),
    ]);
    for (const id of attackTargets) {
      const target = getObject(id);
      if (!target || target.hp <= 0 || !playerSees(target)) continue;
      const r = (target.r || 18) + 12 + Math.sin(state.time * 8) * 3;
      ctx.save();
      ctx.strokeStyle = "#ff5544";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
      ctx.stroke();
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(target.x + sign * (r + 10), target.y);
        ctx.lineTo(target.x + sign * (r - 5), target.y);
        ctx.moveTo(target.x, target.y + sign * (r + 10));
        ctx.lineTo(target.x, target.y + sign * (r - 5));
        ctx.stroke();
      }
      ctx.restore();
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
    mc.save();
    mc.scale(sx, sy);
    mc.fillStyle = "#22251d";
    mc.strokeStyle = "#c3af7b";
    mc.lineWidth = 24;
    for (const d of state.terrainFeatures || []) {
      mc.beginPath();
      for (const contour of d.contours || []) {
        contour.forEach((p, i) =>
          i ? mc.lineTo(p.x, p.y) : mc.moveTo(p.x, p.y),
        );
        mc.closePath();
      }
      mc.fill("evenodd");
      mc.stroke();
    }
    mc.restore();
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
          b.team === 3
            ? "#be923d"
            : b.team === 1
              ? "#843d2d"
              : b.team === 2
                ? "#9a8c67"
                : "#eadbb0";
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
        u.team === 3
          ? "#c99c46"
          : u.team === 1
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
      if (["wall", "bastionwall"].includes(placement)) {
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
        .filter((u) => Art.hitUnit(u, d.end, state.time))
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
            Art.hitStructure(b, d.end),
        );
        if (!b && playerRemembers(d.end))
          selectedNode = resourceAt(d.end)?.id || null;
        if (b) {
          if (d.shift && selectedBuildings.has(b.id))
            selectedBuildings.delete(b.id);
          else selectedBuildings.add(b.id);
          selectedBuilding = [...selectedBuildings][0] || null;
          if (!d.shift) selected.clear();
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
  for (const stance of ["fight", "hold", "stand-down"])
    $("stance-" + stance).addEventListener("click", () => setStance(stance));
  $("destroy-button").addEventListener("click", destroySelectedBuilding);
  $("upgrade-gate-button").addEventListener("click", () =>
    queueWallUpgrade("gate"),
  );
  $("upgrade-tower-button").addEventListener("click", () =>
    queueWallUpgrade("tower"),
  );
  function controlGroupMembers(group, owned = null) {
    owned ||= new Map(
      [...state.units, ...state.buildings]
        .filter((o) => o.team === 0 && o.hp > 0)
        .map((o) => [o.id, o]),
    );
    return (state.controlGroups[group] || [])
      .map((id) => owned.get(id))
      .filter(Boolean);
  }
  function controlGroup(group, event = {}) {
    if (!playable()) return;
    const owned = new Map(
      [...state.units, ...state.buildings]
        .filter((o) => o.team === 0 && o.hp > 0)
        .map((o) => [o.id, o]),
    );
    if (event.ctrlKey || event.metaKey) {
      const previous = event.shiftKey
        ? controlGroupMembers(group, owned).map((o) => o.id)
        : [];
      const selection = [
        ...selected,
        ...selectedBuildings,
        selectedBuilding,
      ].filter((id) => owned.has(id));
      state.controlGroups[group] = [...new Set([...previous, ...selection])];
      toast(
        `Group ${group} ${selection.length ? "assigned" : "cleared"} (${state.controlGroups[group].length} members).`,
      );
    } else {
      const members = controlGroupMembers(group, owned);
      selected = new Set(members.filter((o) => o.type).map((o) => o.id));
      selectedBuildings = new Set(
        members.filter((o) => o.kind).map((o) => o.id),
      );
      selectedBuilding = [...selectedBuildings][0] || null;
      selectedNode = null;
      placement = null;
      mode = "move";
      if (!members.length)
        toast(
          `Group ${group} is empty. Select units or buildings and press Ctrl+${group}.`,
        );
      else if (selectedBuildings.size) setTab("army");
    }
    updateUI();
  }

  for (const group of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "control-group-" + group;
    button.textContent = group;
    button.addEventListener("click", (event) => controlGroup(group, event));
    $("control-groups").append(button);
    groupButtons.set(group, button);
  }
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
    if (/^(Digit|Numpad)[0-9]$/.test(e.code)) {
      e.preventDefault();
      const group = e.code.slice(-1);
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        Number(group) >= 1 &&
        Number(group) <= 7
      )
        recruit(keys[Number(group) - 1]);
      else controlGroup(group, e);
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
    ["scout-button", autoScout],
    ["bless-button", bless],
    ["deploy-button", toggleDeployment],
    ["cancel-button", cancel],
    ["cancel-targeting-button", cancelSiegeTargeting],
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
    if (!TEST && playable()) nav.process(3);
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
    consumeArmyTransit: () => {
      const level = state.armyTransitPending;
      state.armyTransitPending = null;
      return Number.isInteger(level) ? level : null;
    },
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
      if (!playable()) return;
      const b = nextStructure(
        "gate",
        selectedStructures((b) => b.kind === "gate" && b.progress >= 1),
        true,
      );
      if (b) {
        b.autoClosed = false;
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
        if (Array.isArray(state.decorations)) {
          decorations = state.decorations;
          delete state.decorations;
        }
        rebuildNavigation();
        rebuildSpatial();
        fog.update(state.units, state.buildings);
        enemyFog.update(state.units, state.buildings);
        militiaFog ||= new window.CruciataFog(W, H, null, 3);
        militiaFog.update(state.units, state.buildings);
        updateUI();
      }
    },
    vision: (p) => ({ visible: playerSees(p), explored: playerRemembers(p) }),
    audio: () => window.CruciataAudio.status(),
    land: (p, margin = 0, allowBridge = false) =>
      TEST ? landFree(p.x, p.y, margin, allowBridge) : false,
    site: (kind, p) => (TEST && BUILDINGS[kind] ? validSite(kind, p) : false),
    free: (p) => (TEST ? groundFree(p.x, p.y, 8) : false),
    route: (a, b) => (TEST ? nav.find(a, b) : []),
    order: (ids, target, attack = false) => {
      if (TEST) {
        selected = new Set(ids);
        issueOrder(target.x, target.y, attack, false);
      }
    },
    save: () => saveGame(true),
  };
})();
