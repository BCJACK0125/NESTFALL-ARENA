export const CONFIG = Object.freeze({
  width: 1280,
  height: 720,
  groundY: 620,
  matchSeconds: 150,
  overdriveSeconds: 30,
  fixedStep: 1 / 120,
  maxFrameStep: 0.05,
  gravity: 760,
  baseWindLimit: 42,
  coreHp: 200,
  coreRadius: 38,
  focusMax: 100,
  focusStart: 64,
  focusRegen: 7.4,
  catchupFocusBonus: 2.2,
  catchupThreshold: 50,
  scrapMax: 100,
  forgeHeal: 20,
  shieldCost: 36,
  shieldDuration: 0.88,
  shieldCooldown: 1.15,
  shieldRadius: 88,
  perfectParryWindow: 0.22,
  aimMin: 24 * Math.PI / 180,
  aimMax: 68 * Math.PI / 180,
  aimSpeed: 42 * Math.PI / 180,
  chargeSeconds: 1.15,
  launchSpeedMin: 430,
  launchSpeedMax: 760,
  projectileLifetime: 7.2,
  maxProjectiles: 18,
  maxParticles: 340,
  maxFloatingTexts: 24,
});

export const MATERIALS = Object.freeze({
  glass: Object.freeze({
    label: "晶冰",
    hp: 58,
    resistance: 0.78,
    restitution: 0.22,
    scrap: 27,
    fill: "#72e6ff",
    edge: "#d8f8ff",
  }),
  wood: Object.freeze({
    label: "星木",
    hp: 96,
    resistance: 1,
    restitution: 0.3,
    scrap: 22,
    fill: "#e3a952",
    edge: "#ffe2a3",
  }),
  stone: Object.freeze({
    label: "月岩",
    hp: 158,
    resistance: 1.42,
    restitution: 0.18,
    scrap: 18,
    fill: "#7487a5",
    edge: "#c5d1e3",
  }),
});

export const BIRD_TYPES = Object.freeze([
  Object.freeze({
    id: "dart",
    name: "疾風球",
    short: "疾風",
    glyph: "➤",
    color: "#ffd45c",
    cost: 0,
    radius: 14,
    mass: 0.92,
    speed: 1.04,
    damage: 1.02,
    reload: 1.08,
    ability: "再按發射：向前衝刺",
  }),
  Object.freeze({
    id: "split",
    name: "三相球",
    short: "三相",
    glyph: "⋮",
    color: "#6ce7ff",
    cost: 24,
    radius: 15,
    mass: 0.82,
    speed: 0.98,
    damage: 0.76,
    reload: 1.25,
    ability: "再按發射：分裂成三枚",
  }),
  Object.freeze({
    id: "bomb",
    name: "新星球",
    short: "新星",
    glyph: "✦",
    color: "#ff6f91",
    cost: 46,
    radius: 18,
    mass: 1.55,
    speed: 0.86,
    damage: 1.12,
    reload: 1.55,
    ability: "再按發射：範圍引爆",
  }),
]);

export const PLAYER_META = Object.freeze([
  Object.freeze({
    id: 0,
    name: "P1 青曜",
    shortName: "青曜",
    color: "#27d6e6",
    dark: "#0b829c",
    pattern: "circle",
    direction: 1,
    coreX: 127,
    slingX: 326,
    aimUp: "KeyW",
    aimDown: "KeyS",
    fire: "KeyF",
    shield: "KeyG",
    cycle: "KeyR",
  }),
  Object.freeze({
    id: 1,
    name: "P2 緋曜",
    shortName: "緋曜",
    color: "#ff7a68",
    dark: "#a93e59",
    pattern: "diamond",
    direction: -1,
    coreX: 1153,
    slingX: 954,
    aimUp: "ArrowUp",
    aimDown: "ArrowDown",
    fire: "KeyJ",
    shield: "KeyK",
    cycle: "KeyL",
  }),
]);

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

export function createRng(seed = 0x51f15e) {
  let state = (Number(seed) >>> 0) || 0x51f15e;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  random.range = (min, max) => min + (max - min) * random();
  random.pick = (items) => items[Math.floor(random() * items.length)];
  random.getState = () => state;
  return random;
}

export function rotateVector(x, y, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  };
}

export function circleAabbCollision(circle, rect) {
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const closestX = clamp(circle.x, rect.x - halfW, rect.x + halfW);
  const closestY = clamp(circle.y, rect.y - halfH, rect.y + halfH);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  const distanceSquared = dx * dx + dy * dy;

  if (distanceSquared > circle.radius * circle.radius) return null;

  if (distanceSquared > 1e-8) {
    const distance = Math.sqrt(distanceSquared);
    return {
      nx: dx / distance,
      ny: dy / distance,
      depth: circle.radius - distance,
      pointX: closestX,
      pointY: closestY,
    };
  }

  const left = Math.abs(circle.x - (rect.x - halfW));
  const right = Math.abs(rect.x + halfW - circle.x);
  const top = Math.abs(circle.y - (rect.y - halfH));
  const bottom = Math.abs(rect.y + halfH - circle.y);
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) return { nx: -1, ny: 0, depth: circle.radius + left, pointX: rect.x - halfW, pointY: circle.y };
  if (nearest === right) return { nx: 1, ny: 0, depth: circle.radius + right, pointX: rect.x + halfW, pointY: circle.y };
  if (nearest === top) return { nx: 0, ny: -1, depth: circle.radius + top, pointX: circle.x, pointY: rect.y - halfH };
  return { nx: 0, ny: 1, depth: circle.radius + bottom, pointX: circle.x, pointY: rect.y + halfH };
}

export function reflectVelocity(vx, vy, nx, ny, restitution = 0.3) {
  const approach = vx * nx + vy * ny;
  if (approach >= 0) return { vx, vy };
  const impulse = (1 + restitution) * approach;
  return {
    vx: vx - impulse * nx,
    vy: vy - impulse * ny,
  };
}

export function impactDamage(speed, mass, resistance = 1, multiplier = 1, overdrive = false) {
  const kineticBand = Math.max(0, speed - 155);
  const raw = kineticBand * 0.105 * mass * multiplier / Math.max(0.25, resistance);
  return clamp(raw * (overdrive ? 1.18 : 1), 0, 82);
}

export function trajectoryPoints({ x, y, vx, vy, gravity = CONFIG.gravity, wind = 0, count = 13, interval = 0.095 }) {
  const points = [];
  for (let index = 1; index <= count; index += 1) {
    const time = index * interval;
    points.push({
      x: x + vx * time + wind * time * time * 0.5,
      y: y + vy * time + gravity * time * time * 0.5,
      alpha: 1 - index / (count + 2),
    });
  }
  return points;
}

const LEFT_BLUEPRINT = Object.freeze([
  Object.freeze({ key: "rear-pillar", x: 69, y: 568, w: 24, h: 104, material: "stone" }),
  Object.freeze({ key: "inner-glass-a", x: 99, y: 562, w: 22, h: 74, material: "glass" }),
  Object.freeze({ key: "inner-glass-b", x: 158, y: 562, w: 22, h: 74, material: "glass" }),
  Object.freeze({ key: "nest-roof", x: 128, y: 512, w: 142, h: 22, material: "wood" }),
  Object.freeze({ key: "mid-pillar", x: 198, y: 558, w: 25, h: 124, material: "wood" }),
  Object.freeze({ key: "front-window", x: 225, y: 555, w: 24, h: 88, material: "glass" }),
  Object.freeze({ key: "front-pillar", x: 253, y: 548, w: 27, h: 144, material: "stone" }),
  Object.freeze({ key: "front-cap", x: 226, y: 466, w: 82, h: 22, material: "wood" }),
  Object.freeze({ key: "crown", x: 253, y: 438, w: 26, h: 34, material: "glass" }),
]);

export function createStructures(playerId) {
  const mirror = playerId === 1;
  return LEFT_BLUEPRINT.map((source, index) => {
    const material = MATERIALS[source.material];
    return {
      id: `p${playerId}-b${index}`,
      blueprintIndex: index,
      owner: playerId,
      x: mirror ? CONFIG.width - source.x : source.x,
      y: source.y,
      w: source.w,
      h: source.h,
      material: source.material,
      hp: material.hp,
      maxHp: material.hp,
      alive: true,
      flash: 0,
      rebuild: 0,
      hitAt: new Map(),
    };
  });
}

export function scoreSide(coreHp, structures) {
  const wallRatio = structures.reduce((sum, block) => sum + (block.alive ? block.hp / block.maxHp : 0), 0) / Math.max(1, structures.length);
  return Math.round(Math.max(0, coreHp) * 20 + wallRatio * 600);
}

export function decideTimedWinner(players, structures) {
  const scores = players.map((player) => scoreSide(player.coreHp, structures.filter((block) => block.owner === player.id)));
  if (Math.abs(scores[0] - scores[1]) < 25) return { winner: null, scores };
  return { winner: scores[0] > scores[1] ? 0 : 1, scores };
}

function chooseSimAction(side, opponent, rng, tuning) {
  const affordableBomb = side.focus >= BIRD_TYPES[2].cost;
  const affordableSplit = side.focus >= BIRD_TYPES[1].cost;
  const pressure = opponent.coreHp < side.coreHp ? 0.07 : 0;
  if (affordableBomb && rng() < tuning.bombRate + pressure) return BIRD_TYPES[2];
  if (affordableSplit && rng() < tuning.splitRate) return BIRD_TYPES[1];
  return BIRD_TYPES[0];
}

/**
 * Fast, intentionally abstract mirror simulation. It exercises the same economy,
 * damage caps, shield cost, salvage threshold, and round clock as the live game.
 * It is used by the shipped balance tests; it is not the rendering physics loop.
 */
export function simulateMatch(seed, options = {}) {
  const rng = createRng(seed);
  const tuning = {
    accuracy: options.accuracy ?? 0.67,
    shieldSkill: options.shieldSkill ?? 0.58,
    bombRate: options.bombRate ?? 0.31,
    splitRate: options.splitRate ?? 0.34,
  };
  const sides = [0, 1].map((id) => ({
    id,
    coreHp: CONFIG.coreHp,
    wallHp: 980,
    focus: CONFIG.focusStart,
    scrap: 0,
    nextShot: rng.range(0.35, 1.05),
    shots: 0,
    blocks: 0,
  }));
  const arrivals = [];
  const dt = 0.125;
  let elapsed = 0;

  while (elapsed < CONFIG.matchSeconds && sides.every((side) => side.coreHp > 0)) {
    const overdrive = CONFIG.matchSeconds - elapsed <= CONFIG.overdriveSeconds;
    const pending = [];

    for (const side of sides) {
      const opponent = sides[1 - side.id];
      const behind = opponent.coreHp - side.coreHp > CONFIG.catchupThreshold;
      side.focus = clamp(
        side.focus + (CONFIG.focusRegen + (behind ? CONFIG.catchupFocusBonus : 0)) * (overdrive ? 1.28 : 1) * dt,
        0,
        CONFIG.focusMax,
      );
      side.nextShot -= dt;
      if (side.nextShot <= 0) {
        const type = chooseSimAction(side, opponent, rng, tuning);
        side.focus -= type.cost;
        side.shots += 1;
        const baseDamage = type.id === "bomb" ? 76 : type.id === "split" ? 55 : 47;
        arrivals.push({
          from: side.id,
          eta: rng.range(0.62, 1.48),
          damage: baseDamage * rng.range(0.76, 1.2) * (overdrive ? 1.18 : 1),
          accurate: rng() < tuning.accuracy,
        });
        side.nextShot = rng.range(1.65, 2.45) + type.reload * 0.24;
      }
    }

    for (const shot of arrivals) {
      shot.eta -= dt;
      if (shot.eta <= 0) pending.push(shot);
    }

    const damageThisTick = [0, 0];
    for (const shot of pending) {
      const defender = sides[1 - shot.from];
      if (!shot.accurate) continue;
      const canShield = defender.focus >= CONFIG.shieldCost;
      const shields = canShield && rng() < tuning.shieldSkill;
      if (shields) {
        defender.focus -= CONFIG.shieldCost;
        defender.blocks += 1;
        continue;
      }
      let damage = Math.min(82, shot.damage);
      if (defender.wallHp > 0) {
        const wallDamage = Math.min(defender.wallHp, damage * 1.12);
        defender.wallHp -= wallDamage;
        defender.scrap += wallDamage * 0.26;
        damage *= defender.wallHp > 0 ? 0.14 : 0.46;
      }
      damageThisTick[defender.id] += damage;
    }

    for (const side of sides) {
      side.coreHp = clamp(side.coreHp - damageThisTick[side.id], 0, CONFIG.coreHp);
      while (side.scrap >= CONFIG.scrapMax) {
        side.scrap -= CONFIG.scrapMax;
        side.coreHp = clamp(side.coreHp + CONFIG.forgeHeal, 0, CONFIG.coreHp);
        side.wallHp = Math.min(980, side.wallHp + 92);
      }
    }

    for (const shot of pending) arrivals.splice(arrivals.indexOf(shot), 1);
    elapsed += dt;
  }

  const timed = decideTimedWinner(
    sides,
    sides.flatMap((side) => [{ owner: side.id, alive: side.wallHp > 0, hp: side.wallHp, maxHp: 980 }]),
  );
  let winner = timed.winner;
  if (sides[0].coreHp <= 0 && sides[1].coreHp <= 0) winner = null;
  else if (sides[0].coreHp <= 0) winner = 1;
  else if (sides[1].coreHp <= 0) winner = 0;

  return {
    seed,
    winner,
    elapsed: Math.min(elapsed, CONFIG.matchSeconds),
    players: sides,
  };
}

export function runBalanceBatch(matches = 2000, seed = 0x20260910) {
  const summary = { matches, leftWins: 0, rightWins: 0, draws: 0, averageSeconds: 0, averageShots: 0 };
  for (let index = 0; index < matches; index += 1) {
    const result = simulateMatch((seed + Math.imul(index + 1, 2654435761)) >>> 0);
    if (result.winner === 0) summary.leftWins += 1;
    else if (result.winner === 1) summary.rightWins += 1;
    else summary.draws += 1;
    summary.averageSeconds += result.elapsed;
    summary.averageShots += result.players[0].shots + result.players[1].shots;
  }
  summary.averageSeconds /= matches;
  summary.averageShots /= matches;
  summary.leftWinRate = summary.leftWins / Math.max(1, summary.leftWins + summary.rightWins);
  return summary;
}
