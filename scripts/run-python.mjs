import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (!args.length) throw new Error("Usage: node scripts/run-python.mjs <script.py> [...args]");
const root = process.cwd();
const configured = process.env.CARDIOLOGY_PYTHON;
const candidates = [
  ...(configured ? [[configured]] : []),
  [join(root, ".venv", "Scripts", "python.exe")],
  [join(root, ".venv", "bin", "python")],
  ["python3"], ["python"], ["py", "-3"],
];
let last = null;
for (const [command, ...prefix] of candidates) {
  if ((command.includes("\\") || command.includes("/")) && !existsSync(command)) continue;
  const probe = spawnSync(command, [...prefix, "--version"], { cwd: root, stdio: "ignore" });
  if (probe.error?.code === "ENOENT" || probe.status !== 0) { last = probe.error; continue; }
  const result = spawnSync(command, [...prefix, ...args], { cwd: root, stdio: "inherit" });
  if (!result.error) process.exit(result.status ?? 1);
  last = result.error; break;
}
console.error("Python 3.9+ was not found. Create .venv or set CARDIOLOGY_PYTHON to a Python executable.");
if (last) console.error(last.message);
process.exit(1);
