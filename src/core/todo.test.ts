import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTodoLifecycle, markTodoAccepted, markTodoImplemented, rejectTodo } from "./todo";

let rootDir = "";
let planDir = "";

async function writePlanFiles(input: {
  phase: string;
  todo: string;
  evidence?: string;
  review?: string;
}) {
  await writeFile(
    join(planDir, "state.json"),
    JSON.stringify({ phase: input.phase, iteration: 0, created_at: "2026-02-20" }, null, 2),
  );
  await writeFile(join(planDir, "todo.md"), input.todo);
  await writeFile(join(planDir, "evidence.md"), input.evidence ?? "# Evidence\n");
  if (input.review !== undefined) {
    await writeFile(join(planDir, "review.md"), input.review);
  }
}

describe("todo lifecycle commands", () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wf-todo-"));
    planDir = join(rootDir, "plans", "01-sample");
    await Bun.$`mkdir -p ${planDir}`.quiet();
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("marks TODO implemented in coding and enriches evidence", async () => {
    await writePlanFiles({
      phase: "coding",
      todo: "- [ ] [T1] add worker command\n- [ ] [T2] add tests\n",
      evidence: "# Evidence\n",
    });

    const result = await markTodoImplemented(planDir, "T1", {
      command: "bun test src/core/worker.test.ts",
      output: "1 pass",
    });
    const lifecycle = result.lifecycle.find((item) => item.id === "T1");
    expect(lifecycle?.status).toBe("implemented");
    const todo = await Bun.file(join(planDir, "todo.md")).text();
    const evidence = await Bun.file(join(planDir, "evidence.md")).text();
    expect(todo).toContain("- [x] [T1] add worker command");
    expect(evidence).toContain("## T1");
    expect(evidence).toContain("- command: `bun test src/core/worker.test.ts`");
    expect(evidence).toContain("- output: 1 pass");
  });

  it("accepts implemented TODO in reviewing", async () => {
    await writePlanFiles({
      phase: "reviewing",
      todo: "- [x] [T1] add worker command\n",
      review: "# Review\n",
    });
    const result = await markTodoAccepted(planDir, "T1", "reviewed");
    const lifecycle = result.lifecycle.find((item) => item.id === "T1");
    expect(lifecycle?.status).toBe("accepted");
    const review = await Bun.file(join(planDir, "review.md")).text();
    expect(review).toContain("- [T1]: pass");
  });

  it("rejects TODO in reviewing and makes it pending", async () => {
    await writePlanFiles({
      phase: "reviewing",
      todo: "- [x] [T1] add worker command\n",
      review: "# Review\n- [T1]: pass\n",
    });
    const result = await rejectTodo(planDir, "T1", "needs negative tests");
    const lifecycle = result.lifecycle.find((item) => item.id === "T1");
    expect(lifecycle?.status).toBe("pending");
    const todo = await Bun.file(join(planDir, "todo.md")).text();
    const review = await Bun.file(join(planDir, "review.md")).text();
    expect(todo).toContain("- [ ] [T1] add worker command");
    expect(review).toContain("- [T1]: fail");
  });

  it("returns lifecycle projection for list operation", async () => {
    await writePlanFiles({
      phase: "reviewing",
      todo: "- [x] [T1] add worker command\n- [ ] [T2] add docs\n",
      review: "# Review\n- [T1]: pass\n",
    });
    const result = await getTodoLifecycle(planDir);
    expect(result.lifecycle).toHaveLength(2);
    expect(result.lifecycle[0]?.status).toBe("accepted");
    expect(result.lifecycle[1]?.status).toBe("pending");
  });
});
