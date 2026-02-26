import { join } from "path";
import { exists, readText } from "./io";

type TodoItem = {
  checked: boolean;
  id: string | null;
  text: string;
};

type EvidenceStatus = "pass" | "fail" | "partial";
type EvidenceSection = {
  status?: EvidenceStatus;
  command?: string;
  output?: string;
};

type QualityResult = {
  ok: boolean;
  errors: string[];
};

const TODO_PATTERN = /^\s*-\s*\[( |x|X)\]\s+(.*)\s*$/;
const TODO_ID_PATTERN = /^\[([A-Za-z][A-Za-z0-9._-]*)\]\s+(.*)$/;
const EVIDENCE_SECTION_PATTERN = /^##\s+([A-Za-z][A-Za-z0-9._-]*)\s*$/;
const EVIDENCE_STATUS_PATTERN = /^\s*-\s*status:\s*(pass|fail|partial)\s*$/i;
const EVIDENCE_COMMAND_PATTERN = /^\s*-\s*command:\s*`?(.+?)`?\s*$/i;
const EVIDENCE_OUTPUT_PATTERN = /^\s*-\s*output:\s*(.+)\s*$/i;
const REVIEW_VERDICT_PATTERN =
  /^\s*-\s*\[([A-Za-z][A-Za-z0-9._-]*)\]\s*:\s*(pass|fail|partial)\s*$/i;

function parseTodoItems(content: string): TodoItem[] {
  const items: TodoItem[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(TODO_PATTERN);
    if (!match) continue;

    const checked = match[1].toLowerCase() === "x";
    const rawText = match[2].trim();
    const idMatch = rawText.match(TODO_ID_PATTERN);

    items.push({
      checked,
      id: idMatch ? idMatch[1] : null,
      text: idMatch ? idMatch[2].trim() : rawText,
    });
  }

  return items;
}

function collectDuplicateIds(ids: string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
}

function parseEvidenceSections(content: string): Map<string, EvidenceSection> {
  const sections = new Map<string, EvidenceSection>();
  let currentId: string | null = null;

  for (const line of content.split("\n")) {
    const sectionMatch = line.match(EVIDENCE_SECTION_PATTERN);
    if (sectionMatch) {
      currentId = sectionMatch[1];
      sections.set(currentId, {});
      continue;
    }

    if (!currentId) continue;

    const statusMatch = line.match(EVIDENCE_STATUS_PATTERN);
    if (statusMatch) {
      const section = sections.get(currentId) ?? {};
      section.status = statusMatch[1].toLowerCase() as EvidenceStatus;
      sections.set(currentId, section);
      continue;
    }

    const commandMatch = line.match(EVIDENCE_COMMAND_PATTERN);
    if (commandMatch) {
      const section = sections.get(currentId) ?? {};
      section.command = commandMatch[1].trim();
      sections.set(currentId, section);
      continue;
    }

    const outputMatch = line.match(EVIDENCE_OUTPUT_PATTERN);
    if (outputMatch) {
      const section = sections.get(currentId) ?? {};
      section.output = outputMatch[1].trim();
      sections.set(currentId, section);
    }
  }

  return sections;
}

function parseReviewVerdicts(content: string): Map<string, EvidenceStatus> {
  const verdicts = new Map<string, EvidenceStatus>();

  for (const line of content.split("\n")) {
    const match = line.match(REVIEW_VERDICT_PATTERN);
    if (!match) continue;
    verdicts.set(match[1], match[2].toLowerCase() as EvidenceStatus);
  }

  return verdicts;
}

export async function validatePlanReadyForReview(planPath: string): Promise<QualityResult> {
  const todoPath = join(planPath, "todo.md");
  const evidencePath = join(planPath, "evidence.md");

  const todoExists = await exists(todoPath);
  if (!todoExists) {
    return {
      ok: false,
      errors: ["todo.md is missing in plan directory."],
    };
  }

  const evidenceExists = await exists(evidencePath);
  if (!evidenceExists) {
    return {
      ok: false,
      errors: [
        "evidence.md is missing in plan directory. Create it and add pass evidence for checked TODO IDs.",
      ],
    };
  }

  const todoContent = await readText(todoPath);
  const evidenceContent = await readText(evidencePath);

  const todoItems = parseTodoItems(todoContent);
  if (todoItems.length === 0) {
    return {
      ok: false,
      errors: ["todo.md contains no checklist items to validate."],
    };
  }

  const unchecked = todoItems.filter((item) => !item.checked);
  const checked = todoItems.filter((item) => item.checked);
  const checkedWithoutId = checked.filter((item) => item.id === null);
  const checkedIds = checked
    .map((item) => item.id)
    .filter((id): id is string => id !== null);
  const duplicateCheckedIds = collectDuplicateIds(checkedIds);

  const errors: string[] = [];
  if (unchecked.length > 0) {
    errors.push(
      `todo.md has ${unchecked.length} unchecked item(s).`,
    );
  }
  if (checkedWithoutId.length > 0) {
    errors.push(
      "All checked TODO items must use explicit IDs in format: - [x] [T1] task text.",
    );
  }
  if (duplicateCheckedIds.length > 0) {
    errors.push(`Duplicate TODO IDs found: ${duplicateCheckedIds.join(", ")}.`);
  }

  const evidenceSections = parseEvidenceSections(evidenceContent);
  for (const id of checkedIds) {
    const evidence = evidenceSections.get(id);
    if (!evidence?.status) {
      errors.push(`evidence.md is missing section/status for TODO ID '${id}'.`);
      continue;
    }
    const status = evidence.status;
    if (status !== "pass") {
      errors.push(`evidence.md marks TODO ID '${id}' as '${status}', expected 'pass'.`);
    }
    if (!evidence.command) {
      errors.push(`evidence.md is missing command for TODO ID '${id}'.`);
    }
    if (!evidence.output) {
      errors.push(`evidence.md is missing output for TODO ID '${id}'.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export async function validatePlanReadyForDone(planPath: string): Promise<QualityResult> {
  const reviewPath = join(planPath, "review.md");
  const todoPath = join(planPath, "todo.md");

  const todoExists = await exists(todoPath);
  if (!todoExists) {
    return {
      ok: false,
      errors: ["todo.md is missing in plan directory."],
    };
  }

  const reviewExists = await exists(reviewPath);
  if (!reviewExists) {
    return {
      ok: false,
      errors: [
        "review.md is missing in plan directory. Add verdict lines for checked TODO IDs: - [T1]: pass|fail|partial",
      ],
    };
  }

  const todoContent = await readText(todoPath);
  const reviewContent = await readText(reviewPath);

  const checkedTodoIds = parseTodoItems(todoContent)
    .filter((item) => item.checked && item.id !== null)
    .map((item) => item.id as string);

  const duplicateCheckedIds = collectDuplicateIds(checkedTodoIds);
  const verdicts = parseReviewVerdicts(reviewContent);

  const errors: string[] = [];
  if (checkedTodoIds.length === 0) {
    errors.push("review gating requires checked TODO items with explicit IDs.");
  }
  if (duplicateCheckedIds.length > 0) {
    errors.push(`Duplicate TODO IDs found: ${duplicateCheckedIds.join(", ")}.`);
  }

  for (const id of checkedTodoIds) {
    const verdict = verdicts.get(id);
    if (!verdict) {
      errors.push(
        `review.md is missing verdict for TODO ID '${id}'. Add line: - [${id}]: pass|fail|partial`,
      );
      continue;
    }
    if (verdict !== "pass") {
      errors.push(`review.md verdict for TODO ID '${id}' is '${verdict}', expected 'pass'.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
