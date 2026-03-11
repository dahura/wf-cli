import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEpic,
  getEpicStatus,
  linkPlanToEpic,
  readEpicContext,
  resolveEpic,
  resumeEpicOrchestration,
  runEpicOrchestration,
  stopEpicOrchestration,
  validateEpicScope,
} from "./epics";

describe("epics", () => {
  const originalCwd = process.cwd();
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-epics-"));
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates epic scaffold", async () => {
    const epic = await createEpic("Modern todo app");
    const epicPath = join(tempRoot, "epics", `${epic.number}-${epic.slug}`);
    const epicMd = await readFile(join(epicPath, "epic.md"), "utf-8");
    const plansMap = await readFile(join(epicPath, "plans-map.yaml"), "utf-8");

    expect(epicMd).toContain("# Epic: Modern todo app");
    expect(plansMap).toContain("plans:");
  });

  it("links plan to epic", async () => {
    const epic = await createEpic("Flow");
    const resolved = await resolveEpic(tempRoot, epic.number);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error("Epic should resolve");

    await linkPlanToEpic(resolved.dirPath, "14-sample-plan");
    const context = await readEpicContext(resolved.dirPath);
    expect(context.state.plan_ids).toContain("14-sample-plan");
    expect(context.plansMap).toContain("14-sample-plan");
  });

  it("runs orchestration and auto-creates plans", async () => {
    const epic = await createEpic("Ops board");
    const resolved = await resolveEpic(tempRoot, epic.number);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error("Epic should resolve");

    const run = await runEpicOrchestration(resolved);
    expect(run.created_plans).toBe(3);
    expect(run.total_plans).toBe(3);

    const status = await getEpicStatus(resolved);
    expect(status.orchestration.status).toBe("running");
    expect(status.total_plans).toBe(3);
  });

  it("can stop and resume orchestration", async () => {
    const epic = await createEpic("Flow lifecycle");
    const resolved = await resolveEpic(tempRoot, epic.number);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error("Epic should resolve");

    await runEpicOrchestration(resolved);
    await stopEpicOrchestration(resolved);
    let status = await getEpicStatus(resolved);
    expect(status.orchestration.status).toBe("paused");

    await resumeEpicOrchestration(resolved);
    status = await getEpicStatus(resolved);
    expect(status.orchestration.status).toBe("running");
  });

  it("captures all top-level Plan declarations without truncation", async () => {
    const epic = await createEpic("Large scope");
    const resolved = await resolveEpic(tempRoot, epic.number);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error("Epic should resolve");

    await Bun.write(
      join(resolved.dirPath, "epic.md"),
      `# Epic: Large scope

## Scope
- Plan 01: Alpha
- Plan 02: Beta
- Plan 03: Gamma
- Plan 04: Delta
- Plan 05: Epsilon
- Plan 06: Zeta
- Plan 07: Eta
- Plan 08: Theta
- Plan 09: Iota
`,
    );

    const run = await runEpicOrchestration(resolved);
    expect(run.created_plans).toBe(9);
    expect(run.total_plans).toBe(9);
  });

  it("ignores nested bullets and flags mismatch for extra links", async () => {
    const epic = await createEpic("Nested scope");
    const resolved = await resolveEpic(tempRoot, epic.number);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error("Epic should resolve");

    await Bun.write(
      join(resolved.dirPath, "epic.md"),
      `# Epic: Nested scope

## Scope
- Plan 01: Core
  - Nested detail 1
  - Nested detail 2
`,
    );

    await linkPlanToEpic(resolved.dirPath, "09-unrelated-plan");
    const validation = await validateEpicScope(resolved);

    expect(validation.declared_plans).toHaveLength(1);
    expect(validation.scope_mismatch).toBe(true);
    expect(validation.extra_links).toContain("09-unrelated-plan");
  });

  it("does not mark epic completed when scope mismatch exists", async () => {
    const epic = await createEpic("Mismatch completion");
    const resolved = await resolveEpic(tempRoot, epic.number);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error("Epic should resolve");

    await Bun.write(
      join(resolved.dirPath, "epic.md"),
      `# Epic: Mismatch completion

## Scope
- Plan 01: Declared
`,
    );

    await linkPlanToEpic(resolved.dirPath, "05-not-declared");
    await Bun.$`mkdir -p ${join(tempRoot, "plans", "05-not-declared")}`.quiet();
    await Bun.write(
      join(tempRoot, "plans", "05-not-declared", "state.json"),
      JSON.stringify({ phase: "completed" }),
    );

    const status = await getEpicStatus(resolved);
    expect(status.scope_mismatch).toBe(true);
    expect(status.epic_phase).toBe("active");
    expect(status.orchestration.status).not.toBe("completed");
  });
});
