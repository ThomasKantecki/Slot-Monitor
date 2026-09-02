import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const valueOf = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
};
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function main() {
  const source = valueOf("--source");
  const audit = valueOf("--audit");
  const runId = valueOf("--run-id");
  if (!source || !audit || !runId) throw new Error("Usage: node scripts/import-oh-physical-slots.mjs --source <unique-slots.csv> --audit <flow-audit.json> --run-id <run-id>");
  const sourcePath = resolve(source);
  const auditPath = resolve(audit);
  const output = join(process.cwd(), "data", "cardiology", "runs", runId, "oh");
  if (!existsSync(sourcePath) || !existsSync(auditPath)) throw new Error("OH source or audit file is missing.");
  if (existsSync(output)) throw new Error(`Run path already exists: ${output}`);

  const sourceText = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
  const sourceRows = Math.max(0, sourceText.trimEnd().split(/\r?\n/).length - 1);
  const flowAudit = JSON.parse(readFileSync(auditPath, "utf8"));
  const statuses = Object.fromEntries([...new Set(flowAudit.map((row) => row.status))].sort().map((status) => [status, flowAudit.filter((row) => row.status === status).length]));

  mkdirSync(join(process.cwd(), "data", "cardiology", "runs", runId), { recursive: true });
  mkdirSync(output, { recursive: false });
  copyFileSync(sourcePath, join(output, "source-oh-unique-physical-slots.csv"));
  copyFileSync(auditPath, join(output, "source-oh-flow-audit.json"));
  writeFileSync(join(output, "manifest.json"), `${JSON.stringify({
    status: "completed_with_warnings",
    source: { originalPath: relative(process.cwd(), sourcePath).replaceAll("\\", "/"), sha256: hash(sourcePath), physicalSlots: sourceRows },
    flowAudit: { originalPath: relative(process.cwd(), auditPath).replaceAll("\\", "/"), sha256: hash(auditPath), completedFlows: flowAudit.length, statuses },
    outputs: ["source-oh-unique-physical-slots.csv", "source-oh-flow-audit.json"],
    importedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`Imported ${sourceRows.toLocaleString()} OH physical slots into ${output}`);
}

main();
