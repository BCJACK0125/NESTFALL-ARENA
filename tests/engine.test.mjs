import test from "node:test";
import assert from "node:assert/strict";

import {
  BIRD_TYPES,
  CONFIG,
  MATERIALS,
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
  runBalanceBatch,
  scoreSide,
  simulateMatch,
  trajectoryPoints,
} from "../js/engine.js";

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test("核心設定與內容資料保持唯讀", () => {
  assert.equal(CONFIG.width, 1280);
  assert.equal(CONFIG.height, 720);
  assert.equal(CONFIG.matchSeconds, 150);
  assert.equal(BIRD_TYPES.length, 3);
  assert.deepEqual(Object.keys(MATERIALS), ["glass", "wood", "stone"]);
  assert.ok(Object.isFrozen(CONFIG));
  assert.ok(Object.isFrozen(BIRD_TYPES));
  assert.ok(BIRD_TYPES.every(Object.isFrozen));
  assert.ok(Object.values(MATERIALS).every(Object.isFrozen));
});

test("數值工具會限制範圍並正確插值", () => {
  assert.equal(clamp(-2, 0, 10), 0);
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(4, 0, 10), 4);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(easeOutCubic(-1), 0);
  assert.equal(easeOutCubic(0.5), 0.875);
  assert.equal(easeOutCubic(2), 1);
});

test("種子亂數可重現，且輔助方法維持界線", () => {
  const first = createRng(0x1234abcd);
  const second = createRng(0x1234abcd);
  const sequenceA = Array.from({ length: 8 }, () => first());
  const sequenceB = Array.from({ length: 8 }, () => second());

  assert.deepEqual(sequenceA, sequenceB);
  assert.notDeepEqual(sequenceA, Array.from({ length: 8 }, () => createRng(9)()));

  const rng = createRng(42);
  for (let index = 0; index < 100; index += 1) {
    const value = rng.range(-4, 7);
    assert.ok(value >= -4 && value < 7);
    assert.ok(["a", "b", "c"].includes(rng.pick(["a", "b", "c"])));
  }
  assert.equal(Number.isInteger(rng.getState()), true);
});

test("向量旋轉、圓形碰撞與速度反射符合幾何預期", () => {
  const rotated = rotateVector(1, 0, Math.PI / 2);
  closeTo(rotated.x, 0);
  closeTo(rotated.y, 1);

  const collision = circleAabbCollision(
    { x: 0, y: 0, radius: 5 },
    { x: 8, y: 0, w: 8, h: 8 },
  );
  assert.ok(collision);
  closeTo(collision.nx, -1);
  closeTo(collision.ny, 0);
  closeTo(collision.depth, 1);

  assert.equal(
    circleAabbCollision(
      { x: 0, y: 0, radius: 3 },
      { x: 20, y: 0, w: 4, h: 4 },
    ),
    null,
  );

  assert.deepEqual(reflectVelocity(10, 3, -1, 0, 0.5), { vx: -5, vy: 3 });
  assert.deepEqual(reflectVelocity(-10, 3, -1, 0, 0.5), { vx: -10, vy: 3 });
});

test("撞擊傷害具備速度門檻、材質抗性與上限", () => {
  assert.equal(impactDamage(100, 1), 0);
  assert.ok(impactDamage(500, 1, 1) > 0);
  assert.ok(impactDamage(500, 1.5, 1) > impactDamage(500, 1, 1));
  assert.ok(impactDamage(500, 1, 1.5) < impactDamage(500, 1, 1));
  assert.ok(impactDamage(500, 1, 1, 1, true) > impactDamage(500, 1, 1, 1, false));
  assert.equal(impactDamage(10_000, 10, 0.25, 10, true), 82);
});

test("彈道預覽套用重力、風力與透明度衰減", () => {
  const points = trajectoryPoints({
    x: 0,
    y: 0,
    vx: 10,
    vy: -20,
    gravity: 10,
    wind: 4,
    count: 2,
    interval: 1,
  });

  assert.equal(points.length, 2);
  assert.deepEqual(points[0], { x: 12, y: -15, alpha: 0.75 });
  assert.deepEqual(points[1], { x: 28, y: -20, alpha: 0.5 });
});

test("雙方工事為完整鏡像，且每場狀態彼此獨立", () => {
  const left = createStructures(0);
  const right = createStructures(1);

  assert.equal(left.length, 9);
  assert.equal(right.length, left.length);
  for (let index = 0; index < left.length; index += 1) {
    assert.equal(left[index].x + right[index].x, CONFIG.width);
    assert.equal(left[index].y, right[index].y);
    assert.equal(left[index].material, right[index].material);
    assert.equal(left[index].hp, right[index].hp);
    assert.notEqual(left[index].hitAt, right[index].hitAt);
  }

  left[0].hp = 1;
  assert.equal(createStructures(0)[0].hp, MATERIALS.stone.hp);
});

test("計分同時考量核心生命與剩餘工事", () => {
  assert.equal(
    scoreSide(400, [
      { alive: true, hp: 50, maxHp: 100 },
      { alive: false, hp: 100, maxHp: 100 },
    ]),
    400 * 20 + 0.25 * 600,
  );

  const structures = [...createStructures(0), ...createStructures(1)];
  const draw = decideTimedWinner(
    [
      { id: 0, coreHp: CONFIG.coreHp },
      { id: 1, coreHp: CONFIG.coreHp },
    ],
    structures,
  );
  assert.equal(draw.winner, null);

  const leftLead = decideTimedWinner(
    [
      { id: 0, coreHp: CONFIG.coreHp },
      { id: 1, coreHp: CONFIG.coreHp - 20 },
    ],
    structures,
  );
  assert.equal(leftLead.winner, 0);
});

test("抽象對戰模擬可重現且維持資源界線", () => {
  const first = simulateMatch(20260910);
  const replay = simulateMatch(20260910);
  assert.deepEqual(first, replay);
  assert.ok(first.elapsed > 0 && first.elapsed <= CONFIG.matchSeconds);
  assert.ok([null, 0, 1].includes(first.winner));

  for (const player of first.players) {
    assert.ok(player.coreHp >= 0 && player.coreHp <= CONFIG.coreHp);
    assert.ok(player.wallHp >= 0 && player.wallHp <= 720);
    assert.ok(player.focus >= 0 && player.focus <= CONFIG.focusMax);
    assert.ok(player.scrap >= 0 && player.scrap < CONFIG.scrapMax);
    assert.ok(Number.isInteger(player.shots) && player.shots > 0);
    assert.ok(Number.isInteger(player.blocks) && player.blocks >= 0);
  }
});

test("固定種子的 4,000 場批次落在公平性護欄內", () => {
  const summary = runBalanceBatch(4000, 0x20260910);
  const decisiveMatches = summary.leftWins + summary.rightWins;

  assert.equal(summary.matches, 4000);
  assert.equal(summary.leftWins + summary.rightWins + summary.draws, 4000);
  assert.ok(decisiveMatches > 0);
  assert.ok(summary.leftWinRate >= 0.47 && summary.leftWinRate <= 0.53);
  assert.ok(summary.draws / summary.matches <= 0.03);
  assert.ok(summary.averageSeconds >= 105 && summary.averageSeconds <= CONFIG.matchSeconds);
  assert.ok(summary.averageShots >= 85 && summary.averageShots <= 120);
});
