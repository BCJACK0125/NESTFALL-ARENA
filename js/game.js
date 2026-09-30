import {
  BIRD_TYPES,
  CONFIG,
  MATERIALS,
  PLAYER_META,
  circleAabbCollision,
  clamp,
  createRng,
  createStructures,
  decideTimedWinner,
  easeOutCubic,
  impactDamage,
  lerp,
  reflectVelocity,
  rotateVector,
  scoreSide,
  trajectoryPoints,
} from "./engine.js";
import { audio } from "./audio.js";

const $ = (selector) => document.getElementById(selector);
const dom = {
  canvas: $("gameCanvas"),
  shell: $("gameShell"),
  menu: $("menuLayer"),
  start: $("startButton"),
  tutorial: $("tutorialButton"),
  tutorialDialog: $("tutorialDialog"),
  closeTutorial: $("closeTutorial"),
  tutorialStart: $("tutorialStart"),
  pause: $("pauseLayer"),
  resume: $("resumeButton"),
  restart: $("restartButton"),
  menuButton: $("menuButton"),
  gameOver: $("gameOverLayer"),
  resultEyebrow: $("resultEyebrow"),
  resultTitle: $("resultTitle"),
  resultSummary: $("resultSummary"),
  resultStats: $("resultStats"),
  rematch: $("rematchButton"),
  resultMenu: $("resultMenuButton"),
  sound: $("soundButton"),
  motion: $("motionButton"),
  fullscreen: $("fullscreenButton"),
  live: $("liveRegion"),
  status: $("statusStrip"),
};

const GAME_KEYS = new Set([
  "KeyW", "KeyS", "KeyF", "KeyG", "KeyR",
  "ArrowUp", "ArrowDown", "KeyJ", "KeyK", "KeyL",
]);

function setLayerVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle("is-hidden", !visible);
}

const DEFAULT_SETTINGS = {
  sound: true,
  reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("nestfall-settings") || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem("nestfall-settings", JSON.stringify(settings));
  } catch {
    // Storage is optional; private browsing must never block a match.
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function pointToRectDistance(x, y, rect) {
  const dx = Math.max(Math.abs(x - rect.x) - rect.w / 2, 0);
  const dy = Math.max(Math.abs(y - rect.y) - rect.h / 2, 0);
  return Math.hypot(dx, dy);
}

class NestfallGame {
  constructor() {
    this.canvas = dom.canvas;
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.settings = loadSettings();
    this.testMode = new URLSearchParams(location.search).has("test");
    this.keys = new Set();
    this.state = "menu";
    this.previousTimestamp = performance.now();
    this.accumulator = 0;
    this.dpr = 1;
    this.seed = (Date.now() ^ 0x51f15e) >>> 0;
    this.lastCountdownBeat = 4;
    this.result = null;
    this.resumeCountdown = false;
    this.resetWorld(this.seed);
    this.bindEvents();
    this.resizeCanvas();
    this.syncSettingsUi();
    requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  resetWorld(seed = this.seed) {
    this.seed = Number(seed) >>> 0;
    this.rng = createRng(this.seed);
    this.visualRng = createRng(this.seed ^ 0xa17f3c9d);
    this.elapsed = 0;
    this.remaining = CONFIG.matchSeconds;
    this.countdown = 3.15;
    this.lastCountdownBeat = 4;
    this.wind = 0;
    this.windTarget = 0;
    this.nextWindAt = 7;
    this.overdriveAnnounced = false;
    this.projectiles = [];
    this.particles = [];
    this.floaters = [];
    this.banners = [];
    this.structures = [...createStructures(0), ...createStructures(1)];
    this.players = PLAYER_META.map((meta) => ({
      id: meta.id,
      meta,
      coreHp: CONFIG.coreHp,
      coreFlash: 0,
      coreGuard: 0,
      emergencyUsed: false,
      focus: CONFIG.focusStart,
      scrap: 0,
      aim: 44 * Math.PI / 180,
      charge: 0,
      charging: false,
      reload: 0,
      shieldTimer: 0,
      shieldCooldown: 0,
      shieldAge: 0,
      ammoIndex: 0,
      shotSerial: 0,
      activeShot: null,
      landedShotIds: new Set(),
      forgePulse: 0,
      noticeCooldown: 0,
      stats: {
        shots: 0,
        hitShots: 0,
        abilities: 0,
        impacts: 0,
        damage: 0,
        coreDamage: 0,
        blocks: 0,
        structuresBroken: 0,
        structuresLost: 0,
        crystals: 0,
        forges: 0,
      },
    }));
    this.crystals = [
      { id: 0, x: 640, y: 246, radius: 14, active: true, respawn: 0, phase: 0 },
      { id: 1, x: 590, y: 362, radius: 13, active: true, respawn: 0, phase: 1.7 },
      { id: 2, x: 690, y: 465, radius: 13, active: true, respawn: 0, phase: 3.4 },
    ];
    this.stars = Array.from({ length: 95 }, () => ({
      x: this.visualRng.range(0, CONFIG.width),
      y: this.visualRng.range(25, 455),
      radius: this.visualRng.range(0.45, 1.85),
      alpha: this.visualRng.range(0.24, 0.86),
      phase: this.visualRng.range(0, Math.PI * 2),
    }));
    this.clouds = Array.from({ length: 7 }, (_, index) => ({
      x: this.visualRng.range(-120, CONFIG.width + 100),
      y: this.visualRng.range(120, 390),
      width: this.visualRng.range(110, 240),
      speed: this.visualRng.range(2, 7) * (index % 2 ? 1 : -1),
      alpha: this.visualRng.range(0.025, 0.07),
    }));
    this.shake = 0;
    this.result = null;
    this.keys.clear();
  }

  bindEvents() {
    window.addEventListener("resize", () => this.resizeCanvas());
    document.addEventListener("keydown", (event) => this.onKeyDown(event));
    document.addEventListener("keyup", (event) => this.onKeyUp(event));
    window.addEventListener("blur", () => this.onWindowBlur());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.onWindowBlur();
    });

    dom.start?.addEventListener("click", () => this.startGame());
    dom.tutorial?.addEventListener("click", () => {
      audio.init();
      audio.play("ui");
      dom.tutorialDialog?.showModal();
    });
    dom.closeTutorial?.addEventListener("click", () => dom.tutorialDialog?.close());
    dom.tutorialStart?.addEventListener("click", () => {
      dom.tutorialDialog?.close();
      this.startGame();
    });
    dom.resume?.addEventListener("click", () => this.resumeGame());
    dom.restart?.addEventListener("click", () => this.startGame((this.seed + 1) >>> 0));
    dom.menuButton?.addEventListener("click", () => this.returnToMenu());
    dom.rematch?.addEventListener("click", () => this.startGame((this.seed + 1) >>> 0));
    dom.resultMenu?.addEventListener("click", () => this.returnToMenu());
    dom.sound?.addEventListener("click", () => this.toggleSound());
    dom.motion?.addEventListener("click", () => this.toggleMotion());
    dom.fullscreen?.addEventListener("click", () => this.toggleFullscreen());
    document.addEventListener("fullscreenchange", () => this.syncSettingsUi());

    dom.tutorialDialog?.addEventListener("click", (event) => {
      if (event.target === dom.tutorialDialog) dom.tutorialDialog.close();
    });
  }

  resizeCanvas() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(CONFIG.width * this.dpr);
    this.canvas.height = Math.round(CONFIG.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  syncSettingsUi() {
    audio.setEnabled(this.settings.sound);
    const sync = (button, enabled, onTitle, offTitle) => {
      if (!button) return;
      button.classList.toggle("is-off", !enabled);
      button.setAttribute("aria-pressed", String(enabled));
      button.title = enabled ? onTitle : offTitle;
      button.setAttribute("aria-label", button.title);
    };
    sync(dom.sound, this.settings.sound, "關閉音效", "開啟音效");
    sync(dom.motion, !this.settings.reducedMotion, "降低動態效果", "開啟完整動態效果");
    if (dom.fullscreen) {
      dom.fullscreen.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
      dom.fullscreen.title = document.fullscreenElement ? "離開全螢幕" : "進入全螢幕";
    }
    document.documentElement?.setAttribute("data-motion", this.settings.reducedMotion ? "reduced" : "full");
  }

  toggleSound() {
    this.settings.sound = !this.settings.sound;
    audio.setEnabled(this.settings.sound);
    if (this.settings.sound) {
      audio.init();
      audio.play("ui");
      if (this.state === "playing" || this.state === "countdown") audio.startMusic();
    }
    saveSettings(this.settings);
    this.syncSettingsUi();
  }

  toggleMotion() {
    this.settings.reducedMotion = !this.settings.reducedMotion;
    if (this.settings.reducedMotion) {
      this.particles.length = Math.min(this.particles.length, 40);
      this.shake = 0;
    }
    audio.play("ui");
    saveSettings(this.settings);
    this.syncSettingsUi();
  }

  async toggleFullscreen() {
    audio.init();
    audio.play("ui");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await dom.shell?.requestFullscreen();
    } catch {
      this.announce("瀏覽器未允許全螢幕模式");
    }
  }

  startGame(seed = (Date.now() ^ this.seed) >>> 0) {
    audio.init();
    audio.play("ui");
    audio.startMusic();
    this.resetWorld(seed);
    this.state = "countdown";
    this.resumeCountdown = false;
    setLayerVisible(dom.menu, false);
    setLayerVisible(dom.pause, false);
    setLayerVisible(dom.gameOver, false);
    dom.shell?.classList.add("is-playing");
    this.canvas.focus({ preventScroll: true });
    this.announce("對戰即將開始。三、二、一。");
  }

  startImmediately(seed = 0x5151) {
    this.startGame(seed);
    this.state = "playing";
    this.countdown = 0;
    this.lastCountdownBeat = 0;
  }

  returnToMenu() {
    audio.play("ui");
    audio.stopMusic();
    this.state = "menu";
    this.clearInputs();
    setLayerVisible(dom.menu, true);
    setLayerVisible(dom.pause, false);
    setLayerVisible(dom.gameOver, false);
    dom.shell?.classList.remove("is-playing");
    this.announce("已返回主選單");
  }

  pauseGame() {
    if (this.state !== "playing" && this.state !== "countdown") return;
    this.state = "paused";
    this.clearInputs();
    audio.stopMusic();
    setLayerVisible(dom.pause, true);
    this.announce("遊戲已暫停");
  }

  resumeGame() {
    if (this.state !== "paused") return;
    audio.init();
    audio.play("ui");
    audio.startMusic();
    setLayerVisible(dom.pause, false);
    this.state = "countdown";
    this.countdown = 3.05;
    this.lastCountdownBeat = 4;
    this.resumeCountdown = true;
    this.canvas.focus({ preventScroll: true });
  }

  onWindowBlur() {
    this.keys.clear();
    this.players.forEach((player) => {
      player.charging = false;
      player.charge = 0;
    });
    if (!this.testMode) this.pauseGame();
  }

  clearInputs() {
    this.keys.clear();
    this.players.forEach((player) => {
      player.charging = false;
      player.charge = 0;
    });
  }

  onKeyDown(event) {
    const interactiveTarget = event.target?.closest?.("button, a, input, select, textarea, [role='button']");
    if (GAME_KEYS.has(event.code) || (event.code === "Space" && !interactiveTarget)) event.preventDefault();
    if (event.code === "Escape" || event.code === "KeyP") {
      if (this.state === "paused") this.resumeGame();
      else this.pauseGame();
      return;
    }
    if (dom.tutorialDialog?.open) return;

    const menuStartKey = event.code === "KeyF"
      || event.code === "KeyJ"
      || ((event.code === "Space" || event.code === "Enter") && !interactiveTarget);
    if (this.state === "menu" && menuStartKey) {
      if (!event.repeat) this.startGame();
      return;
    }
    if (this.state === "paused" && (event.code === "KeyF" || event.code === "KeyJ")) {
      if (!event.repeat) this.resumeGame();
      return;
    }
    if (this.state !== "playing") return;

    this.keys.add(event.code);
    if (event.repeat) return;
    const player = this.players.find((candidate) => candidate.meta.fire === event.code);
    if (player) this.pressFire(player);
    const defender = this.players.find((candidate) => candidate.meta.shield === event.code);
    if (defender) this.activateShield(defender);
    const cycler = this.players.find((candidate) => candidate.meta.cycle === event.code);
    if (cycler) this.cycleAmmo(cycler);
  }

  onKeyUp(event) {
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    this.keys.delete(event.code);
    if (this.state !== "playing") return;
    const player = this.players.find((candidate) => candidate.meta.fire === event.code);
    if (player) this.releaseFire(player);
  }

  pressFire(player) {
    const skillProjectile = this.projectiles.find((projectile) => (
      !projectile.remove
      && projectile.sourcePlayer === player.id
      && projectile.shotId === player.activeShot
      && !projectile.abilityUsed
      && projectile.age >= 0.11
    ));
    if (skillProjectile) {
      this.activateProjectileSkill(player, skillProjectile);
      return;
    }

    if (this.hasActiveShot(player)) return;
    if (player.reload > 0) {
      this.softNotice(player, `裝填 ${player.reload.toFixed(1)}s`);
      return;
    }
    player.charging = true;
    player.charge = 0;
    audio.play("ui", { pitch: 0.82 });
  }

  releaseFire(player) {
    if (!player.charging) return;
    this.launchProjectile(player);
  }

  hasActiveShot(player) {
    if (player.activeShot === null) return false;
    const members = this.projectiles.filter((projectile) => (
      !projectile.remove
      && projectile.sourcePlayer === player.id
      && projectile.shotId === player.activeShot
    ));
    if (members.length === 0) {
      player.activeShot = null;
      return false;
    }

    // The player keeps control long enough to trigger the airborne skill, but a
    // harmless ricochet must not lock the launcher for the full projectile life.
    // This permits overlapping debris and counter-shots without projectile spam.
    const skillStillAvailable = members.some((projectile) => !projectile.abilityUsed && projectile.age < 3.2);
    const launchLock = members.some((projectile) => projectile.age < 1.65);
    if (skillStillAvailable || launchLock) return true;
    player.activeShot = null;
    return false;
  }

  launchProjectile(player) {
    let type = BIRD_TYPES[player.ammoIndex];
    if (player.focus + 1e-6 < type.cost) {
      type = BIRD_TYPES[0];
      player.ammoIndex = 0;
      this.softNotice(player, "能量不足 · 改用疾風");
    }
    player.focus = clamp(player.focus - type.cost, 0, CONFIG.focusMax);
    const charge = clamp(0.14 + player.charge * 0.86, 0, 1);
    const speed = lerp(CONFIG.launchSpeedMin, CONFIG.launchSpeedMax, easeOutCubic(charge)) * type.speed;
    const direction = player.meta.direction;
    const shotId = `${player.id}-${++player.shotSerial}`;
    const projectile = this.makeProjectile({
      owner: player.id,
      sourcePlayer: player.id,
      shotId,
      type,
      x: player.meta.slingX + direction * 25,
      y: 542,
      vx: direction * Math.cos(player.aim) * speed,
      vy: -Math.sin(player.aim) * speed,
    });
    this.projectiles.push(projectile);
    player.activeShot = shotId;
    player.reload = type.reload;
    player.charging = false;
    player.charge = 0;
    player.stats.shots += 1;
    this.spawnBurst(projectile.x, projectile.y, type.color, 7, 115);
    audio.play("shoot", { pitch: type.id === "bomb" ? 0.72 : type.id === "split" ? 1.12 : 1 });
  }

  makeProjectile({ owner, sourcePlayer, shotId, type, x, y, vx, vy, shard = false }) {
    return {
      id: `${shotId}-${Math.floor(this.rng() * 1e8).toString(36)}`,
      owner,
      sourcePlayer,
      shotId,
      typeId: type.id,
      color: type.color,
      glyph: type.glyph,
      x,
      y,
      vx,
      vy,
      radius: shard ? 9 : type.radius,
      mass: shard ? 0.46 : type.mass,
      damageMultiplier: shard ? 0.62 : type.damage,
      abilityUsed: shard,
      isShard: shard,
      age: 0,
      rotation: 0,
      spin: this.rng.range(-4.5, 4.5),
      trail: [],
      trailTimer: 0,
      integrity: shard ? 1 : type.id === "bomb" ? 3 : 2,
      groundHits: 0,
      hitBlocks: new Set(),
      hitCores: new Set(),
      shieldHits: new Set(),
      clashHits: new Set(),
      remove: false,
      reflected: false,
      collapseDamage: 0,
    };
  }

  activateProjectileSkill(player, projectile) {
    projectile.abilityUsed = true;
    player.stats.abilities += 1;
    if (projectile.typeId === "dart") {
      const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
      projectile.vx += projectile.vx / speed * 275;
      projectile.vy += projectile.vy / speed * 275;
      projectile.spin *= 1.8;
      this.spawnBurst(projectile.x, projectile.y, "#ffe98c", 14, 175);
      this.addText(projectile.x, projectile.y - 30, "疾風推進", "#ffe98c", 0.78);
      audio.play("shoot", { pitch: 1.45 });
    } else if (projectile.typeId === "split") {
      const rotations = [-0.145, 0, 0.145];
      for (const radians of rotations) {
        const velocity = rotateVector(projectile.vx * 1.03, projectile.vy * 1.03, radians);
        this.projectiles.push(this.makeProjectile({
          owner: projectile.owner,
          sourcePlayer: projectile.sourcePlayer,
          shotId: projectile.shotId,
          type: BIRD_TYPES[1],
          x: projectile.x,
          y: projectile.y,
          vx: velocity.x,
          vy: velocity.y,
          shard: true,
        }));
      }
      projectile.remove = true;
      this.spawnBurst(projectile.x, projectile.y, "#a8f4ff", 18, 205);
      this.addText(projectile.x, projectile.y - 30, "三相展開", "#a8f4ff", 0.78);
      audio.play("crystal", { pitch: 1.18 });
    } else if (projectile.typeId === "bomb") {
      this.explodeProjectile(projectile, 1);
    }
  }

  activateShield(player) {
    if (player.shieldCooldown > 0 || player.shieldTimer > 0) {
      this.softNotice(player, `護盾冷卻 ${Math.max(player.shieldCooldown, player.shieldTimer).toFixed(1)}s`);
      return;
    }
    if (player.focus < CONFIG.shieldCost) {
      this.softNotice(player, `護盾需要 ${CONFIG.shieldCost} 能量`);
      return;
    }
    player.focus -= CONFIG.shieldCost;
    player.shieldTimer = CONFIG.shieldDuration;
    player.shieldCooldown = CONFIG.shieldCooldown + CONFIG.shieldDuration;
    player.shieldAge = 0;
    this.spawnRing(player.meta.coreX, 556, player.meta.color, CONFIG.shieldRadius);
    this.addText(player.meta.coreX, 442, "折返盾", player.meta.color, 0.75);
    audio.play("shield", { pan: player.id === 0 ? -0.65 : 0.65 });
  }

  cycleAmmo(player) {
    if (player.charging) return;
    player.ammoIndex = (player.ammoIndex + 1) % BIRD_TYPES.length;
    const type = BIRD_TYPES[player.ammoIndex];
    audio.play("ui", { pitch: 0.96 + player.ammoIndex * 0.1 });
    this.addText(player.meta.slingX, 476, `${type.name} · ${type.cost || "免費"}`, type.color, 0.65);
  }

  softNotice(player, message) {
    if (player.noticeCooldown > 0) return;
    player.noticeCooldown = 0.45;
    this.addText(player.meta.slingX, 490, message, "#e5edf8", 0.7);
    audio.play("ui", { pitch: 0.62, volume: 0.5 });
  }

  creditShot(projectile) {
    const shooter = this.players[projectile.sourcePlayer];
    if (!shooter || shooter.landedShotIds.has(projectile.shotId)) return;
    shooter.landedShotIds.add(projectile.shotId);
    shooter.stats.hitShots += 1;
  }

  frame(timestamp) {
    const frameDelta = Math.min((timestamp - this.previousTimestamp) / 1000, CONFIG.maxFrameStep);
    this.previousTimestamp = timestamp;
    if (!this.testMode && (this.state === "playing" || this.state === "countdown")) {
      this.accumulator += frameDelta;
      while (this.accumulator >= CONFIG.fixedStep) {
        this.update(CONFIG.fixedStep);
        this.accumulator -= CONFIG.fixedStep;
      }
    } else if (this.state === "menu") {
      this.updateAmbient(frameDelta);
    }
    this.render(timestamp / 1000);
    requestAnimationFrame((next) => this.frame(next));
  }

  updateAmbient(dt) {
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed * dt;
      if (cloud.x < -cloud.width - 20) cloud.x = CONFIG.width + cloud.width;
      if (cloud.x > CONFIG.width + cloud.width) cloud.x = -cloud.width;
    }
  }

  update(dt) {
    this.updateEffects(dt);
    if (this.state === "countdown") {
      this.countdown -= dt;
      const beat = Math.ceil(this.countdown);
      if (beat > 0 && beat < this.lastCountdownBeat) {
        this.lastCountdownBeat = beat;
        audio.play("countdown", { pitch: 0.9 + (3 - beat) * 0.08 });
      }
      if (this.countdown <= 0) {
        this.state = "playing";
        this.lastCountdownBeat = 0;
        this.showBanner(this.resumeCountdown ? "再戰！" : "開戰！", "同時攻防 · 守住星巢", "#ffd45c", 1.25);
        audio.play("start");
        this.resumeCountdown = false;
      }
      return;
    }
    if (this.state !== "playing") return;

    this.elapsed += dt;
    this.remaining = Math.max(0, CONFIG.matchSeconds - this.elapsed);
    const overdrive = this.remaining <= CONFIG.overdriveSeconds;
    if (overdrive && !this.overdriveAnnounced) {
      this.overdriveAnnounced = true;
      this.showBanner("超載時刻", "能量回復 ×1.28 · 傷害 ×1.18", "#ffcf5b", 2.25);
      this.announce("進入最後三十秒超載時刻");
      audio.play("start", { pitch: 1.28 });
    }

    if (this.elapsed >= this.nextWindAt) {
      this.windTarget = this.rng.range(-CONFIG.baseWindLimit, CONFIG.baseWindLimit);
      this.nextWindAt += this.rng.range(9, 13);
    }
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 0.72);

    for (const player of this.players) this.updatePlayer(player, dt, overdrive);
    this.updateCrystals(dt);
    this.updateProjectiles(dt, overdrive);
    this.resolveProjectileClashes();
    this.cleanupProjectiles();

    const leftDead = this.players[0].coreHp <= 0;
    const rightDead = this.players[1].coreHp <= 0;
    if (leftDead || rightDead) {
      this.finish(leftDead && rightDead ? null : leftDead ? 1 : 0, "core");
    } else if (this.remaining <= 0) {
      const timed = decideTimedWinner(this.players, this.structures);
      this.finish(timed.winner, "time", timed.scores);
    }
  }

  updatePlayer(player, dt, overdrive) {
    const opponent = this.players[1 - player.id];
    const behind = opponent.coreHp - player.coreHp > CONFIG.catchupThreshold;
    const regen = (CONFIG.focusRegen + (behind ? CONFIG.catchupFocusBonus : 0)) * (overdrive ? 1.28 : 1);
    player.focus = clamp(player.focus + regen * dt, 0, CONFIG.focusMax);
    player.reload = Math.max(0, player.reload - dt);
    player.shieldCooldown = Math.max(0, player.shieldCooldown - dt);
    player.shieldTimer = Math.max(0, player.shieldTimer - dt);
    player.shieldAge = player.shieldTimer > 0 ? player.shieldAge + dt : 0;
    player.coreGuard = Math.max(0, player.coreGuard - dt);
    player.coreFlash = Math.max(0, player.coreFlash - dt * 4.5);
    player.forgePulse = Math.max(0, player.forgePulse - dt * 1.4);
    player.noticeCooldown = Math.max(0, player.noticeCooldown - dt);

    if (this.keys.has(player.meta.aimUp)) player.aim += CONFIG.aimSpeed * dt;
    if (this.keys.has(player.meta.aimDown)) player.aim -= CONFIG.aimSpeed * dt;
    player.aim = clamp(player.aim, CONFIG.aimMin, CONFIG.aimMax);
    if (player.charging) player.charge = clamp(player.charge + dt / CONFIG.chargeSeconds, 0, 1);
    this.hasActiveShot(player);
  }

  updateCrystals(dt) {
    for (const crystal of this.crystals) {
      crystal.phase += dt * 1.7;
      if (!crystal.active) {
        crystal.respawn -= dt;
        if (crystal.respawn <= 0) {
          crystal.active = true;
          this.spawnRing(crystal.x, crystal.y, "#ffd45c", 30);
        }
      }
    }
  }

  updateProjectiles(dt, overdrive) {
    for (const projectile of this.projectiles) {
      if (projectile.remove) continue;
      projectile.age += dt;
      projectile.trailTimer -= dt;
      if (projectile.trailTimer <= 0) {
        projectile.trailTimer = this.settings.reducedMotion ? 0.09 : 0.035;
        projectile.trail.push({ x: projectile.x, y: projectile.y, alpha: 1 });
        if (projectile.trail.length > (this.settings.reducedMotion ? 4 : 12)) projectile.trail.shift();
      }
      projectile.trail.forEach((point) => { point.alpha -= dt * 1.55; });
      projectile.trail = projectile.trail.filter((point) => point.alpha > 0);

      projectile.vx += this.wind * dt;
      projectile.vy += CONFIG.gravity * dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.rotation += projectile.spin * dt;

      this.resolveShieldCollision(projectile);
      if (projectile.remove) continue;
      this.resolveCrystalCollision(projectile);
      this.resolveStructureCollision(projectile, overdrive);
      if (projectile.remove) continue;
      this.resolveCoreCollision(projectile, overdrive);
      if (projectile.remove) continue;
      this.resolveGroundCollision(projectile);

      if (
        projectile.age > CONFIG.projectileLifetime
        || projectile.x < -90
        || projectile.x > CONFIG.width + 90
        || projectile.y > CONFIG.height + 100
      ) projectile.remove = true;
    }
  }

  resolveShieldCollision(projectile) {
    for (const defender of this.players) {
      if (defender.shieldTimer <= 0 || projectile.owner === defender.id || projectile.shieldHits.has(defender.id)) continue;
      const dx = projectile.x - defender.meta.coreX;
      const dy = projectile.y - 556;
      const distance = Math.hypot(dx, dy);
      const contact = CONFIG.shieldRadius + projectile.radius;
      if (distance > contact || distance < 1) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      if (projectile.vx * nx + projectile.vy * ny >= 0) continue;
      const perfect = defender.shieldAge <= CONFIG.perfectParryWindow;
      const reflected = reflectVelocity(projectile.vx, projectile.vy, nx, ny, perfect ? 0.97 : 0.72);
      const boost = perfect ? 1.08 : 0.86;
      projectile.vx = reflected.vx * boost;
      projectile.vy = reflected.vy * boost;
      projectile.x = defender.meta.coreX + nx * (contact + 2);
      projectile.y = 556 + ny * (contact + 2);
      projectile.owner = defender.id;
      projectile.reflected = true;
      projectile.color = defender.meta.color;
      projectile.shieldHits.add(defender.id);
      defender.stats.blocks += 1;
      if (perfect) defender.focus = clamp(defender.focus + 11, 0, CONFIG.focusMax);
      this.spawnBurst(projectile.x, projectile.y, defender.meta.color, perfect ? 22 : 14, perfect ? 260 : 185);
      this.addText(projectile.x, projectile.y - 28, perfect ? "完美折返 +11" : "折返", defender.meta.color, 0.8);
      this.shake = Math.max(this.shake, perfect ? 7 : 3);
      audio.play(perfect ? "parry" : "shield", { pan: defender.id === 0 ? -0.65 : 0.65 });
      this.announce(`${defender.meta.name}${perfect ? "完美" : "成功"}折返攻擊`);
    }
  }

  resolveCrystalCollision(projectile) {
    for (const crystal of this.crystals) {
      if (!crystal.active) continue;
      if (Math.hypot(projectile.x - crystal.x, projectile.y - crystal.y) > projectile.radius + crystal.radius) continue;
      crystal.active = false;
      crystal.respawn = this.rng.range(6.5, 9.5);
      const owner = this.players[projectile.owner];
      owner.focus = clamp(owner.focus + 18, 0, CONFIG.focusMax);
      owner.stats.crystals += 1;
      projectile.vx *= 1.035;
      projectile.vy *= 1.035;
      this.spawnBurst(crystal.x, crystal.y, "#ffd45c", 18, 180);
      this.addText(crystal.x, crystal.y - 26, "+18 能量", "#ffd45c", 0.85);
      audio.play("crystal", { pan: (crystal.x / CONFIG.width) * 2 - 1 });
    }
  }

  resolveStructureCollision(projectile, overdrive) {
    for (const block of this.structures) {
      if (!block.alive || block.owner === projectile.owner || projectile.hitBlocks.has(block.id)) continue;
      const collision = circleAabbCollision(projectile, block);
      if (!collision) continue;
      projectile.hitBlocks.add(block.id);
      const material = MATERIALS[block.material];
      const speed = Math.hypot(projectile.vx, projectile.vy);
      const damage = impactDamage(speed, projectile.mass, material.resistance, projectile.damageMultiplier, overdrive);
      if (damage < 0.5) {
        projectile.x += collision.nx * (collision.depth + 1.5);
        projectile.y += collision.ny * (collision.depth + 1.5);
        const reflected = reflectVelocity(projectile.vx, projectile.vy, collision.nx, collision.ny, material.restitution);
        projectile.vx = reflected.vx * 0.72;
        projectile.vy = reflected.vy * 0.72;
        if (Math.hypot(projectile.vx, projectile.vy) < 105) projectile.remove = true;
        break;
      }
      this.creditShot(projectile);
      block.hp = Math.max(0, block.hp - damage);
      block.flash = 1;
      const attacker = this.players[projectile.owner];
      attacker.stats.impacts += 1;
      attacker.stats.damage += damage;
      attacker.focus = clamp(attacker.focus + Math.min(5, damage * 0.055), 0, CONFIG.focusMax);
      this.spawnImpact(collision.pointX, collision.pointY, material.fill, Math.ceil(5 + damage / 10));
      this.addText(collision.pointX, collision.pointY - 13, `−${Math.round(damage)}`, material.edge, 0.58);
      audio.play("impact", { pan: (block.x / CONFIG.width) * 2 - 1, intensity: clamp(damage / 70, 0.2, 1) });

      if (block.hp <= 0) {
        this.breakBlock(block, projectile.owner, projectile);
        projectile.vx *= 0.79;
        projectile.vy *= 0.79;
      } else {
        projectile.x += collision.nx * (collision.depth + 1.5);
        projectile.y += collision.ny * (collision.depth + 1.5);
        const reflected = reflectVelocity(projectile.vx, projectile.vy, collision.nx, collision.ny, material.restitution);
        projectile.vx = reflected.vx * 0.88;
        projectile.vy = reflected.vy * 0.88;
      }
      projectile.integrity -= speed > 430 ? 1 : 0;
      this.shake = Math.max(this.shake, clamp(damage / 8, 1.5, 8));

      if (projectile.typeId === "bomb" && !projectile.remove) {
        this.explodeProjectile(projectile, 0.92);
      } else if (projectile.integrity <= 0 || Math.hypot(projectile.vx, projectile.vy) < 105) {
        projectile.remove = true;
      }
      break;
    }
  }

  breakBlock(block, attackerId, sourceProjectile = null) {
    if (!block.alive) return;
    block.alive = false;
    block.hp = 0;
    const defender = this.players[block.owner];
    const attacker = this.players[attackerId];
    defender.scrap = clamp(defender.scrap + MATERIALS[block.material].scrap, 0, CONFIG.scrapMax + 50);
    defender.stats.structuresLost += 1;
    attacker.stats.structuresBroken += 1;
    attacker.focus = clamp(attacker.focus + 4, 0, CONFIG.focusMax);
    const shockByMaterial = { glass: 16, wood: 21, stone: 26 };
    const usedShock = sourceProjectile?.collapseDamage ?? 0;
    const shock = Math.min(shockByMaterial[block.material], Math.max(0, 30 - usedShock));
    if (sourceProjectile) sourceProjectile.collapseDamage = usedShock + shock;
    if (shock > 0) {
      this.damageCore(defender, shock, attackerId);
      this.addText(defender.meta.coreX, 468, `結構震盪 −${Math.round(shock)}`, "#ffcf7d", 0.82);
    }
    this.spawnBlockDebris(block);
    this.addText(block.x, block.y - block.h / 2 - 18, `殘骸 +${MATERIALS[block.material].scrap}`, defender.meta.color, 0.92);
    this.checkForge(defender);
  }

  checkForge(player) {
    if (player.scrap < CONFIG.scrapMax || player.coreHp <= 0) return;
    player.scrap -= CONFIG.scrapMax;
    player.stats.forges += 1;
    player.forgePulse = 1;
    const before = player.coreHp;
    player.coreHp = clamp(player.coreHp + CONFIG.forgeHeal, 0, CONFIG.coreHp);
    const broken = this.structures
      .filter((block) => block.owner === player.id && !block.alive)
      .sort((a, b) => Math.abs(a.x - player.meta.coreX) - Math.abs(b.x - player.meta.coreX));
    for (const block of broken.slice(0, 2)) {
      block.alive = true;
      block.hp = block.maxHp * 0.48;
      block.rebuild = 1;
      block.hitAt.clear();
    }
    if (broken.length === 0 && before === CONFIG.coreHp) player.focus = clamp(player.focus + 28, 0, CONFIG.focusMax);
    this.spawnRing(player.meta.coreX, 556, "#70ffc4", 122);
    this.addText(player.meta.coreX, 426, `殘骸鍛造 · 修復 ${Math.round(player.coreHp - before)}`, "#70ffc4", 1.2);
    this.showBanner(`${player.meta.shortName}啟動殘骸鍛造`, "核心修復並重建外牆", player.meta.color, 1.45);
    audio.play("forge", { pan: player.id === 0 ? -0.65 : 0.65 });
  }

  resolveCoreCollision(projectile, overdrive) {
    for (const defender of this.players) {
      if (projectile.owner === defender.id || projectile.hitCores.has(defender.id)) continue;
      const dx = projectile.x - defender.meta.coreX;
      const dy = projectile.y - 556;
      if (Math.hypot(dx, dy) > CONFIG.coreRadius + projectile.radius) continue;
      projectile.hitCores.add(defender.id);
      this.creditShot(projectile);
      const speed = Math.hypot(projectile.vx, projectile.vy);
      const typeCap = projectile.isShard ? 23 : projectile.typeId === "bomb" ? 34 : projectile.typeId === "split" ? 48 : 61;
      const damage = Math.min(typeCap, impactDamage(speed, projectile.mass, 0.9, projectile.damageMultiplier, overdrive));
      if (projectile.typeId === "bomb") this.explodeProjectile(projectile, 0.86);
      else projectile.remove = true;
      this.damageCore(defender, damage, projectile.owner);
      break;
    }
  }

  damageCore(defender, rawDamage, attackerId) {
    if (rawDamage <= 0 || defender.coreHp <= 0) return;
    if (defender.coreGuard > 0) {
      this.addText(defender.meta.coreX, 512, "緊急殼吸收", "#ffffff", 0.65);
      return;
    }
    const damage = Math.min(76, rawDamage);
    defender.coreHp = clamp(defender.coreHp - damage, 0, CONFIG.coreHp);
    defender.coreFlash = 1;
    const attacker = this.players[attackerId];
    attacker.stats.coreDamage += damage;
    attacker.stats.damage += damage;
    attacker.focus = clamp(attacker.focus + Math.min(7, damage * 0.09), 0, CONFIG.focusMax);
    this.addText(defender.meta.coreX, 494, `核心 −${Math.round(damage)}`, "#ffffff", 0.95);
    this.spawnBurst(defender.meta.coreX, 556, defender.meta.color, 20, 245);
    this.shake = Math.max(this.shake, clamp(damage / 5, 4, 12));
    audio.play("impact", { pan: defender.id === 0 ? -0.75 : 0.75, intensity: 1 });

    if (!defender.emergencyUsed && defender.coreHp > 0 && defender.coreHp <= CONFIG.coreHp * 0.22) {
      defender.emergencyUsed = true;
      defender.coreGuard = 1.25;
      this.addText(defender.meta.coreX, 450, "緊急殼 1.25s", "#fff4b0", 1.05);
      this.spawnRing(defender.meta.coreX, 556, "#fff4b0", 72);
      audio.play("shield", { pan: defender.id === 0 ? -0.7 : 0.7, pitch: 1.22 });
    }
  }

  explodeProjectile(projectile, strength = 1) {
    if (projectile.remove) return;
    projectile.remove = true;
    const radius = 112 * strength;
    const attackerId = projectile.owner;
    let connected = false;
    for (const block of this.structures) {
      if (!block.alive || block.owner === attackerId) continue;
      const distance = pointToRectDistance(projectile.x, projectile.y, block);
      if (distance >= radius) continue;
      connected = true;
      const falloff = 1 - distance / radius;
      const material = MATERIALS[block.material];
      const materialFactor = block.material === "stone" ? 1.18 : block.material === "glass" ? 0.75 : 1;
      const damage = 68 * falloff * strength * materialFactor / Math.pow(material.resistance, 0.22);
      block.hp = Math.max(0, block.hp - damage);
      block.flash = 1;
      this.players[attackerId].stats.damage += damage;
      if (block.hp <= 0) this.breakBlock(block, attackerId, projectile);
    }
    for (const defender of this.players) {
      if (defender.id === attackerId) continue;
      const distance = Math.hypot(projectile.x - defender.meta.coreX, projectile.y - 556);
      if (distance < radius + CONFIG.coreRadius) {
        connected = true;
        const falloff = 1 - clamp((distance - CONFIG.coreRadius) / radius, 0, 1);
        this.damageCore(defender, Math.min(45, 48 * falloff * strength), attackerId);
      }
    }
    if (connected) this.creditShot(projectile);
    for (const other of this.projectiles) {
      if (other === projectile || other.remove) continue;
      const dx = other.x - projectile.x;
      const dy = other.y - projectile.y;
      const distance = Math.max(10, Math.hypot(dx, dy));
      if (distance >= radius) continue;
      const impulse = 260 * (1 - distance / radius);
      other.vx += dx / distance * impulse;
      other.vy += dy / distance * impulse;
    }
    this.spawnExplosion(projectile.x, projectile.y, radius);
    this.addText(projectile.x, projectile.y - 42, "新星爆發", "#ffabc0", 0.92);
    this.shake = Math.max(this.shake, 13 * strength);
    audio.play("explode", { pan: (projectile.x / CONFIG.width) * 2 - 1, intensity: strength });
  }

  resolveGroundCollision(projectile) {
    if (projectile.y + projectile.radius < CONFIG.groundY) return;
    projectile.y = CONFIG.groundY - projectile.radius;
    if (projectile.vy > 0) projectile.vy *= -0.34;
    projectile.vx *= 0.7;
    projectile.spin *= 0.7;
    projectile.groundHits += 1;
    this.spawnImpact(projectile.x, CONFIG.groundY - 2, "#5d7190", 5);
    if (projectile.typeId === "bomb" && !projectile.abilityUsed) {
      this.explodeProjectile(projectile, 0.82);
    } else if (projectile.groundHits >= 2 || Math.hypot(projectile.vx, projectile.vy) < 125) {
      projectile.remove = true;
    }
  }

  resolveProjectileClashes() {
    for (let firstIndex = 0; firstIndex < this.projectiles.length; firstIndex += 1) {
      const first = this.projectiles[firstIndex];
      if (first.remove) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < this.projectiles.length; secondIndex += 1) {
        const second = this.projectiles[secondIndex];
        if (second.remove || first.owner === second.owner || first.clashHits.has(second.id)) continue;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const minimum = first.radius + second.radius;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > minimum * minimum || distanceSquared < 0.001) continue;
        const distance = Math.sqrt(distanceSquared);
        const nx = dx / distance;
        const ny = dy / distance;
        const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
        if (relative >= 0) continue;
        const impulse = -(1.38 * relative) / (1 / first.mass + 1 / second.mass);
        first.vx -= impulse * nx / first.mass;
        first.vy -= impulse * ny / first.mass;
        second.vx += impulse * nx / second.mass;
        second.vy += impulse * ny / second.mass;
        first.vx *= 0.78;
        first.vy *= 0.78;
        second.vx *= 0.78;
        second.vy *= 0.78;
        const overlap = minimum - distance;
        first.x -= nx * overlap * 0.5;
        first.y -= ny * overlap * 0.5;
        second.x += nx * overlap * 0.5;
        second.y += ny * overlap * 0.5;
        first.clashHits.add(second.id);
        second.clashHits.add(first.id);
        if (Math.abs(relative) > 260) {
          first.integrity -= 1;
          second.integrity -= 1;
        }
        this.spawnBurst((first.x + second.x) / 2, (first.y + second.y) / 2, "#ffffff", 13, 215);
        this.addText((first.x + second.x) / 2, (first.y + second.y) / 2 - 24, "空中攔截", "#ffffff", 0.7);
        audio.play("parry", { pan: (((first.x + second.x) / 2) / CONFIG.width) * 2 - 1, pitch: 1.25 });
        if (first.integrity <= 0) first.typeId === "bomb" ? this.explodeProjectile(first, 0.65) : first.remove = true;
        if (second.integrity <= 0) second.typeId === "bomb" ? this.explodeProjectile(second, 0.65) : second.remove = true;
      }
    }
  }

  cleanupProjectiles() {
    this.projectiles = this.projectiles.filter((projectile) => !projectile.remove).slice(-CONFIG.maxProjectiles);
    for (const player of this.players) this.hasActiveShot(player);
  }

  updateEffects(dt) {
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed * dt;
      if (cloud.x < -cloud.width - 20) cloud.x = CONFIG.width + cloud.width;
      if (cloud.x > CONFIG.width + cloud.width) cloud.x = -cloud.width;
    }
    for (const block of this.structures) {
      block.flash = Math.max(0, block.flash - dt * 5);
      block.rebuild = Math.max(0, block.rebuild - dt * 1.8);
    }
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += (particle.gravity ?? 310) * dt;
      particle.vx *= Math.pow(0.985, dt * 60);
      particle.rotation += particle.spin * dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0).slice(-CONFIG.maxParticles);
    for (const floater of this.floaters) {
      floater.life -= dt;
      floater.y -= 28 * dt;
    }
    this.floaters = this.floaters.filter((floater) => floater.life > 0).slice(-CONFIG.maxFloatingTexts);
    for (const banner of this.banners) banner.life -= dt;
    this.banners = this.banners.filter((banner) => banner.life > 0);
    this.shake = Math.max(0, this.shake - dt * 25);
  }

  spawnImpact(x, y, color, count = 8) {
    this.spawnBurst(x, y, color, count, 150, 430);
  }

  spawnBurst(x, y, color, count = 12, speed = 180, gravity = 260) {
    const limited = this.settings.reducedMotion ? Math.ceil(count * 0.32) : count;
    for (let index = 0; index < limited; index += 1) {
      const angle = this.visualRng.range(0, Math.PI * 2);
      const velocity = this.visualRng.range(speed * 0.25, speed);
      const life = this.visualRng.range(0.35, 0.78);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        gravity,
        life,
        maxLife: life,
        size: this.visualRng.range(2, 6),
        color,
        rotation: this.visualRng.range(0, Math.PI),
        spin: this.visualRng.range(-6, 6),
        shape: this.visualRng() > 0.72 ? "square" : "circle",
      });
    }
  }

  spawnBlockDebris(block) {
    const count = this.settings.reducedMotion ? 5 : Math.ceil((block.w * block.h) / 520);
    for (let index = 0; index < count; index += 1) {
      const life = this.visualRng.range(0.65, 1.25);
      this.particles.push({
        x: block.x + this.visualRng.range(-block.w / 2, block.w / 2),
        y: block.y + this.visualRng.range(-block.h / 2, block.h / 2),
        vx: this.visualRng.range(-150, 150),
        vy: this.visualRng.range(-230, -50),
        gravity: 470,
        life,
        maxLife: life,
        size: this.visualRng.range(5, 12),
        color: MATERIALS[block.material].fill,
        rotation: this.visualRng.range(0, Math.PI),
        spin: this.visualRng.range(-8, 8),
        shape: "square",
      });
    }
  }

  spawnExplosion(x, y, radius) {
    const count = this.settings.reducedMotion ? 18 : 52;
    const colors = ["#fff4b0", "#ffbe55", "#ff6f91", "#ae4b7d"];
    for (let index = 0; index < count; index += 1) {
      const angle = this.visualRng.range(0, Math.PI * 2);
      const speed = this.visualRng.range(80, radius * 3.15);
      const life = this.visualRng.range(0.45, 1.05);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: this.visualRng.range(70, 240),
        life,
        maxLife: life,
        size: this.visualRng.range(4, 13),
        color: this.visualRng.pick(colors),
        rotation: this.visualRng.range(0, Math.PI),
        spin: this.visualRng.range(-8, 8),
        shape: this.visualRng() > 0.5 ? "circle" : "square",
      });
    }
    this.particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      gravity: 0,
      life: 0.34,
      maxLife: 0.34,
      size: radius,
      color: "#fff3bc",
      rotation: 0,
      spin: 0,
      shape: "ring",
    });
  }

  spawnRing(x, y, color, radius) {
    this.particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      gravity: 0,
      life: 0.55,
      maxLife: 0.55,
      size: radius,
      color,
      rotation: 0,
      spin: 0,
      shape: "ring",
    });
  }

  addText(x, y, text, color = "#ffffff", life = 0.8) {
    this.floaters.push({ x, y, text, color, life, maxLife: life });
  }

  showBanner(text, subtext, color = "#ffffff", life = 1.5) {
    this.banners.push({ text, subtext, color, life, maxLife: life });
  }

  announce(message) {
    if (dom.live) dom.live.textContent = message;
    if (dom.status) dom.status.dataset.message = message;
  }

  finish(winner, reason, scores = null) {
    if (this.state === "finished") return;
    this.state = "finished";
    this.clearInputs();
    this.result = { winner, reason, scores };
    audio.stopMusic();
    audio.play("win", { winner });
    const isDraw = winner === null;
    const winnerMeta = isDraw ? null : PLAYER_META[winner];
    if (dom.resultEyebrow) dom.resultEyebrow.textContent = reason === "time" ? "時間終了 · 綜合判定" : "星巢核心已失守";
    if (dom.resultTitle) {
      dom.resultTitle.textContent = isDraw ? "勢均力敵！" : `${winnerMeta.shortName}獲勝`;
      dom.resultTitle.style.color = isDraw ? "#ffd45c" : winnerMeta.color;
    }
    if (dom.resultSummary) {
      dom.resultSummary.textContent = isDraw
        ? "兩座星巢同時守住了最後一線。再戰一局，讓下一發決定勝負。"
        : `${winnerMeta.name}在同步攻防中保住更多核心能量。`;
    }
    if (dom.resultStats) {
      dom.resultStats.innerHTML = this.players.map((player) => {
        const accuracy = player.stats.shots ? Math.round(player.stats.hitShots / player.stats.shots * 100) : 0;
        const score = scores?.[player.id] ?? scoreSide(player.coreHp, this.structures.filter((block) => block.owner === player.id));
        return `<section class="result-stat ${winner === player.id ? "is-winner" : ""}">
          <span class="result-player">${player.meta.name}</span>
          <strong>${Math.round(player.coreHp)}<small> / ${CONFIG.coreHp} 核心</small></strong>
          <span>命中 ${accuracy}% · 折返 ${player.stats.blocks} · 拆牆 ${player.stats.structuresBroken}</span>
          <span>戰果分數 ${score.toLocaleString("zh-TW")}</span>
        </section>`;
      }).join("");
    }
    setLayerVisible(dom.gameOver, true);
    this.announce(isDraw ? "本局平手" : `${winnerMeta.name}獲勝`);
  }

  render(time) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    ctx.save();
    if (!this.settings.reducedMotion && this.shake > 0) {
      ctx.translate(this.visualRng.range(-this.shake, this.shake), this.visualRng.range(-this.shake * 0.5, this.shake * 0.5));
    }
    this.drawBackground(ctx, time);
    this.drawArena(ctx, time);
    this.drawCrystals(ctx, time);
    this.drawStructures(ctx);
    this.drawCores(ctx, time);
    this.drawSlings(ctx, time);
    this.drawProjectiles(ctx, time);
    this.drawParticles(ctx);
    this.drawFloaters(ctx);
    this.drawHud(ctx, time);
    this.drawBanners(ctx);
    if (this.state === "countdown") this.drawCountdown(ctx);
    ctx.restore();
  }

  drawBackground(ctx, time) {
    const sky = ctx.createLinearGradient(0, 0, 0, CONFIG.height);
    sky.addColorStop(0, "#07111f");
    sky.addColorStop(0.52, "#10213a");
    sky.addColorStop(1, "#182942");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    const leftGlow = ctx.createRadialGradient(180, 400, 0, 180, 400, 410);
    leftGlow.addColorStop(0, "rgba(39,214,230,.13)");
    leftGlow.addColorStop(1, "rgba(39,214,230,0)");
    ctx.fillStyle = leftGlow;
    ctx.fillRect(0, 30, 620, 590);
    const rightGlow = ctx.createRadialGradient(1100, 400, 0, 1100, 400, 410);
    rightGlow.addColorStop(0, "rgba(255,122,104,.13)");
    rightGlow.addColorStop(1, "rgba(255,122,104,0)");
    ctx.fillStyle = rightGlow;
    ctx.fillRect(660, 30, 620, 590);

    for (const star of this.stars) {
      const shimmer = this.settings.reducedMotion ? 1 : 0.7 + Math.sin(time * 1.4 + star.phase) * 0.3;
      ctx.globalAlpha = star.alpha * shimmer;
      ctx.fillStyle = "#d9edff";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const cloud of this.clouds) {
      ctx.globalAlpha = cloud.alpha;
      ctx.fillStyle = "#a9c8e8";
      ctx.beginPath();
      ctx.ellipse(cloud.x, cloud.y, cloud.width * 0.5, 25, 0, 0, Math.PI * 2);
      ctx.ellipse(cloud.x - cloud.width * 0.2, cloud.y - 12, cloud.width * 0.24, 28, 0, 0, Math.PI * 2);
      ctx.ellipse(cloud.x + cloud.width * 0.2, cloud.y - 9, cloud.width * 0.3, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(167,213,255,.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= CONFIG.width; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 88); ctx.lineTo(x, CONFIG.groundY); ctx.stroke();
    }
    for (let y = 108; y <= CONFIG.groundY; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CONFIG.width, y); ctx.stroke();
    }

    const mid = ctx.createLinearGradient(0, 115, 0, CONFIG.groundY);
    mid.addColorStop(0, "rgba(255,212,92,0)");
    mid.addColorStop(0.5, "rgba(255,212,92,.2)");
    mid.addColorStop(1, "rgba(255,212,92,0)");
    ctx.strokeStyle = mid;
    ctx.setLineDash([5, 11]);
    ctx.beginPath();
    ctx.moveTo(CONFIG.width / 2, 115);
    ctx.lineTo(CONFIG.width / 2, CONFIG.groundY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawArena(ctx, time) {
    const ground = ctx.createLinearGradient(0, CONFIG.groundY - 22, 0, CONFIG.height);
    ground.addColorStop(0, "#2b405c");
    ground.addColorStop(0.08, "#1b2f49");
    ground.addColorStop(1, "#091421");
    ctx.fillStyle = ground;
    ctx.fillRect(0, CONFIG.groundY, CONFIG.width, CONFIG.height - CONFIG.groundY);
    ctx.fillStyle = "rgba(175,222,255,.16)";
    ctx.fillRect(0, CONFIG.groundY, CONFIG.width, 3);
    ctx.fillStyle = "rgba(39,214,230,.11)";
    ctx.fillRect(0, CONFIG.groundY + 3, CONFIG.width / 2, 5);
    ctx.fillStyle = "rgba(255,122,104,.11)";
    ctx.fillRect(CONFIG.width / 2, CONFIG.groundY + 3, CONFIG.width / 2, 5);

    for (let index = 0; index < 20; index += 1) {
      const x = index * 71 + 18;
      const height = 5 + ((index * 17) % 13);
      ctx.fillStyle = index < 9 ? "rgba(39,214,230,.10)" : index > 10 ? "rgba(255,122,104,.10)" : "rgba(255,212,92,.09)";
      roundedRect(ctx, x, CONFIG.groundY + 24, 42, height, 3);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(640, 596);
    const pulse = 1 + Math.sin(time * 2.2) * 0.04;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "rgba(255,212,92,.12)";
    ctx.beginPath();
    ctx.arc(0, 0, 41, Math.PI, 0);
    ctx.lineTo(33, 0);
    ctx.arc(0, 0, 33, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawCrystals(ctx, time) {
    for (const crystal of this.crystals) {
      if (!crystal.active) {
        const ratio = clamp(1 - crystal.respawn / 9.5, 0, 1);
        ctx.strokeStyle = `rgba(255,212,92,${0.12 + ratio * 0.18})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(crystal.x, crystal.y, crystal.radius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.stroke();
        continue;
      }
      const bob = this.settings.reducedMotion ? 0 : Math.sin(time * 2 + crystal.phase) * 5;
      ctx.save();
      ctx.translate(crystal.x, crystal.y + bob);
      ctx.rotate(time * 0.8 + crystal.phase);
      ctx.shadowColor = "#ffd45c";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#ffe783";
      ctx.beginPath();
      ctx.moveTo(0, -crystal.radius);
      ctx.lineTo(crystal.radius * 0.75, 0);
      ctx.lineTo(0, crystal.radius);
      ctx.lineTo(-crystal.radius * 0.75, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.beginPath();
      ctx.moveTo(0, -crystal.radius + 3);
      ctx.lineTo(3, -1);
      ctx.lineTo(-5, 1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawStructures(ctx) {
    for (const block of this.structures) {
      if (!block.alive) continue;
      const material = MATERIALS[block.material];
      const health = clamp(block.hp / block.maxHp, 0, 1);
      const rebuildScale = block.rebuild > 0 ? 1 - block.rebuild * 0.24 : 1;
      ctx.save();
      ctx.translate(block.x, block.y + (1 - rebuildScale) * block.h * 0.5);
      ctx.scale(rebuildScale, rebuildScale);
      ctx.globalAlpha = block.rebuild > 0 ? 0.68 + (1 - block.rebuild) * 0.32 : 1;
      ctx.shadowColor = "rgba(0,0,0,.42)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 7;
      const gradient = ctx.createLinearGradient(-block.w / 2, -block.h / 2, block.w / 2, block.h / 2);
      gradient.addColorStop(0, material.edge);
      gradient.addColorStop(0.22, material.fill);
      gradient.addColorStop(1, this.shadeColor(material.fill, -28));
      ctx.fillStyle = gradient;
      roundedRect(ctx, -block.w / 2, -block.h / 2, block.w, block.h, Math.min(7, block.w / 4));
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,.28)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.save();
      roundedRect(ctx, -block.w / 2, -block.h / 2, block.w, block.h, Math.min(7, block.w / 4));
      ctx.clip();
      if (block.material === "wood") {
        ctx.strokeStyle = "rgba(91,49,37,.28)";
        ctx.lineWidth = 2;
        for (let y = -block.h / 2 + 12; y < block.h / 2; y += 18) {
          ctx.beginPath(); ctx.moveTo(-block.w / 2, y); ctx.bezierCurveTo(-block.w / 6, y - 3, block.w / 6, y + 4, block.w / 2, y); ctx.stroke();
        }
      } else if (block.material === "glass") {
        ctx.fillStyle = "rgba(255,255,255,.28)";
        ctx.beginPath();
        ctx.moveTo(-block.w / 2, -block.h / 2);
        ctx.lineTo(block.w * 0.25, -block.h / 2);
        ctx.lineTo(-block.w * 0.18, block.h / 2);
        ctx.lineTo(-block.w / 2, block.h / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(28,42,63,.34)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-block.w / 2, 0); ctx.lineTo(block.w / 2, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -block.h / 2); ctx.lineTo(0, 0); ctx.stroke();
      }
      if (health < 0.72) {
        ctx.strokeStyle = `rgba(18,26,38,${0.35 + (1 - health) * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -block.h * 0.18);
        ctx.lineTo(-block.w * 0.18, block.h * 0.02);
        ctx.lineTo(block.w * 0.11, block.h * 0.16);
        ctx.lineTo(-block.w * 0.04, block.h * 0.34);
        ctx.stroke();
      }
      if (block.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${block.flash * 0.62})`;
        ctx.fillRect(-block.w / 2, -block.h / 2, block.w, block.h);
      }
      ctx.restore();

      ctx.fillStyle = "rgba(7,14,24,.58)";
      roundedRect(ctx, -block.w / 2, block.h / 2 + 5, block.w, 4, 2);
      ctx.fill();
      ctx.fillStyle = health > 0.45 ? "#70ffc4" : "#ffcc5c";
      roundedRect(ctx, -block.w / 2, block.h / 2 + 5, block.w * health, 4, 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawCores(ctx, time) {
    for (const player of this.players) {
      const x = player.meta.coreX;
      const y = 556;
      const pulse = 1 + Math.sin(time * 3.2 + player.id * Math.PI) * 0.025 + player.forgePulse * 0.08;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = player.meta.color;
      ctx.shadowBlur = 24 + player.forgePulse * 28;
      const orb = ctx.createRadialGradient(-11, -14, 2, 0, 0, CONFIG.coreRadius);
      orb.addColorStop(0, "#ffffff");
      orb.addColorStop(0.18, player.meta.color);
      orb.addColorStop(0.72, player.meta.dark);
      orb.addColorStop(1, "#101b2d");
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(0, 0, CONFIG.coreRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,.58)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      if (player.meta.pattern === "circle") {
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.rotate(Math.PI / 4);
        ctx.strokeRect(-11, -11, 22, 22);
      }
      ctx.globalAlpha = 1;
      if (player.coreFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${player.coreFlash * 0.7})`;
        ctx.beginPath(); ctx.arc(0, 0, CONFIG.coreRadius, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "#78624e";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      for (let index = 0; index < 4; index += 1) {
        ctx.beginPath();
        ctx.arc(x, y + 26 + index * 2, 42 + index * 3, Math.PI * 0.16, Math.PI * 0.84);
        ctx.stroke();
      }
      ctx.restore();

      if (player.coreGuard > 0) {
        ctx.strokeStyle = `rgba(255,244,176,${0.45 + Math.sin(time * 12) * 0.2})`;
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(x, y, 52, 0, Math.PI * 2); ctx.stroke();
      }
      if (player.shieldTimer > 0) this.drawShield(ctx, player, time);
    }
  }

  drawShield(ctx, player, time) {
    const x = player.meta.coreX;
    const y = 556;
    const progress = player.shieldTimer / CONFIG.shieldDuration;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((player.id ? -1 : 1) * time * 0.7);
    ctx.shadowColor = player.meta.color;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = player.meta.color;
    ctx.globalAlpha = 0.55 + progress * 0.32;
    ctx.lineWidth = 6;
    ctx.setLineDash([46, 11]);
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.shieldRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.28;
    ctx.beginPath(); ctx.arc(0, 0, CONFIG.shieldRadius - 7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  drawSlings(ctx, time) {
    for (const player of this.players) {
      const x = player.meta.slingX;
      const y = 565;
      const direction = player.meta.direction;
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = player.meta.color;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = player.meta.dark;
      ctx.lineWidth = 11;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-direction * 13, 32); ctx.lineTo(-direction * 9, -21); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(direction * 12, 32); ctx.lineTo(direction * 14, -12); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = player.meta.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-direction * 13, 32); ctx.lineTo(-direction * 9, -21); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(direction * 12, 32); ctx.lineTo(direction * 14, -12); ctx.stroke();
      ctx.fillStyle = "#152439";
      roundedRect(ctx, -28, 30, 56, 13, 6);
      ctx.fill();
      ctx.restore();

      const type = BIRD_TYPES[player.ammoIndex];
      const directionX = direction * Math.cos(player.aim);
      const directionY = -Math.sin(player.aim);
      const chargeVisual = player.charging ? player.charge : 0;
      const ballX = x - directionX * (player.charging ? 18 + chargeVisual * 37 : -22);
      const ballY = 542 - directionY * (player.charging ? 18 + chargeVisual * 37 : -22);

      if (player.charging) {
        ctx.strokeStyle = "rgba(15,19,29,.9)";
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x - direction * 9, y - 21); ctx.lineTo(ballX, ballY); ctx.lineTo(x + direction * 14, y - 12); ctx.stroke();
        const speed = lerp(CONFIG.launchSpeedMin, CONFIG.launchSpeedMax, easeOutCubic(0.14 + chargeVisual * 0.86)) * type.speed;
        const points = trajectoryPoints({
          x: x + direction * 24,
          y: 542,
          vx: directionX * speed,
          vy: directionY * speed,
          wind: this.wind,
        });
        points.forEach((point, index) => {
          if (point.y > CONFIG.groundY) return;
          ctx.globalAlpha = point.alpha * 0.74;
          ctx.fillStyle = player.meta.color;
          ctx.save();
          ctx.translate(point.x, point.y);
          if (player.meta.pattern === "diamond") ctx.rotate(Math.PI / 4);
          ctx.fillRect(-2.5 - index * 0.02, -2.5 - index * 0.02, 5 + index * 0.04, 5 + index * 0.04);
          ctx.restore();
        });
        ctx.globalAlpha = 1;
      }
      if (!this.hasActiveShot(player)) this.drawOrb(ctx, ballX, ballY, type.radius, type.color, type.glyph, direction, time, false);

      const meterX = x - 34;
      const meterY = 638;
      ctx.fillStyle = "rgba(5,12,22,.62)";
      roundedRect(ctx, meterX, meterY, 68, 6, 3); ctx.fill();
      ctx.fillStyle = type.color;
      roundedRect(ctx, meterX, meterY, 68 * (player.charging ? Math.max(0.06, player.charge) : clamp(1 - player.reload / type.reload, 0, 1)), 6, 3); ctx.fill();
    }
  }

  drawProjectiles(ctx, time) {
    for (const projectile of this.projectiles) {
      for (let index = 0; index < projectile.trail.length; index += 1) {
        const point = projectile.trail[index];
        ctx.globalAlpha = clamp(point.alpha, 0, 1) * (index + 1) / projectile.trail.length * 0.42;
        ctx.fillStyle = projectile.color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, projectile.radius * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.drawOrb(
        ctx,
        projectile.x,
        projectile.y,
        projectile.radius,
        projectile.color,
        projectile.isShard ? "•" : projectile.glyph,
        Math.sign(projectile.vx) || 1,
        time,
        projectile.reflected,
        projectile.rotation,
      );
    }
  }

  drawOrb(ctx, x, y, radius, color, glyph, direction, time, reflected = false, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.shadowColor = color;
    ctx.shadowBlur = reflected ? 22 : 12;
    const gradient = ctx.createRadialGradient(-radius * 0.35, -radius * 0.45, 1, 0, 0, radius);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.18, color);
    gradient.addColorStop(1, this.shadeColor(color, -48));
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = reflected ? "#ffffff" : "rgba(255,255,255,.45)";
    ctx.lineWidth = reflected ? 2.5 : 1.2;
    ctx.stroke();
    ctx.rotate(-rotation);
    ctx.fillStyle = "rgba(7,13,23,.78)";
    ctx.font = `800 ${Math.max(11, radius * 1.05)}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, direction * 0.5, 0.5);
    if (!this.settings.reducedMotion && reflected) {
      ctx.globalAlpha = 0.5 + Math.sin(time * 14) * 0.25;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(0, 0, radius + 5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.globalAlpha = alpha;
      if (particle.shape === "ring") {
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 4 * alpha;
        ctx.beginPath();
        ctx.arc(0, 0, particle.size * (1.3 - alpha * 0.3), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = particle.color;
        if (particle.shape === "square") ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
        else { ctx.beginPath(); ctx.arc(0, 0, particle.size / 2, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawFloaters(ctx) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 15px ui-rounded, system-ui, sans-serif";
    for (const floater of this.floaters) {
      const alpha = clamp(floater.life / floater.maxLife, 0, 1);
      ctx.globalAlpha = Math.min(1, alpha * 1.7);
      ctx.strokeStyle = "rgba(6,12,21,.82)";
      ctx.lineWidth = 4;
      ctx.strokeText(floater.text, floater.x, floater.y);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.globalAlpha = 1;
  }

  drawHud(ctx, time) {
    this.drawPlayerHud(ctx, this.players[0], 24, false, time);
    this.drawPlayerHud(ctx, this.players[1], CONFIG.width - 24, true, time);

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(5,12,23,.82)";
    roundedRect(ctx, 548, 18, 184, 78, 20);
    ctx.fill();
    ctx.strokeStyle = this.remaining <= CONFIG.overdriveSeconds ? "rgba(255,212,92,.65)" : "rgba(255,255,255,.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = this.remaining <= CONFIG.overdriveSeconds ? "#ffd45c" : "#f5f8ff";
    ctx.font = "900 34px ui-rounded, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTime(this.remaining), 640, 49);
    ctx.font = "700 10px ui-rounded, system-ui, sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillStyle = "#9fb1c7";
    ctx.fillText(this.remaining <= CONFIG.overdriveSeconds ? "OVERDRIVE" : "NESTFALL ARENA", 640, 79);

    const arrow = this.wind >= 0 ? "→" : "←";
    ctx.fillStyle = "rgba(7,15,26,.72)";
    roundedRect(ctx, 586, 104, 108, 26, 13); ctx.fill();
    ctx.fillStyle = "#bdd0e5";
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.fillText(`氣流 ${arrow} ${Math.round(Math.abs(this.wind))}`, 640, 117);
    ctx.restore();
  }

  drawPlayerHud(ctx, player, anchorX, rightAligned, time) {
    const width = 402;
    const x = rightAligned ? anchorX - width : anchorX;
    const direction = rightAligned ? -1 : 1;
    ctx.save();
    ctx.fillStyle = "rgba(5,12,23,.78)";
    roundedRect(ctx, x, 18, width, 94, 19);
    ctx.fill();
    ctx.strokeStyle = `${player.meta.color}55`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = rightAligned ? "right" : "left";
    const textX = rightAligned ? x + width - 17 : x + 17;
    ctx.fillStyle = player.meta.color;
    ctx.font = "900 16px ui-rounded, system-ui, sans-serif";
    ctx.fillText(player.meta.name, textX, 42);
    ctx.fillStyle = "#f5f8ff";
    ctx.font = "900 21px ui-rounded, system-ui, sans-serif";
    ctx.fillText(`${Math.ceil(player.coreHp)} HP`, textX, 67);

    const barX = rightAligned ? x + 14 : x + 116;
    const barWidth = 272;
    this.drawBar(ctx, barX, 31, barWidth, 12, player.coreHp / CONFIG.coreHp, player.meta.color, rightAligned);
    this.drawBar(ctx, barX, 54, barWidth, 8, player.focus / CONFIG.focusMax, "#ffd45c", rightAligned);
    this.drawBar(ctx, barX, 72, barWidth, 7, player.scrap / CONFIG.scrapMax, "#70ffc4", rightAligned);
    ctx.font = "700 10px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#9fb1c7";
    const labelX = rightAligned ? barX + barWidth : barX;
    ctx.textAlign = rightAligned ? "right" : "left";
    ctx.fillText(`能量 ${Math.floor(player.focus)} · 殘骸 ${Math.floor(player.scrap)}%`, labelX, 97);

    const opponent = this.players[1 - player.id];
    if (opponent.coreHp - player.coreHp > CONFIG.catchupThreshold) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#70ffc4";
      ctx.font = "800 10px ui-rounded, system-ui, sans-serif";
      ctx.fillText("逆風充能 +2.2/s", x + width / 2, 108);
    }

    const type = BIRD_TYPES[player.ammoIndex];
    const chipX = rightAligned ? x - 5 : x + width + 5;
    const chipWidth = 112;
    const chipLeft = rightAligned ? chipX - chipWidth : chipX;
    ctx.fillStyle = "rgba(5,12,23,.82)";
    roundedRect(ctx, chipLeft, 24, chipWidth, 78, 17); ctx.fill();
    ctx.strokeStyle = `${type.color}88`; ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = type.color;
    ctx.font = "900 18px ui-rounded, system-ui, sans-serif";
    ctx.fillText(type.glyph, chipLeft + 23, 53);
    ctx.fillStyle = "#f5f8ff";
    ctx.font = "800 13px ui-rounded, system-ui, sans-serif";
    ctx.fillText(type.name, chipLeft + 67, 51);
    ctx.fillStyle = player.focus >= type.cost ? "#ffd45c" : "#ff8ca2";
    ctx.font = "700 11px ui-rounded, system-ui, sans-serif";
    ctx.fillText(type.cost ? `${type.cost} EN` : "免費", chipLeft + 67, 72);
    ctx.fillStyle = "#8fa3ba";
    ctx.font = "600 9px ui-rounded, system-ui, sans-serif";
    ctx.fillText("再按發射啟動技能", chipLeft + chipWidth / 2, 91);
    ctx.restore();
  }

  drawBar(ctx, x, y, width, height, ratio, color, reverse = false) {
    ctx.fillStyle = "rgba(255,255,255,.09)";
    roundedRect(ctx, x, y, width, height, height / 2); ctx.fill();
    const fill = Math.max(0, width * clamp(ratio, 0, 1));
    if (fill <= 0) return;
    ctx.fillStyle = color;
    const fillX = reverse ? x + width - fill : x;
    roundedRect(ctx, fillX, y, fill, height, height / 2); ctx.fill();
  }

  drawBanners(ctx) {
    const banner = this.banners[this.banners.length - 1];
    if (!banner) return;
    const progress = banner.life / banner.maxLife;
    const alpha = Math.min(1, progress * 3, (1 - progress) * 5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(5,11,20,.78)";
    roundedRect(ctx, 454, 154, 372, 72, 20); ctx.fill();
    ctx.strokeStyle = `${banner.color}88`; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = banner.color;
    ctx.font = "900 25px ui-rounded, system-ui, sans-serif";
    ctx.fillText(banner.text, 640, 184);
    ctx.fillStyle = "#d5e1ef";
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.fillText(banner.subtext, 640, 207);
    ctx.restore();
  }

  drawCountdown(ctx) {
    const numeral = Math.max(1, Math.ceil(this.countdown));
    const fraction = this.countdown - Math.floor(this.countdown);
    const scale = 0.85 + fraction * 0.2;
    ctx.save();
    ctx.translate(640, 333);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,212,92,.7)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = "#ffd45c";
    ctx.font = "1000 104px ui-rounded, system-ui, sans-serif";
    ctx.fillText(String(numeral), 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#f4f8ff";
    ctx.font = "800 14px ui-rounded, system-ui, sans-serif";
    ctx.fillText(this.resumeCountdown ? "準備繼續" : "雙方就位", 0, 74);
    ctx.restore();
  }

  shadeColor(hex, amount) {
    const normalized = hex.replace("#", "");
    if (normalized.length !== 6) return hex;
    const number = parseInt(normalized, 16);
    const r = clamp((number >> 16) + amount, 0, 255);
    const g = clamp(((number >> 8) & 0xff) + amount, 0, 255);
    const b = clamp((number & 0xff) + amount, 0, 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  snapshot() {
    return {
      state: this.state,
      elapsed: this.elapsed,
      remaining: this.remaining,
      projectiles: this.projectiles.length,
      particles: this.particles.length,
      winner: this.result?.winner ?? null,
      players: this.players.map((player) => ({
        coreHp: player.coreHp,
        focus: player.focus,
        scrap: player.scrap,
        shieldTimer: player.shieldTimer,
        reload: player.reload,
        charging: player.charging,
        shots: player.stats.shots,
        blocks: player.stats.blocks,
      })),
    };
  }
}

const game = new NestfallGame();

if (game.testMode) {
  window.__gameTest = {
    start: (seed) => game.startImmediately(seed),
    step: (frames = 1) => {
      const safeFrames = clamp(Math.floor(frames), 0, 120 * CONFIG.matchSeconds * 2);
      for (let index = 0; index < safeFrames; index += 1) game.update(CONFIG.fixedStep);
      game.render(performance.now() / 1000);
      return game.snapshot();
    },
    keyDown: (code) => game.onKeyDown({ code, repeat: false, preventDefault() {} }),
    keyUp: (code) => game.onKeyUp({ code, preventDefault() {} }),
    snapshot: () => game.snapshot(),
    forceDamage: (playerId, amount) => {
      const player = game.players[clamp(Number(playerId) | 0, 0, 1)];
      const damage = Math.max(0, Number(amount) || 0);
      player.coreHp = clamp(player.coreHp - damage, 0, CONFIG.coreHp);
      player.coreFlash = 1;
      if (game.players.some((candidate) => candidate.coreHp <= 0)) {
        const [left, right] = game.players;
        game.finish(left.coreHp <= 0 && right.coreHp <= 0 ? null : left.coreHp <= 0 ? 1 : 0, "core");
      }
      return game.snapshot();
    },
    restart: (seed) => game.startImmediately(seed),
  };
}

export { NestfallGame, game };
