import { runInitWithOptions, runSkillSync, runSync } from "./assets";
import { runRuntime } from "./runtime";

const args = process.argv.slice(2);
const command = args[0];
const repoRoot = process.cwd();

process.chdir(repoRoot);

if (command === "init") {
  const force = args.includes("--force");
  await runInitWithOptions(repoRoot, { force });
  process.exit(0);
}

if (command === "sync") {
  const reseed = args.includes("--reseed");
  await runSync(repoRoot, { reseed });
  process.exit(0);
}

if (command === "skill" && args[1] === "sync") {
  await runSkillSync(repoRoot);
  process.exit(0);
}

await runRuntime(args);
