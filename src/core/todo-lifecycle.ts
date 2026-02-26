export type TodoLifecycleStatus = "pending" | "implemented" | "accepted";

export type TodoOwnershipRole = "implementer" | "reviewer";

export type TodoLifecycleItem = {
  id: string;
  text: string;
  checked: boolean;
  status: TodoLifecycleStatus;
  owner: TodoOwnershipRole;
};

const TODO_PATTERN = /^\s*-\s*\[( |x|X)\]\s+(.*)\s*$/;
const TODO_ID_PATTERN = /^\[([A-Za-z][A-Za-z0-9._-]*)\]\s+(.*)$/;
const REVIEW_VERDICT_PATTERN =
  /^\s*-\s*\[([A-Za-z][A-Za-z0-9._-]*)\]\s*:\s*(pass|fail|partial)\s*$/i;

type ParsedTodoItem = {
  checked: boolean;
  id: string | null;
  text: string;
};

function parseTodoItems(content: string): ParsedTodoItem[] {
  const items: ParsedTodoItem[] = [];

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

function parseReviewVerdicts(content: string): Map<string, "pass" | "fail" | "partial"> {
  const verdicts = new Map<string, "pass" | "fail" | "partial">();
  for (const line of content.split("\n")) {
    const match = line.match(REVIEW_VERDICT_PATTERN);
    if (!match) continue;
    verdicts.set(match[1], match[2].toLowerCase() as "pass" | "fail" | "partial");
  }
  return verdicts;
}

export function deriveTodoLifecycle(todoContent: string, reviewContent = ""): TodoLifecycleItem[] {
  const reviewVerdicts = parseReviewVerdicts(reviewContent);
  const lifecycle: TodoLifecycleItem[] = [];

  for (const item of parseTodoItems(todoContent)) {
    if (!item.id) continue;
    const reviewVerdict = reviewVerdicts.get(item.id);
    const accepted = item.checked && reviewVerdict === "pass";
    const implemented = item.checked && !accepted;
    lifecycle.push({
      id: item.id,
      text: item.text,
      checked: item.checked,
      status: accepted ? "accepted" : implemented ? "implemented" : "pending",
      owner: accepted ? "reviewer" : "implementer",
    });
  }

  return lifecycle;
}
