import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { validatePlanReadyForDone, validatePlanReadyForReview } from "./quality";

async function writePlanFiles(
  planPath: string,
  files: { todo: string; evidence?: string; review?: string },
) {
  await mkdir(planPath, { recursive: true });
  await writeFile(join(planPath, "todo.md"), files.todo, "utf-8");
  if (files.evidence !== undefined) {
    await writeFile(join(planPath, "evidence.md"), files.evidence, "utf-8");
  }
  if (files.review !== undefined) {
    await writeFile(join(planPath, "review.md"), files.review, "utf-8");
  }
}

describe("quality gates", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-quality-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes review gate when TODO and evidence are aligned", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n- [x] [T2] Add tests\n",
      evidence:
        "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n\n## T2\n- status: pass\n- command: `bun test`\n- output: pass\n",
    });

    const result = await validatePlanReadyForReview(planPath);
    expect(result.ok).toBeTrue();
    expect(result.errors).toHaveLength(0);
  });

  it("fails review gate when TODO has unchecked items", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n- [ ] [T2] Add tests\n",
      evidence: "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n",
    });

    const result = await validatePlanReadyForReview(planPath);
    expect(result.ok).toBeFalse();
    expect(result.errors.some((error) => error.includes("unchecked"))).toBeTrue();
  });

  it("fails review gate when checked TODO item has no explicit ID", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] Implement feature without ID\n",
      evidence: "## T0\n- status: pass\n- command: `bun test`\n- output: pass\n",
    });

    const result = await validatePlanReadyForReview(planPath);
    expect(result.ok).toBeFalse();
    expect(result.errors.some((error) => error.includes("explicit IDs"))).toBeTrue();
  });

  it("fails review gate when evidence is missing for TODO ID", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n",
      evidence: "",
    });

    const result = await validatePlanReadyForReview(planPath);
    expect(result.ok).toBeFalse();
    expect(result.errors.some((error) => error.includes("missing section/status"))).toBeTrue();
  });

  it("fails review gate with migration hint when evidence.md is missing", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n",
    });

    const result = await validatePlanReadyForReview(planPath);
    expect(result.ok).toBeFalse();
    expect(result.errors.some((error) => error.includes("evidence.md is missing"))).toBeTrue();
  });

  it("passes done gate when review has pass verdicts for all TODO IDs", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n- [x] [T2] Add tests\n",
      evidence:
        "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n## T2\n- status: pass\n- command: `bun test`\n- output: pass\n",
      review: "- [T1]: pass\n- [T2]: pass\n",
    });

    const result = await validatePlanReadyForDone(planPath);
    expect(result.ok).toBeTrue();
    expect(result.errors).toHaveLength(0);
  });

  it("fails done gate when review verdict is missing or non-pass", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n- [x] [T2] Add tests\n",
      evidence:
        "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n## T2\n- status: pass\n- command: `bun test`\n- output: pass\n",
      review: "- [T1]: pass\n- [T2]: fail\n",
    });

    const result = await validatePlanReadyForDone(planPath);
    expect(result.ok).toBeFalse();
    expect(result.errors.some((error) => error.includes("expected 'pass'"))).toBeTrue();
  });

  it("fails done gate with guidance when review.md is missing", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n",
      evidence: "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n",
    });

    const result = await validatePlanReadyForDone(planPath);
    expect(result.ok).toBeFalse();
    expect(result.errors.some((error) => error.includes("review.md is missing"))).toBeTrue();
  });

  it("fails review gate when evidence command/output fields are missing", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n",
      evidence: "## T1\n- status: pass\n",
    });

    const result = await validatePlanReadyForReview(planPath);
    expect(result.ok).toBeFalse();
    expect(result.errors.some((error) => error.includes("missing command"))).toBeTrue();
    expect(result.errors.some((error) => error.includes("missing output"))).toBeTrue();
  });
});
