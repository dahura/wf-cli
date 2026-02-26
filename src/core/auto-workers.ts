import { join } from "path";
import { exists, readJson, writeJson } from "./io";
import { WORKER_ROLE_COMMAND_FILTERS, type WorkerRole } from "./distributed";
import { resolveExecutorRuntime } from "./routing";

type AutoWorkerRecord = {
  pid: number;
  role: WorkerRole;
  runtime: string;
  started_at: string;
};

export type AutoWorkersResult = {
  started: Array<{ role: WorkerRole; runtime: string; pid: number }>;
  already_running: Array<{ role: WorkerRole; runtime: string; pid: number }>;
  failed: Array<{ role: WorkerRole; runtime: string; error: string }>;
  skipped: Array<{ role: WorkerRole; runtime: string; reason: string }>;
};

const AUTO_WORKERS_DIR = join(".wf", "distributed", "workers");

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getWorkerRecordPath(cwd: string, role: WorkerRole, runtime: string): string {
  return join(cwd, AUTO_WORKERS_DIR, `${role}@${runtime}.json`);
}

async function readWorkerRecord(path: string): Promise<AutoWorkerRecord | null> {
  if (!(await exists(path))) return null;
  try {
    return await readJson<AutoWorkerRecord>(path);
  } catch {
    return null;
  }
}

async function spawnWorker(
  cwd: string,
  role: WorkerRole,
  runtime: string,
): Promise<{ ok: true; pid: number } | { ok: false; error: string }> {
  const workerId = `auto-${runtime}-${role}`;
  try {
    const child = Bun.spawn({
      cmd: ["bun", "run", "wf", "worker", role, "--runtime", runtime, "--id", workerId],
      cwd,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    child.unref();
    if (!child.pid || child.pid <= 0) {
      return { ok: false, error: "Worker process did not return a valid PID." };
    }
    return { ok: true, pid: child.pid };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "Failed to spawn worker process." };
  }
}

export async function ensureAutoWorkers(cwd: string): Promise<AutoWorkersResult> {
  const result: AutoWorkersResult = {
    started: [],
    already_running: [],
    failed: [],
    skipped: [],
  };

  const roles = Object.keys(WORKER_ROLE_COMMAND_FILTERS) as WorkerRole[];
  for (const role of roles) {
    const runtime = await resolveExecutorRuntime(cwd, role);
    if (runtime === "opencode") {
      result.skipped.push({
        role,
        runtime,
        reason: "OpenCode workers are interactive and must be started via /worker in OpenCode.",
      });
      continue;
    }
    const recordPath = getWorkerRecordPath(cwd, role, runtime);
    const existing = await readWorkerRecord(recordPath);
    if (existing && isPidAlive(existing.pid)) {
      result.already_running.push({ role, runtime, pid: existing.pid });
      continue;
    }

    const spawned = await spawnWorker(cwd, role, runtime);
    if (!spawned.ok) {
      result.failed.push({ role, runtime, error: spawned.error });
      continue;
    }

    await writeJson(recordPath, {
      pid: spawned.pid,
      role,
      runtime,
      started_at: new Date().toISOString(),
    } satisfies AutoWorkerRecord);
    result.started.push({ role, runtime, pid: spawned.pid });
  }

  return result;
}
