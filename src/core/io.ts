import { $ } from "bun";
import { dirname } from "path";

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 30_000;

export async function exists(path: string): Promise<boolean> {
  const result = await $`test -e ${path}`.nothrow();
  return result.exitCode === 0;
}

export async function readText(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function readJson<T>(path: string): Promise<T> {
  return (await Bun.file(path).json()) as T;
}

export async function ensureDir(path: string): Promise<void> {
  const result = await $`mkdir -p ${path}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create directory '${path}'.`);
  }
}

export async function removeDir(path: string): Promise<void> {
  const result = await $`rm -rf ${path}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Failed to remove directory '${path}'.`);
  }
}

export async function listDirEntries(path: string): Promise<string[]> {
  const result = await $`ls -1 ${path}`.quiet().nothrow();
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function lockPathFor(path: string): string {
  return `${path}.wf-lock`;
}

async function acquirePathLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    const result = await $`mkdir ${lockPath}`.quiet().nothrow();
    if (result.exitCode === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for file lock '${lockPath}'.`);
    }
    await Bun.sleep(LOCK_RETRY_MS);
  }
}

async function releasePathLock(lockPath: string): Promise<void> {
  const result = await $`rmdir ${lockPath}`.quiet().nothrow();
  if (result.exitCode === 0) return;
  const fallback = await $`rm -rf ${lockPath}`.quiet().nothrow();
  if (fallback.exitCode !== 0) {
    throw new Error(`Failed to release file lock '${lockPath}'.`);
  }
}

async function withPathLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const lockPath = lockPathFor(path);
  await ensureDir(dirname(lockPath));
  await acquirePathLock(lockPath);
  try {
    return await run();
  } finally {
    await releasePathLock(lockPath);
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await withPathLock(path, async () => {
    await ensureDir(dirname(path));
    await Bun.write(path, content);
  });
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, JSON.stringify(value, null, 2));
}
