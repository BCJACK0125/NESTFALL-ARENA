import { expect, test } from "@playwright/test";

import { CONFIG } from "../js/engine.js";

test.describe("NESTFALL ARENA browser smoke", () => {
  /** @type {string[]} */
  let pageErrors;

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/?test=1");
    await page.waitForFunction(() => Boolean(window.__gameTest));
  });

  test.afterEach(() => {
    expect(pageErrors, "頁面執行期間不應出現未捕捉例外").toEqual([]);
  });

  test("首頁可渲染，且測試控制介面完整", async ({ page }) => {
    await expect(page).toHaveTitle(/巢城對決|NESTFALL ARENA/i);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("width", String(CONFIG.width));
    await expect(canvas).toHaveAttribute("height", String(CONFIG.height));

    const apiShape = await page.evaluate(() => {
      const required = ["start", "step", "keyDown", "keyUp", "snapshot", "forceDamage", "restart"];
      return Object.fromEntries(required.map((name) => [name, typeof window.__gameTest?.[name]]));
    });
    expect(apiShape).toEqual({
      start: "function",
      step: "function",
      keyDown: "function",
      keyUp: "function",
      snapshot: "function",
      forceDamage: "function",
      restart: "function",
    });

    await expect(page.locator("#menuLayer")).toBeVisible();
    await page.locator("#tutorialButton").click();
    await expect(page.locator("#tutorialDialog")).toBeVisible();
    await page.locator("#closeTutorial").click();
    await expect(page.locator("#tutorialDialog")).not.toBeVisible();

    // Keyboard activation on a secondary button must not leak into the global
    // Enter-to-start shortcut.
    await page.locator("#tutorialButton").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#tutorialDialog")).toBeVisible();
    expect(await page.evaluate(() => window.__gameTest.snapshot().state)).toBe("menu");
    await page.locator("#closeTutorial").click();

    await page.locator("#startButton").click();
    await expect(page.locator("#menuLayer")).not.toBeVisible();
    expect(await page.evaluate(() => window.__gameTest.snapshot().state)).toBe("countdown");
    await page.evaluate(() => window.__gameTest.step(380));
    expect(await page.evaluate(() => window.__gameTest.snapshot().state)).toBe("playing");

    await page.keyboard.press("Escape");
    await expect(page.locator("#pauseLayer")).toBeVisible();
    await page.locator("#resumeButton").click();
    await expect(page.locator("#pauseLayer")).not.toBeVisible();
    await page.evaluate(() => window.__gameTest.step(370));
    expect(await page.evaluate(() => window.__gameTest.snapshot().state)).toBe("playing");

    await page.evaluate(({ coreHp }) => window.__gameTest.forceDamage(0, coreHp * 2), { coreHp: CONFIG.coreHp });
    await expect(page.locator("#gameOverLayer")).toBeVisible();
    await page.locator("#rematchButton").click();
    await expect(page.locator("#gameOverLayer")).not.toBeVisible();
    expect(await page.evaluate(() => window.__gameTest.snapshot().state)).toBe("countdown");
  });

  test("兩位玩家都能蓄力發射並啟動主動防禦", async ({ page }) => {
    const result = await page.evaluate(() => {
      const game = window.__gameTest;
      game.restart(0xc0ffee);
      game.start(0xc0ffee);
      const initial = game.snapshot();

      game.keyDown("KeyW");
      game.step(12);
      game.keyUp("KeyW");
      game.keyDown("KeyF");
      game.step(72);
      const p1Held = game.snapshot();
      game.keyUp("KeyF");
      game.step(3);

      game.keyDown("ArrowUp");
      game.step(12);
      game.keyUp("ArrowUp");
      game.keyDown("KeyJ");
      game.step(72);
      const p2Held = game.snapshot();
      game.keyUp("KeyJ");
      game.step(3);

      const afterShots = game.snapshot();
      game.keyDown("KeyG");
      game.step(1);
      game.keyUp("KeyG");
      game.keyDown("KeyK");
      game.step(1);
      game.keyUp("KeyK");
      const afterShields = game.snapshot();

      return { initial, p1Held, p2Held, afterShots, afterShields };
    });

    expect(result.initial.state).toBe("playing");
    expect(result.initial.players).toHaveLength(2);
    expect(result.p1Held.players[0].charging).toBe(true);
    expect(result.p2Held.players[1].charging).toBe(true);
    expect(result.afterShots.players[0].shots).toBeGreaterThan(result.initial.players[0].shots);
    expect(result.afterShots.players[1].shots).toBeGreaterThan(result.initial.players[1].shots);
    expect(result.afterShots.projectiles).toBeGreaterThanOrEqual(2);
    expect(result.afterShields.players[0].shieldTimer).toBeGreaterThan(0);
    expect(result.afterShields.players[1].shieldTimer).toBeGreaterThan(0);
    expect(result.afterShields.players[0].focus).toBeLessThan(result.afterShots.players[0].focus);
    expect(result.afterShields.players[1].focus).toBeLessThan(result.afterShots.players[1].focus);
  });

  test("受傷、結算與重新開始形成完整對局循環", async ({ page }) => {
    const result = await page.evaluate(({ coreHp }) => {
      const game = window.__gameTest;
      game.restart(77);
      game.start(77);
      const fresh = game.snapshot();
      game.forceDamage(0, 75);
      const damaged = game.snapshot();
      game.forceDamage(0, coreHp * 2);
      game.step(1);
      const finished = game.snapshot();
      game.restart(78);
      const restarted = game.snapshot();
      return { fresh, damaged, finished, restarted };
    }, { coreHp: CONFIG.coreHp });

    expect(result.fresh.players[0].coreHp).toBe(CONFIG.coreHp);
    expect(result.damaged.players[0].coreHp).toBeLessThan(result.fresh.players[0].coreHp);
    expect(result.finished.players[0].coreHp).toBe(0);
    expect(result.finished.winner).toBe(1);
    expect(result.finished.state).not.toBe("playing");
    expect(result.restarted.players[0].coreHp).toBe(CONFIG.coreHp);
    expect(result.restarted.players[1].coreHp).toBe(CONFIG.coreHp);
    expect(result.restarted.players[0].shots).toBe(0);
    expect(result.restarted.players[1].shots).toBe(0);
    expect(result.restarted.projectiles).toBe(0);
    expect(result.restarted.winner).toBeNull();
  });
});
