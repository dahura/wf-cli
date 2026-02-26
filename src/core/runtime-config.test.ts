import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isDistributedEnabled,
  readRuntimeConfig,
  shouldAutoStartWorkers,
  writeRuntimeConfig,
} from "./runtime-config";

describe("runtime config", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-runtime-config-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses defaults when config file is missing", async () => {
    const config = await readRuntimeConfig(tempRoot);
    expect(config.distributed).toBeFalse();
    expect(config.auto_start_workers).toBeFalse();
  });

  it("prefers env over config for distributed mode", async () => {
    await writeRuntimeConfig(tempRoot, { distributed: false });
    expect(await isDistributedEnabled(tempRoot, { WF_DISTRIBUTED: "1" })).toBeTrue();
    expect(await isDistributedEnabled(tempRoot, { WF_DISTRIBUTED: "0" })).toBeFalse();
  });

  it("reads distributed and auto worker values from config", async () => {
    await writeRuntimeConfig(tempRoot, { distributed: true, auto_start_workers: true });
    expect(await isDistributedEnabled(tempRoot, {})).toBeTrue();
    expect(await shouldAutoStartWorkers(tempRoot, undefined)).toBeTrue();
  });
});
