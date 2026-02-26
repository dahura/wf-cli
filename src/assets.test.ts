import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkillSync, runSync } from "./assets";

describe("skill sync", () => {
  const originalCwd = process.cwd();
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-assets-"));
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("copies skills to both cursor and opencode and replaces stale files", async () => {
    await mkdir(join(tempRoot, ".wf", "skills", "project-skill", "references"), { recursive: true });
    await writeFile(
      join(tempRoot, ".wf", "skills", "project-skill", "SKILL.md"),
      "---\nname: project-skill\ndescription: test\n---\n",
      "utf-8",
    );
    await writeFile(
      join(tempRoot, ".wf", "skills", "project-skill", "references", "stack.md"),
      "# Stack\n",
      "utf-8",
    );

    await mkdir(join(tempRoot, ".cursor", "skills", "project-skill"), { recursive: true });
    await mkdir(join(tempRoot, ".opencode", "skills", "project-skill"), { recursive: true });
    await writeFile(join(tempRoot, ".cursor", "skills", "project-skill", "old.md"), "stale", "utf-8");
    await writeFile(join(tempRoot, ".opencode", "skills", "project-skill", "old.md"), "stale", "utf-8");

    await runSkillSync(tempRoot);

    const cursorSkill = await readFile(
      join(tempRoot, ".cursor", "skills", "project-skill", "SKILL.md"),
      "utf-8",
    );
    const opencodeSkill = await readFile(
      join(tempRoot, ".opencode", "skills", "project-skill", "SKILL.md"),
      "utf-8",
    );
    const cursorReference = await readFile(
      join(tempRoot, ".cursor", "skills", "project-skill", "references", "stack.md"),
      "utf-8",
    );

    expect(cursorSkill).toContain("name: project-skill");
    expect(opencodeSkill).toContain("name: project-skill");
    expect(cursorReference).toContain("# Stack");

    await expect(
      readFile(join(tempRoot, ".cursor", "skills", "project-skill", "old.md"), "utf-8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(tempRoot, ".opencode", "skills", "project-skill", "old.md"), "utf-8"),
    ).rejects.toThrow();
  });

  it("sync also deploys skills when templates are present", async () => {
    await mkdir(join(tempRoot, ".wf", "templates", "cursor", "commands"), { recursive: true });
    await writeFile(
      join(tempRoot, ".wf", "templates", "cursor", "commands", "placeholder.md"),
      "# /placeholder\n",
      "utf-8",
    );

    await mkdir(join(tempRoot, ".wf", "skills", "repo-skill"), { recursive: true });
    await writeFile(
      join(tempRoot, ".wf", "skills", "repo-skill", "SKILL.md"),
      "---\nname: repo-skill\ndescription: repo\n---\n",
      "utf-8",
    );

    await runSync(tempRoot);

    const cursorSkill = await readFile(
      join(tempRoot, ".cursor", "skills", "repo-skill", "SKILL.md"),
      "utf-8",
    );
    const opencodeSkill = await readFile(
      join(tempRoot, ".opencode", "skills", "repo-skill", "SKILL.md"),
      "utf-8",
    );

    expect(cursorSkill).toContain("name: repo-skill");
    expect(opencodeSkill).toContain("name: repo-skill");
  });

  it("runSkillSync is a no-op when .wf/skills does not exist", async () => {
    await runSkillSync(tempRoot);

    await expect(stat(join(tempRoot, ".cursor", "skills"))).rejects.toThrow();
    await expect(stat(join(tempRoot, ".opencode", "skills"))).rejects.toThrow();
  });
});
