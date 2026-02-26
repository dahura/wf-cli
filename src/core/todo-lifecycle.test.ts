import { describe, expect, it } from "bun:test";
import { deriveTodoLifecycle } from "./todo-lifecycle";

describe("todo lifecycle", () => {
  it("derives pending, implemented and accepted statuses with ownership", () => {
    const todo = [
      "- [ ] [T1] Draft design",
      "- [x] [T2] Implement worker loop",
      "- [x] [T3] Add quality tests",
      "",
    ].join("\n");
    const review = [
      "- [T2]: partial",
      "- [T3]: pass",
      "",
    ].join("\n");

    const lifecycle = deriveTodoLifecycle(todo, review);
    expect(lifecycle).toEqual([
      {
        id: "T1",
        text: "Draft design",
        checked: false,
        status: "pending",
        owner: "implementer",
      },
      {
        id: "T2",
        text: "Implement worker loop",
        checked: true,
        status: "implemented",
        owner: "implementer",
      },
      {
        id: "T3",
        text: "Add quality tests",
        checked: true,
        status: "accepted",
        owner: "reviewer",
      },
    ]);
  });

  it("ignores TODO entries without explicit IDs", () => {
    const todo = "- [x] Missing id\n- [x] [T1] Keep this one\n";
    const lifecycle = deriveTodoLifecycle(todo, "");
    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0]?.id).toBe("T1");
  });
});
