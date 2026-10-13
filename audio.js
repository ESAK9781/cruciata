/* Kenney CC0 recordings, mixed locally with distance and voice limits. */
(() => {
  "use strict";
  const bank = {
    select: ["cloth1"],
    order: ["drawKnife1"],
    recruit: ["confirmation_001"],
    hit: [
      "impactMetal_medium_000",
      "impactMetal_medium_001",
      "impactMetal_medium_002",
      "impactMetal_medium_003",
      "impactPlate_light_000",
      "knifeSlice",
    ],
    bell: ["impactBell_heavy_000"],
    horn: ["confirmation_001"],
    impact: [
      "impactWood_heavy_000",
      "impactSoft_heavy_000",
      "impactMetal_heavy_000",
      "impactPunch_medium_000",
    ],
    bless: ["impactBell_heavy_000"],
    wood: ["chop"],
    gold: ["impactMining_000"],
    stone: ["impactMining_001"],
    food: ["cloth1"],
    build: ["impactWood_medium_000"],
    deliver: ["handleCoins"],
    click: ["click_001"],
    siege: ["creak1"],
    arrow: ["knifeSlice2"],
  };
  const cache = new Map(),
    last = new Map(),
    counts = new Map(),
    active = new Set();
  let enabled = true,
    played = 0,
    effectsVolume = 0.65,
    musicVolume = 0.2,
    unlocked = false;
  const tracks = [
    { id: "midday-at-the-oasis", title: "Midday at the Oasis" },
    { id: "lanterns-by-the-slope", title: "Lanterns by the Slope" },
    {
      id: "shadows-in-the-stone-courtyard",
      title: "Shadows in the Stone Courtyard",
    },
    { id: "iter-nostrum", title: "Iter Nostrum" },
  ];
  class ShufflePlaylist {
    constructor(ids, previous = null, bag = []) {
      this.ids = [...ids];
      this.previous = previous;
      this.bag = bag.filter(
        (id, i) => ids.includes(id) && bag.indexOf(id) === i,
      );
    }
    next() {
      if (!this.bag.length) {
        this.bag = [...this.ids];
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
        if (this.bag[0] === this.previous && this.bag.length > 1)
          [this.bag[0], this.bag[1]] = [this.bag[1], this.bag[0]];
      }
      this.previous = this.bag.shift();
      return this.previous;
    }
  }
  let history = {};
  try {
    history = JSON.parse(
      localStorage.getItem("cruciata-music-history-v1") || "{}",
    );
  } catch {}
  const playlist = new ShufflePlaylist(
    tracks.map((t) => t.id),
    history.previous,
    history.bag || [],
  );
  const music = new Audio();
  music.preload = "metadata";
  let current = null,
    failures = 0;
  function musicGain() {
    const fadeIn = Math.min(1, music.currentTime / 3);
    const fadeOut = Number.isFinite(music.duration)
      ? Math.min(1, Math.max(0, (music.duration - music.currentTime) / 3))
      : 1;
    music.volume = Math.min(1, musicVolume * Math.min(fadeIn, fadeOut));
  }
  function resumeMusic() {
    if (!unlocked || musicVolume <= 0 || document.hidden) return;
    if (!current) {
      nextMusic();
      return;
    }
    music.play().catch(() => {});
  }
  function nextMusic() {
    if (failures >= tracks.length) return;
    const nextId = playlist.next();
    current = tracks.find((t) => t.id === nextId);
    music.src = `assets/music/${current.id}.mp3`;
    music.volume = 0;
    try {
      localStorage.setItem(
        "cruciata-music-history-v1",
        JSON.stringify({ previous: playlist.previous, bag: playlist.bag }),
      );
    } catch {}
    resumeMusic();
  }
  music.ontimeupdate = musicGain;
  music.onended = nextMusic;
  music.onplaying = () => {
    failures = 0;
    musicGain();
  };
  music.onerror = () => {
    failures++;
    nextMusic();
  };
  for (const event of ["pointerdown", "keydown"])
    document.addEventListener(
      event,
      () => {
        unlocked = true;
        resumeMusic();
      },
      { passive: true },
    );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) music.pause();
    else resumeMusic();
  });
  window.CruciataShufflePlaylist = ShufflePlaylist;
  for (const names of Object.values(bank))
    for (const name of names)
      if (!cache.has(name)) {
        const a = new Audio(`assets/audio/${name}.ogg`);
        a.preload = "auto";
        cache.set(name, a);
      }
  window.CruciataAudio = {
    nextTrack() {
      music.pause();
      nextMusic();
    },
    setVolumes(effects, background) {
      effectsVolume = Math.max(0, Math.min(1, effects));
      musicVolume = Math.max(0, Math.min(1, background));
      for (const a of active)
        a.volume = Math.min(1, (a.baseVolume || 0) * effectsVolume);
      musicGain();
      if (musicVolume <= 0) music.pause();
      else resumeMusic();
    },
    setEnabled(value) {
      enabled = value;
      if (!value)
        for (const a of active) {
          a.pause();
          active.delete(a);
        }
    },
    play(kind, volume = 1) {
      if (!enabled || effectsVolume <= 0 || volume < 0.03 || active.size >= 10)
        return;
      const now = performance.now(),
        interval = ["hit", "wood", "stone", "gold", "build", "food"].includes(
          kind,
        )
          ? 180
          : 70;
      if (now - (last.get(kind) || -10000) < interval) return;
      last.set(kind, now);
      const names = bank[kind] || bank.click,
        n = counts.get(kind) || 0;
      counts.set(kind, n + 1);
      const a = cache.get(names[n % names.length]).cloneNode();
      a.baseVolume = Math.min(
        0.7,
        volume *
          (["hit", "wood", "gold", "stone", "food", "build"].includes(kind)
            ? 0.24
            : 0.48),
      );
      a.volume = a.baseVolume * effectsVolume;
      active.add(a);
      a.onended = () => active.delete(a);
      a.onerror = () => active.delete(a);
      a.play()
        .then(() => played++)
        .catch(() => active.delete(a));
    },
    status() {
      return {
        recordings: cache.size,
        active: active.size,
        played,
        enabled,
        effectsVolume,
        musicVolume,
        music: {
          id: current?.id,
          title: current?.title,
          playing: !!current && !music.paused,
          duration: music.duration || 0,
          time: music.currentTime,
          gain: music.volume,
          queue: [...playlist.bag],
        },
      };
    },
  };
})();
