import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applySubagentModelConfig,
  getDefaultSubagentModelCatalog,
  getDefaultSubagentModelConfig,
  initSubagentModelCatalog,
  initSubagentModelConfig,
  listSupportedSubagentModels,
  readSubagentModelCatalog,
  readSubagentModelConfig,
  validateSubagentModelConfig,
} from "./subagents";

describe("subagent model config", () => {
  const originalCwd = process.cwd();
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-subagents-"));
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("initializes config and validates defaults", async () => {
    const result = await initSubagentModelConfig(tempRoot);
    expect(result.created).toBeTrue();
    const config = await readSubagentModelConfig(tempRoot);
    const catalog = await readSubagentModelCatalog(tempRoot);
    const validation = validateSubagentModelConfig(config, catalog);
    expect(validation.ok).toBeTrue();
  });

  it("applies subagent markdown files for cursor and opencode", async () => {
    const config = getDefaultSubagentModelConfig();
    const result = await applySubagentModelConfig(tempRoot, config);
    expect(result.applied["plan-coder"]).toBe("gpt-5.3-codex");

    const cursorAgent = await readFile(
      join(tempRoot, ".cursor", "agents", "plan-coder.md"),
      "utf-8",
    );
    const opencodeAgent = await readFile(
      join(tempRoot, ".opencode", "agents", "plan-reviewer.md"),
      "utf-8",
    );
    const opencodeCoder = await readFile(
      join(tempRoot, ".opencode", "agents", "plan-coder.md"),
      "utf-8",
    );

    expect(cursorAgent).toContain("name: plan-coder");
    expect(opencodeAgent).toContain("mode: subagent");
    expect(opencodeCoder).toContain("model: openrouter/minimax2.1");
  });

  it("fails validation for unknown model", async () => {
    const config = getDefaultSubagentModelConfig();
    config.agents["plan-coder"] = "claude-haiku-4.5";
    const validation = validateSubagentModelConfig(config, getDefaultSubagentModelCatalog());
    expect(validation.ok).toBeTrue();
    expect(validation.warnings[0]).toContain("Did you mean 'claude-4.5-haiku'?");
  });

  it("lists supported subagent models", async () => {
    await initSubagentModelCatalog(tempRoot);
    const catalog = await readSubagentModelCatalog(tempRoot);
    const models = listSupportedSubagentModels(catalog);
    expect(models).toContain("gpt-5.3-codex");
    expect(models).toContain("claude-4.5-haiku");
    expect(models).toContain("openrouter/minimax2.1");
    expect(models).toContain("alibaba/qwen3.5-plus");
  });
});
