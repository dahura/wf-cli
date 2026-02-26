import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDedupeKey, FileDistributedJobQueue } from "./distributed";

describe("distributed queue (sqlite)", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-distributed-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates sqlite queue db and dedupes by key", async () => {
    const queue = new FileDistributedJobQueue(tempRoot);
    const target = {
      plan_id: "11",
      plan_iteration: 0,
      workflow_command: "code" as const,
      executor_role: "plan-coder" as const,
      executor_runtime: "opencode",
      epic_id: "01",
    };
    const dedupeKey = buildDedupeKey(target);
    const input = {
      contract_version: 1 as const,
      dedupe_key: dedupeKey,
      dedupe_scope: { scope: "epic" as const, epic_id: "01" },
      target,
      created_at: new Date().toISOString(),
      metadata: { source: "test" },
    };

    const first = await queue.enqueue(input);
    const second = await queue.enqueue(input);

    expect(first.deduped).toBeFalse();
    expect(second.deduped).toBeTrue();

    const dbPath = join(tempRoot, ".wf", "distributed", "queue.db");
    expect(existsSync(dbPath)).toBeTrue();
  });

  it("claims only matching role/runtime jobs", async () => {
    const queue = new FileDistributedJobQueue(tempRoot);
    const target = {
      plan_id: "12",
      plan_iteration: 0,
      workflow_command: "code" as const,
      executor_role: "plan-coder" as const,
      executor_runtime: "opencode",
    };
    await queue.enqueue({
      contract_version: 1,
      dedupe_key: buildDedupeKey(target),
      dedupe_scope: { scope: "plan", plan_id: "12" },
      target,
      created_at: new Date().toISOString(),
    });

    const wrongRuntime = await queue.claimNext({
      worker: { worker_id: "w1", runtime: "cursor" },
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      role_filter: "plan-coder",
      runtime_filter: "cursor",
      command_filter: ["code"],
      request_id: crypto.randomUUID(),
    });
    expect(wrongRuntime).toBeNull();

    const matched = await queue.claimNext({
      worker: { worker_id: "w2", runtime: "opencode" },
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      role_filter: "plan-coder",
      runtime_filter: "opencode",
      command_filter: ["code"],
      request_id: crypto.randomUUID(),
    });
    expect(matched?.status).toBe("claimed");
    expect(matched?.owner?.runtime).toBe("opencode");
  });

  it("reclaims job after stall + requeue", async () => {
    const queue = new FileDistributedJobQueue(tempRoot);
    const target = {
      plan_id: "13",
      plan_iteration: 0,
      workflow_command: "code" as const,
      executor_role: "plan-coder" as const,
      executor_runtime: "opencode",
    };
    await queue.enqueue({
      contract_version: 1,
      dedupe_key: buildDedupeKey(target),
      dedupe_scope: { scope: "plan", plan_id: "13" },
      target,
      created_at: new Date().toISOString(),
    });

    const firstClaim = await queue.claimNext({
      worker: { worker_id: "w-old", runtime: "opencode" },
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      role_filter: "plan-coder",
      runtime_filter: "opencode",
      command_filter: ["code"],
      request_id: crypto.randomUUID(),
    });
    expect(firstClaim?.status).toBe("claimed");

    await queue.start({
      job_id: firstClaim!.job_id,
      actor: { worker_id: "w-old", runtime: "opencode" },
      cas: { expected_rev: firstClaim!.rev, expected_status: "claimed", expected_owner: { worker_id: "w-old", runtime: "opencode" } },
      to_status: "running",
      at: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    });
    const running = await queue.getById(firstClaim!.job_id);
    expect(running?.status).toBe("running");

    await queue.stall({
      job_id: firstClaim!.job_id,
      cas: { expected_rev: running!.rev, expected_status: "running" },
      at: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    });
    const stalled = await queue.getById(firstClaim!.job_id);
    expect(stalled?.status).toBe("stalled");

    await queue.requeueStalled({
      job_id: firstClaim!.job_id,
      cas: { expected_rev: stalled!.rev, expected_status: "stalled" },
      at: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    });

    const secondClaim = await queue.claimNext({
      worker: { worker_id: "w-new", runtime: "opencode" },
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      role_filter: "plan-coder",
      runtime_filter: "opencode",
      command_filter: ["code"],
      request_id: crypto.randomUUID(),
    });
    expect(secondClaim).not.toBeNull();
    expect(secondClaim?.owner?.worker_id).toBe("w-new");
    expect(secondClaim?.attempt).toBe(2);
  });
});

