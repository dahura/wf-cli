import { runInitWithOptions, runSkillSync, runSync } from "./assets";
import { runRuntime } from "./runtime";

const args = process.argv.slice(2);
const command = args[0];
const repoRoot = process.cwd();

process.chdir(repoRoot);

const wantsHelp = args.includes("--help") || args.includes("-h");

if (command === "init" && !wantsHelp) {
  const force = args.includes("--force");
  await runInitWithOptions(repoRoot, { force });
  process.exit(0);
}

if (command === "sync" && !wantsHelp) {
  const reseed = args.includes("--reseed");
  await runSync(repoRoot, { reseed });
  process.exit(0);
}

if (command === "skill" && args[1] === "sync" && !wantsHelp) {
  await runSkillSync(repoRoot);
  process.exit(0);
}

await runRuntime(args);
