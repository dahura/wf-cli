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
});
