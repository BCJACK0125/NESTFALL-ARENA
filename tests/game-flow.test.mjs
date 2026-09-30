import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG, createRng } from "../js/engine.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
    return this.values.has(name);
  }
  contains(name) { return this.values.has(name); }
}

const gradient = () => ({ addColorStop() {} });
const drawingContext = new Proxy({
  createLinearGradient: gradient,
  createRadialGradient: gradient,
  measureText: (text) => ({ width: String(text).length * 8 }),
}, {
  get(target, property) {
    if (property in target) return target[property];
    return () => {};
  },
  set(target, property, value) {
    target[property] = value;
    return true;
  },
});

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = id === "pauseLayer" || id === "gameOverLayer";
    this.open = false;
    this.width = 1280;
    this.height = 720;
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = "";
    this.innerHTML = "";
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getContext() { return drawingContext; }
  focus() {}
  querySelector() { return null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  requestFullscreen() { return Promise.resolve(); }
}

const ids = [
  "gameCanvas", "gameShell", "menuLayer", "startButton", "tutorialButton",
  "tutorialDialog", "closeTutorial", "tutorialStart", "pauseLayer", "resumeButton",
  "restartButton", "menuButton", "gameOverLayer", "resultEyebrow", "resultTitle",
  "resultSummary", "resultStats", "rematchButton", "resultMenuButton", "soundButton",
  "motionButton", "fullscreenButton", "liveRegion", "statusStrip",
];
const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
const documentListeners = new Map();

const fakeDocument = {
  hidden: false,
  fullscreenElement: null,
  getElementById: (id) => elements.get(id) ?? null,
  addEventListener: (name, callback) => documentListeners.set(name, callback),
  exitFullscreen: () => Promise.resolve(),
};
const fakeWindow = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const memoryStorage = new Map();

globalThis.document = fakeDocument;
globalThis.window = fakeWindow;
globalThis.location = { search: "?test=1" };
globalThis.localStorage = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, value) => memoryStorage.set(key, String(value)),
};
globalThis.requestAnimationFrame = () => 0;
fakeWindow.document = fakeDocument;
fakeWindow.location = globalThis.location;
fakeWindow.localStorage = globalThis.localStorage;
fakeWindow.requestAnimationFrame = globalThis.requestAnimationFrame;

const { game } = await import(`../js/game.js?headless-flow=${Date.now()}`);
const api = fakeWindow.__gameTest;

test("無瀏覽器 DOM／Canvas 模擬可載入完整遊戲", () => {
  assert.ok(api);
  assert.equal(game.state, "menu");
  assert.equal(elements.get("gameCanvas").width, 1280);
  assert.equal(elements.get("gameCanvas").height, 720);
});

test("雙方同一物理幀可蓄力、發射與開盾", () => {
  api.start(0xc0ffee);
  const initial = api.snapshot();
  api.keyDown("KeyF");
  api.keyDown("KeyJ");
  api.step(72);
  const held = api.snapshot();
  assert.equal(held.players[0].charging, true);
  assert.equal(held.players[1].charging, true);

  api.keyUp("KeyF");
  api.keyUp("KeyJ");
  api.step(1);
  const fired = api.snapshot();
  assert.equal(fired.players[0].shots, 1);
  assert.equal(fired.players[1].shots, 1);
  assert.ok(fired.projectiles >= 2);

  api.keyDown("KeyG");
  api.keyDown("KeyK");
  api.step(1);
  const defended = api.snapshot();
  assert.ok(defended.players[0].shieldTimer > 0);
  assert.ok(defended.players[1].shieldTimer > 0);
  assert.ok(defended.players[0].focus < initial.players[0].focus);
  assert.ok(defended.players[1].focus < initial.players[1].focus);
});

test("投射物長時間步進後保持有限，沒有 NaN 或物件洩漏", () => {
  api.step(120 * 9);
  const snapshot = api.snapshot();
  assert.ok(snapshot.projectiles <= 18);
  assert.ok(snapshot.particles <= 340);
  for (const projectile of game.projectiles) {
    assert.ok(Number.isFinite(projectile.x));
    assert.ok(Number.isFinite(projectile.y));
    assert.ok(Number.isFinite(projectile.vx));
    assert.ok(Number.isFinite(projectile.vy));
  }
  for (const player of snapshot.players) {
    assert.ok(player.focus >= 0 && player.focus <= 100);
    assert.ok(player.coreHp >= 0 && player.coreHp <= CONFIG.coreHp);
  }
});

test("暫停、三秒恢復倒數與圖層狀態一致", () => {
  api.restart(81);
  game.onKeyDown({ code: "Escape", repeat: false, preventDefault() {} });
  assert.equal(game.state, "paused");
  assert.equal(elements.get("pauseLayer").hidden, false);
  game.onKeyDown({ code: "Escape", repeat: false, preventDefault() {} });
  assert.equal(game.state, "countdown");
  assert.equal(elements.get("pauseLayer").hidden, true);
  api.step(370);
  assert.equal(game.state, "playing");
});

test("受傷、結算與重賽形成完整閉環", () => {
  api.restart(91);
  api.forceDamage(0, 75);
  assert.equal(api.snapshot().players[0].coreHp, CONFIG.coreHp - 75);
  api.forceDamage(0, 9999);
  const result = api.snapshot();
  assert.equal(result.state, "finished");
  assert.equal(result.winner, 1);
  assert.equal(elements.get("gameOverLayer").hidden, false);

  api.restart(92);
  const restarted = api.snapshot();
  assert.equal(restarted.state, "playing");
  assert.equal(restarted.players[0].coreHp, CONFIG.coreHp);
  assert.equal(restarted.players[1].coreHp, CONFIG.coreHp);
  assert.equal(restarted.projectiles, 0);
  assert.equal(elements.get("gameOverLayer").hidden, true);
});

test("多場完整物理 bot 對局能拆牆、傷害核心並正常結算", () => {
  const totals = { broken: 0, coreDamage: 0, leftWins: 0, rightWins: 0, draws: 0, elapsed: 0, coreFinishes: 0 };
  const matches = Math.max(8, Number(process.env.PHYSICS_MATCHES) || 24);

  for (let matchIndex = 0; matchIndex < matches; matchIndex += 1) {
    const pairIndex = Math.floor(matchIndex / 2);
    const seed = (0x71a5e + Math.imul(pairIndex + 1, 2654435761)) >>> 0;
    const strategySeeds = [
      (seed ^ 0x51d3a7c1) >>> 0,
      (seed ^ 0xa8924e3b) >>> 0,
    ];
    if (matchIndex % 2 === 1) strategySeeds.reverse();
    const botRng = strategySeeds.map((strategySeed) => createRng(strategySeed));
    api.restart(seed);
    // The random live wind is zero-mean over many human rounds. Keeping it
    // neutral here isolates left/right geometry, while paired strategy seeds
    // swap the exact two bot personalities between sides.
    game.wind = 0;
    game.windTarget = 0;
    game.nextWindAt = Infinity;
    const bots = [{ chargeFrames: 0 }, { chargeFrames: 0 }];

    for (let frame = 0; frame < CONFIG.matchSeconds * 120 + 4 && game.state === "playing"; frame += 1) {
      for (const player of game.players) {
        const bot = bots[player.id];
        const rng = botRng[player.id];
        const incoming = game.projectiles.find((projectile) => {
          if (projectile.owner === player.id || projectile.remove) return false;
          const distance = Math.hypot(projectile.x - player.meta.coreX, projectile.y - 556);
          const movingInward = player.id === 0 ? projectile.vx < 0 : projectile.vx > 0;
          return movingInward && distance < 178;
        });
        if (
          incoming
          && player.shieldCooldown <= 0
          && player.shieldTimer <= 0
          && player.focus >= CONFIG.shieldCost
          && rng() < 0.34
        ) api.keyDown(player.meta.shield);

        if (player.charging) {
          bot.chargeFrames -= 1;
          if (bot.chargeFrames <= 0) api.keyUp(player.meta.fire);
          continue;
        }

        const active = game.projectiles.find((projectile) => (
          !projectile.remove
          && projectile.sourcePlayer === player.id
          && projectile.shotId === player.activeShot
          && !projectile.abilityUsed
        ));
        if (active) {
          const crossed = player.id === 0 ? active.x > 690 : active.x < 590;
          const ready = active.typeId === "bomb" ? crossed || active.age > 1.25 : active.age > 0.52;
          if (ready) {
            api.keyDown(player.meta.fire);
            api.keyUp(player.meta.fire);
          }
          continue;
        }

        if (!game.hasActiveShot(player) && player.reload <= 0) {
          if (player.focus >= 46 && rng() < 0.34) player.ammoIndex = 2;
          else if (player.focus >= 24 && rng() < 0.48) player.ammoIndex = 1;
          else player.ammoIndex = 0;
          player.aim = (34 + rng() * 19) * Math.PI / 180;
          api.keyDown(player.meta.fire);
          bot.chargeFrames = 55 + Math.floor(rng() * 72);
        }
      }
      game.update(CONFIG.fixedStep);
    }

    assert.equal(game.state, "finished", `seed ${seed} 應正常結算`);
    assert.ok(game.elapsed <= CONFIG.matchSeconds + CONFIG.fixedStep);
    totals.broken += game.players[0].stats.structuresBroken + game.players[1].stats.structuresBroken;
    totals.coreDamage += game.players[0].stats.coreDamage + game.players[1].stats.coreDamage;
    totals.elapsed += game.elapsed;
    if (game.result.reason === "core") totals.coreFinishes += 1;
    if (game.result.winner === 0) totals.leftWins += 1;
    else if (game.result.winner === 1) totals.rightWins += 1;
    else totals.draws += 1;
  }

  assert.ok(totals.broken >= matches * 2, `拆牆量過低：${totals.broken}`);
  assert.ok(totals.coreDamage > 0, "實際彈道應能穿過工事並傷害核心");
  assert.equal(totals.leftWins + totals.rightWins + totals.draws, matches);
  assert.ok(totals.leftWins > 0 && totals.rightWins > 0, `物理對局不應固定偏向單側：${JSON.stringify(totals)}`);
  const decisive = totals.leftWins + totals.rightWins;
  if (decisive >= 8) {
    const leftRate = totals.leftWins / decisive;
    assert.ok(leftRate >= 0.25 && leftRate <= 0.75, `小樣本物理勝率偏斜：${JSON.stringify(totals)}`);
  }
  if (process.env.PHYSICS_REPORT === "1") {
    console.log("Full-physics bot sample", {
      ...totals,
      averageSeconds: totals.elapsed / matches,
      coreFinishRate: totals.coreFinishes / matches,
    });
  }
});
