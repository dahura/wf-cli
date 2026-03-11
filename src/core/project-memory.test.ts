import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, rm } from "node:fs/promises";
import {
  appendProjectMemory,
  getProjectMemoryPaths,
  readProjectMemory,
  readProjectMemoryRecap,
} from "./project-memory";
import { exists, readText } from "./io";

describe("project memory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `wf-memory-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("append writes jsonl and markdown memory artifacts", async () => {
    const entry = await appendProjectMemory(tempDir, {
      summary: "Implemented local vision preprocessing profile support.",
      phase: "coding",
      implemented: ["Added VISION_PREPROCESS_PROFILE", "Updated env templates"],
      next: ["Benchmark conservative vs balanced profile"],
    });

    expect(entry.summary).toContain("Implemented local vision preprocessing");
    const paths = getProjectMemoryPaths(tempDir);
    expect(await exists(paths.jsonlPath)).toBe(true);
    expect(await exists(paths.markdownPath)).toBe(true);

    const markdown = await readText(paths.markdownPath);
    expect(markdown).toContain("Project Memory");
    expect(markdown).toContain("Implemented local vision preprocessing profile support.");
    expect(markdown).toContain("Benchmark conservative vs balanced profile");
  });

  test("recap returns latest entries first", async () => {
    await appendProjectMemory(tempDir, { summary: "Entry one" });
    await appendProjectMemory(tempDir, { summary: "Entry two" });
    await appendProjectMemory(tempDir, { summary: "Entry three" });

    const recap = await readProjectMemoryRecap(tempDir, 2);
    expect(recap.total).toBe(3);
    expect(recap.entries).toHaveLength(2);
    expect(recap.entries[0]?.summary).toBe("Entry three");
    expect(recap.entries[1]?.summary).toBe("Entry two");
  });

  test("read memory tolerates malformed jsonl lines", async () => {
    const paths = getProjectMemoryPaths(tempDir);
    await mkdir(paths.dir, { recursive: true });
    await Bun.write(
      paths.jsonlPath,
      `{"id":"1","timestamp":"2026-01-01T00:00:00.000Z","summary":"ok","implemented":[],"next":[]}\nnot-json\n`,
    );

    const items = await readProjectMemory(tempDir);
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe("ok");
  });

  test("scoped memory does not mix with default scope", async () => {
    await appendProjectMemory(tempDir, { summary: "root-entry" });
    await appendProjectMemory(tempDir, { summary: "aftermeet-entry" }, { scope: "aftermeet" });

    const root = await readProjectMemoryRecap(tempDir, 10);
    const scoped = await readProjectMemoryRecap(tempDir, 10, { scope: "aftermeet" });

    expect(root.total).toBe(1);
    expect(root.entries[0]?.summary).toBe("root-entry");
    expect(scoped.total).toBe(1);
    expect(scoped.entries[0]?.summary).toBe("aftermeet-entry");
    expect(scoped.paths.jsonlPath).toContain(".wf/scopes/aftermeet/project-memory.jsonl");
  });
});
