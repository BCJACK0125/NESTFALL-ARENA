import { spawnSync } from "node:child_process";

const requested = Number(process.argv[2]);
const matches = Number.isFinite(requested) && requested >= 8 ? Math.floor(requested) : 200;
const result = spawnSync(process.execPath, ["--test", "tests/game-flow.test.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PHYSICS_REPORT: "1",
    PHYSICS_MATCHES: String(matches),
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
