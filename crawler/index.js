const { spawn } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const supplied = process.argv.slice(2);
const args = [
  "--filter", "api-server", "exec", "tsx", "src/scripts/gridCrawl.ts",
  ...(supplied.includes("--grid") ? [] : ["--grid", "coordinates.json"]),
  ...(supplied.includes("--state") ? [] : ["--state", "grid-progress.json"]),
  ...(supplied.includes("--monthly-budget-cents") ? [] : ["--monthly-budget-cents", "3000"]),
  ...supplied,
];

const child = spawn("pnpm", args, { cwd: root, stdio: "inherit" });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});