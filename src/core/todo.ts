import { join } from "path";
import { exists, readJson, readText, writeText } from "./io";
import { deriveTodoLifecycle, type TodoLifecycleItem } from "./todo-lifecycle";

type PlanState = {
  phase?: string;
};

type ParsedTodoLine = {
  checked: boolean;
  id: string | null;
  text: string;
  index: number;
};

const TODO_PATTERN = /^\s*-\s*\[( |x|X)\]\s+(.*)\s*$/;
const TODO_ID_PATTERN = /^\[([A-Za-z][A-Za-z0-9._-]*)\]\s+(.*)$/;
const EVIDENCE_SECTION_PATTERN = /^##\s+([A-Za-z][A-Za-z0-9._-]*)\s*$/;
const REVIEW_VERDICT_PATTERN =
  /^\s*-\s*\[([A-Za-z][A-Za-z0-9._-]*)\]\s*:\s*(pass|fail|partial)\s*$/i;

function parseTodoLines(content: string): ParsedTodoLine[] {
  const out: ParsedTodoLine[] = [];
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    const match = line.match(TODO_PATTERN);
    if (!match) return;
    const checked = match[1].toLowerCase() === "x";
    const rawText = match[2].trim();
    const idMatch = rawText.match(TODO_ID_PATTERN);
    out.push({
      checked,
      id: idMatch ? idMatch[1] : null,
      text: idMatch ? idMatch[2].trim() : rawText,
      index,
    });
  });
  return out;
}

function updateTodoChecked(todoContent: string, todoId: string, checked: boolean): string {
  const lines = todoContent.split("\n");
  const entries = parseTodoLines(todoContent);
  const item = entries.find((entry) => entry.id === todoId);
  if (!item) {
    throw new Error(`TODO ID '${todoId}' not found in todo.md.`);
  }
  lines[item.index] = `- [${checked ? "x" : " "}] [${todoId}] ${item.text}`;
  return lines.join("\n");
}

function upsertEvidenceSection(
  evidenceContent: string,
  todoId: string,
  input: { command: string; output: string; notes?: string },
): string {
  const lines = evidenceContent.trimEnd().split("\n");
  const sectionStart = lines.findIndex((line) => line.match(EVIDENCE_SECTION_PATTERN)?.[1] === todoId);
  const sectionBlock = [
    `## ${todoId}`,
    "- status: pass",
    `- command: \`${input.command}\``,
    `- output: ${input.output}`,
    `- notes: ${input.notes ?? "updated via wf todo implemented"}`,
  ];

  if (sectionStart === -1) {
    const prefix = evidenceContent.trimEnd();
    return `${prefix}\n\n${sectionBlock.join("\n")}\n`;
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      sectionEnd = i;
      break;
    }
  }
  const next = [...lines.slice(0, sectionStart), ...sectionBlock, ...lines.slice(sectionEnd)];
  return `${next.join("\n").trimEnd()}\n`;
}

function upsertReviewVerdict(
  reviewContent: string,
  todoId: string,
  verdict: "pass" | "fail" | "partial",
  _note?: string,
): string {
  const lines = reviewContent.length > 0 ? reviewContent.trimEnd().split("\n") : ["# Review", ""];
  const target = `- [${todoId}]: ${verdict}`;
  const index = lines.findIndex((line) => line.match(REVIEW_VERDICT_PATTERN)?.[1] === todoId);
  if (index === -1) {
    return `${lines.join("\n").trimEnd()}\n${target}\n`;
  }
  lines[index] = target;
  return `${lines.join("\n").trimEnd()}\n`;
}

async function readPlanPhase(planDirPath: string): Promise<string> {
  const statePath = join(planDirPath, "state.json");
  const state = (await exists(statePath))
    ? await readJson<PlanState>(statePath)
    : {};
  return state.phase ?? "unknown";
}

export async function getTodoLifecycle(
  planDirPath: string,
): Promise<{ lifecycle: TodoLifecycleItem[]; phase: string }> {
  const todoPath = join(planDirPath, "todo.md");
  const reviewPath = join(planDirPath, "review.md");
  const phase = await readPlanPhase(planDirPath);
  const todo = (await exists(todoPath)) ? await readText(todoPath) : "";
  const review = (await exists(reviewPath)) ? await readText(reviewPath) : "";
  return { lifecycle: deriveTodoLifecycle(todo, review), phase };
}

export async function markTodoImplemented(
  planDirPath: string,
  todoId: string,
  input: { command: string; output: string; notes?: string },
): Promise<{ lifecycle: TodoLifecycleItem[]; phase: string }> {
  const phase = await readPlanPhase(planDirPath);
  if (phase !== "coding" && phase !== "fixing") {
    throw new Error(
      `Cannot mark TODO as implemented from phase '${phase}'. Allowed phases: coding, fixing.`,
    );
  }

  const todoPath = join(planDirPath, "todo.md");
  const evidencePath = join(planDirPath, "evidence.md");

  if (!(await exists(todoPath))) {
    throw new Error("todo.md is missing in plan directory.");
  }
  if (!(await exists(evidencePath))) {
    throw new Error("evidence.md is missing in plan directory.");
  }

  const todoContent = await readText(todoPath);
  const evidenceContent = await readText(evidencePath);
  const updatedTodo = updateTodoChecked(todoContent, todoId, true);
  const updatedEvidence = upsertEvidenceSection(evidenceContent, todoId, input);
  await writeText(todoPath, updatedTodo);
  await writeText(evidencePath, updatedEvidence);
  const reviewPath = join(planDirPath, "review.md");
  const review = (await exists(reviewPath)) ? await readText(reviewPath) : "";
  return {
    lifecycle: deriveTodoLifecycle(updatedTodo, review),
    phase,
  };
}

export async function markTodoAccepted(
  planDirPath: string,
  todoId: string,
  note?: string,
): Promise<{ lifecycle: TodoLifecycleItem[]; phase: string }> {
  const phase = await readPlanPhase(planDirPath);
  if (phase !== "reviewing") {
    throw new Error(`Cannot accept TODO from phase '${phase}'. Allowed phase: reviewing.`);
  }

  const todoPath = join(planDirPath, "todo.md");
  const reviewPath = join(planDirPath, "review.md");
  if (!(await exists(todoPath))) {
    throw new Error("todo.md is missing in plan directory.");
  }

  const todoContent = await readText(todoPath);
  const entries = parseTodoLines(todoContent);
  const item = entries.find((entry) => entry.id === todoId);
  if (!item) throw new Error(`TODO ID '${todoId}' not found in todo.md.`);
  if (!item.checked) {
    throw new Error(`TODO ID '${todoId}' must be implemented (checked) before acceptance.`);
  }

  const reviewContent = (await exists(reviewPath)) ? await readText(reviewPath) : "";
  const updatedReview = upsertReviewVerdict(reviewContent, todoId, "pass", note);
  await writeText(reviewPath, updatedReview);
  return {
    lifecycle: deriveTodoLifecycle(todoContent, updatedReview),
    phase,
  };
}

export async function rejectTodo(
  planDirPath: string,
  todoId: string,
  reason?: string,
): Promise<{ lifecycle: TodoLifecycleItem[]; phase: string }> {
  const phase = await readPlanPhase(planDirPath);
  if (phase !== "reviewing") {
    throw new Error(`Cannot reject TODO from phase '${phase}'. Allowed phase: reviewing.`);
  }

  const todoPath = join(planDirPath, "todo.md");
  const reviewPath = join(planDirPath, "review.md");
  if (!(await exists(todoPath))) {
    throw new Error("todo.md is missing in plan directory.");
  }

  const todoContent = await readText(todoPath);
  const updatedTodo = updateTodoChecked(todoContent, todoId, false);
  const reviewContent = (await exists(reviewPath)) ? await readText(reviewPath) : "";
  const updatedReview = upsertReviewVerdict(reviewContent, todoId, "fail", reason);
  await writeText(todoPath, updatedTodo);
  await writeText(reviewPath, updatedReview);
  return {
    lifecycle: deriveTodoLifecycle(updatedTodo, updatedReview),
    phase,
  };
}
