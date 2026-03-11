import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, rm } from "node:fs/promises";
import {
  getProjectBriefPaths,
  readProjectBrief,
  readProjectBriefMarkdown,
  upsertProjectBrief,
} from "./project-brief";
import { exists } from "./io";

describe("project brief", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `wf-brief-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("upsert writes json and markdown files", async () => {
    const brief = await upsertProjectBrief(tempDir, {
      summary: "Desktop meeting analysis app with local vision inference.",
      product: "Aftermeet",
      users: "Solo founders and async teams",
      stack: "Tauri + Bun + llama.cpp",
      constraints: ["Works offline", "No cloud dependency by default"],
      successCriteria: ["<20s analysis", "No structured output regressions"],
    });

    expect(brief.summary).toContain("Desktop meeting analysis");
    const paths = getProjectBriefPaths(tempDir);
    expect(await exists(paths.jsonPath)).toBe(true);
    expect(await exists(paths.markdownPath)).toBe(true);

    const markdown = await readProjectBriefMarkdown(tempDir);
    expect(markdown).toContain("Project Brief");
    expect(markdown).toContain("Aftermeet");
    expect(markdown).toContain("No structured output regressions");
  });

  test("read returns null when no brief exists", async () => {
    const brief = await readProjectBrief(tempDir);
    expect(brief).toBeNull();
  });

  test("scoped brief is isolated from default brief", async () => {
    await upsertProjectBrief(tempDir, {
      summary: "Root framework brief",
      product: "bx",
    });
    await upsertProjectBrief(
      tempDir,
      {
        summary: "Aftermeet product brief",
        product: "aftermeet",
      },
      { scope: "aftermeet" },
    );

    const root = await readProjectBrief(tempDir);
    const scoped = await readProjectBrief(tempDir, { scope: "aftermeet" });

    expect(root?.summary).toBe("Root framework brief");
    expect(scoped?.summary).toBe("Aftermeet product brief");
    expect(getProjectBriefPaths(tempDir, { scope: "aftermeet" }).jsonPath).toContain(
      ".wf/scopes/aftermeet/project-brief.json",
    );
  });
});
