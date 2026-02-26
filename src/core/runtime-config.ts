import { join } from "path";
import { exists, readJson, writeJson } from "./io";

export type RuntimeConfig = {
  version: 1;
  distributed: boolean;
  auto_start_workers: boolean;
};

const RUNTIME_CONFIG_PATH = join(".wf", "runtime.json");

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  version: 1,
  distributed: false,
  auto_start_workers: false,
};

export function getRuntimeConfigPath(cwd: string): string {
  return join(cwd, RUNTIME_CONFIG_PATH);
}

export async function readRuntimeConfig(cwd: string): Promise<RuntimeConfig> {
  const path = getRuntimeConfigPath(cwd);
  if (!(await exists(path))) {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
  const parsed = await readJson<Partial<RuntimeConfig>>(path);
  return {
    version: 1,
    distributed: parsed.distributed === true,
    auto_start_workers: parsed.auto_start_workers === true,
  };
}

export async function writeRuntimeConfig(
  cwd: string,
  patch: Partial<Pick<RuntimeConfig, "distributed" | "auto_start_workers">>,
): Promise<RuntimeConfig> {
  const prev = await readRuntimeConfig(cwd);
  const next: RuntimeConfig = {
    ...prev,
    ...(patch.distributed !== undefined ? { distributed: patch.distributed } : {}),
    ...(patch.auto_start_workers !== undefined
      ? { auto_start_workers: patch.auto_start_workers }
      : {}),
  };
  await writeJson(getRuntimeConfigPath(cwd), next);
  return next;
}

export async function isDistributedEnabled(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (env.WF_DISTRIBUTED !== undefined) {
    return env.WF_DISTRIBUTED === "1";
  }
  const config = await readRuntimeConfig(cwd);
  return config.distributed;
}

export async function shouldAutoStartWorkers(
  cwd: string,
  explicit: boolean | undefined,
): Promise<boolean> {
  if (explicit !== undefined) return explicit;
  const config = await readRuntimeConfig(cwd);
  return config.auto_start_workers;
}
