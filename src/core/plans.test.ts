import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPlan } from "./plans";

describe("createPlan", () => {
  const originalCwd = process.cwd();
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-plans-"));
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates evidence.md template for new plans", async () => {
    const plan = await createPlan("quality gate test");
    const planPath = join(tempRoot, "plans", `${plan.number}-${plan.slug}`);
    const evidence = await readFile(join(planPath, "evidence.md"), "utf-8");

    expect(evidence).toContain("# Evidence");
    expect(evidence).toContain("## T1");
    expect(evidence).toContain("- status: pass");
  });
});
