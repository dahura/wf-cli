import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { verifyPlanQuality } from "./verify";

async function writePlanFiles(
  planPath: string,
  files: { todo: string; evidence?: string; review?: string },
) {
  await mkdir(planPath, { recursive: true });
  await writeFile(join(planPath, "todo.md"), files.todo, "utf-8");
  await writeFile(join(planPath, "evidence.md"), files.evidence ?? "", "utf-8");
  await writeFile(join(planPath, "review.md"), files.review ?? "", "utf-8");
}

describe("verifyPlanQuality", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "wf-verify-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes all target when both gates pass", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n",
      evidence: "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n",
      review: "- [T1]: pass\n",
    });

    const result = await verifyPlanQuality(planPath, "all");
    expect(result.ok).toBeTrue();
    expect(result.checks.review?.ok).toBeTrue();
    expect(result.checks.done?.ok).toBeTrue();
  });

  it("runs only selected review target", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n",
      evidence: "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n",
      review: "",
    });

    const result = await verifyPlanQuality(planPath, "review");
    expect(result.ok).toBeTrue();
    expect(result.checks.review).not.toBeNull();
    expect(result.checks.done).toBeNull();
  });

  it("fails done target when verdict is missing", async () => {
    const planPath = join(tempRoot, "plans", "01-sample");
    await writePlanFiles(planPath, {
      todo: "- [x] [T1] Implement feature\n",
      evidence: "## T1\n- status: pass\n- command: `bun test`\n- output: pass\n",
      review: "",
    });

    const result = await verifyPlanQuality(planPath, "done");
    expect(result.ok).toBeFalse();
    expect(result.checks.review).toBeNull();
    expect(result.checks.done?.ok).toBeFalse();
  });
});
