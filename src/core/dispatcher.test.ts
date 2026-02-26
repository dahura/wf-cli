import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FileDistributedJobQueue } from "./distributed";
import { publishPlanPhaseJobs } from "./dispatcher";

describe("dispatcher publication", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-dispatcher-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("publishes phase command jobs when distributed mode is enabled", async () => {
    const planDir = join(tempRoot, "plans", "09-sample");
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, "state.json"),
      JSON.stringify({ phase: "planning", iteration: 0, created_at: "2026-02-20", epic_id: "01" }),
      "utf-8",
    );
    await writeFile(join(planDir, "plan.md"), "# plan\nnon-empty", "utf-8");
    const result = await publishPlanPhaseJobs(tempRoot, "09-sample", { WF_DISTRIBUTED: "1" });
    expect(result.published).toBe(1);
    const queue = new FileDistributedJobQueue(tempRoot);
    const jobs = await queue.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.target.workflow_command).toBe("code");
    expect(jobs[0]?.target.executor_role).toBe("plan-coder");
    expect(jobs[0]?.target.executor_runtime).toBe("opencode");
  });

  it("skips publication when distributed mode is disabled", async () => {
    const planDir = join(tempRoot, "plans", "10-sample");
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, "state.json"),
      JSON.stringify({ phase: "planning", iteration: 0, created_at: "2026-02-20" }),
      "utf-8",
    );
    await writeFile(join(planDir, "plan.md"), "# plan\nnon-empty", "utf-8");
    const result = await publishPlanPhaseJobs(tempRoot, "10-sample", { WF_DISTRIBUTED: "0" });
    expect(result.skipped).toBeTrue();
    const queue = new FileDistributedJobQueue(tempRoot);
    expect(await queue.list()).toHaveLength(0);
  });

  it("publishes when distributed is enabled in runtime config", async () => {
    const planDir = join(tempRoot, "plans", "11-sample");
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, "state.json"),
      JSON.stringify({ phase: "planning", iteration: 0, created_at: "2026-02-20" }),
      "utf-8",
    );
    await writeFile(join(planDir, "plan.md"), "# plan\nnon-empty", "utf-8");
    await mkdir(join(tempRoot, ".wf"), { recursive: true });
    await writeFile(
      join(tempRoot, ".wf", "runtime.json"),
      JSON.stringify({ version: 1, distributed: true, auto_start_workers: false }, null, 2),
      "utf-8",
    );
    const result = await publishPlanPhaseJobs(tempRoot, "11-sample", {});
    expect(result.published).toBe(1);
  });
});
