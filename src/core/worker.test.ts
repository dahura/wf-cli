import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildDedupeKey, FileDistributedJobQueue } from "./distributed";
import { runWorkerLoop } from "./worker";
import { readJson } from "./io";

describe("worker loop", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-worker-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("claims and executes a role-allowed command", async () => {
    const planDir = join(tempRoot, "plans", "09-sample");
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, "state.json"),
      JSON.stringify({ phase: "planning", iteration: 0, created_at: "2026-02-20" }),
      "utf-8",
    );

    const queue = new FileDistributedJobQueue(tempRoot);
    const target = {
      plan_id: "09",
      plan_iteration: 0,
      workflow_command: "code" as const,
      executor_role: "plan-coder" as const,
      executor_runtime: "opencode",
    };
    await queue.enqueue({
      contract_version: 1,
      dedupe_key: buildDedupeKey(target),
      dedupe_scope: { scope: "plan", plan_id: "09" },
      target,
      created_at: new Date().toISOString(),
      metadata: { source: "test" },
    });

    const result = await runWorkerLoop({
      cwd: tempRoot,
      role: "plan-coder",
      worker: { worker_id: "coder-a", runtime: "opencode" },
      lease_ms: 2000,
      poll_ms: 10,
      max_jobs: 1,
    });
    expect(result.processed).toBe(1);

    const jobs = await queue.list();
    expect(jobs[0]?.status).toBe("succeeded");
    const state = await readJson<{ phase: string }>(join(planDir, "state.json"));
    expect(state.phase).toBe("coding");
  });

  it("does not claim jobs targeted to another runtime", async () => {
    const planDir = join(tempRoot, "plans", "10-sample");
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, "state.json"),
      JSON.stringify({ phase: "planning", iteration: 0, created_at: "2026-02-20" }),
      "utf-8",
    );

    const queue = new FileDistributedJobQueue(tempRoot);
    const target = {
      plan_id: "10",
      plan_iteration: 0,
      workflow_command: "code" as const,
      executor_role: "plan-coder" as const,
      executor_runtime: "opencode",
    };
    await queue.enqueue({
      contract_version: 1,
      dedupe_key: buildDedupeKey(target),
      dedupe_scope: { scope: "plan", plan_id: "10" },
      target,
      created_at: new Date().toISOString(),
      metadata: { source: "test" },
    });

    const result = await runWorkerLoop({
      cwd: tempRoot,
      role: "plan-coder",
      worker: { worker_id: "coder-cursor", runtime: "cursor" },
      lease_ms: 2000,
      poll_ms: 10,
      max_jobs: 1,
    });
    expect(result.processed).toBe(0);

    const jobs = await queue.list();
    expect(jobs[0]?.status).toBe("queued");
  });

  it("does not execute finish-code command in worker loop", async () => {
    const planDir = join(tempRoot, "plans", "11-sample");
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, "state.json"),
      JSON.stringify({ phase: "coding", iteration: 0, created_at: "2026-02-20" }),
      "utf-8",
    );

    const queue = new FileDistributedJobQueue(tempRoot);
    const target = {
      plan_id: "11",
      plan_iteration: 0,
      workflow_command: "finish-code" as const,
      executor_role: "plan-coder" as const,
      executor_runtime: "opencode",
    };
    await queue.enqueue({
      contract_version: 1,
      dedupe_key: buildDedupeKey(target),
      dedupe_scope: { scope: "plan", plan_id: "11" },
      target,
      created_at: new Date().toISOString(),
      metadata: { source: "test" },
    });

    const result = await runWorkerLoop({
      cwd: tempRoot,
      role: "plan-coder",
      worker: { worker_id: "coder-a", runtime: "opencode" },
      lease_ms: 2000,
      poll_ms: 10,
      max_jobs: 1,
    });
    expect(result.processed).toBe(0);

    const jobs = await queue.list();
    expect(jobs[0]?.status).toBe("queued");
  });
});
