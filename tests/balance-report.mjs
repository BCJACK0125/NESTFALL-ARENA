import { CONFIG, runBalanceBatch } from "../js/engine.js";

const MATCHES = 4000;
const SEED = 0x20260910;
const summary = runBalanceBatch(MATCHES, SEED);
const decisiveMatches = summary.leftWins + summary.rightWins;
const rightWinRate = decisiveMatches > 0 ? summary.rightWins / decisiveMatches : 0;
const drawRate = summary.draws / summary.matches;

const percent = (value) => `${(value * 100).toFixed(2)}%`;
const fixed = (value) => value.toFixed(2);

const checks = [
  {
    metric: "P1 勝率（排除和局）",
    result: percent(summary.leftWinRate),
    target: "47.00%–53.00%",
    pass: summary.leftWinRate >= 0.47 && summary.leftWinRate <= 0.53,
  },
  {
    metric: "和局率",
    result: percent(drawRate),
    target: "≤ 3.00%",
    pass: drawRate <= 0.03,
  },
  {
    metric: "平均對局時間",
    result: `${fixed(summary.averageSeconds)} 秒`,
    target: `105–${CONFIG.matchSeconds} 秒`,
    pass: summary.averageSeconds >= 105 && summary.averageSeconds <= CONFIG.matchSeconds,
  },
  {
    metric: "平均總射擊數",
    result: fixed(summary.averageShots),
    target: "85–120",
    pass: summary.averageShots >= 85 && summary.averageShots <= 120,
  },
];

console.log("\n《巢城對決 NESTFALL ARENA》平衡模擬報告");
console.log(`固定種子：0x${SEED.toString(16)}｜模擬場次：${summary.matches.toLocaleString("en-US")}`);
console.log(`P1：${summary.leftWins} 勝（${percent(summary.leftWinRate)}）`);
console.log(`P2：${summary.rightWins} 勝（${percent(rightWinRate)}）`);
console.log(`和局：${summary.draws} 場（${percent(drawRate)}）`);
console.table(checks.map(({ metric, result, target, pass }) => ({
  指標: metric,
  結果: result,
  護欄: target,
  狀態: pass ? "PASS" : "FAIL",
})));

const failures = checks.filter((check) => !check.pass);
if (failures.length > 0) {
  console.error(`平衡檢查失敗：${failures.map((check) => check.metric).join("、")}`);
  process.exitCode = 1;
} else {
  console.log("平衡檢查通過：雙方勝率、和局率、時長與出手密度皆在護欄內。\n");
}
