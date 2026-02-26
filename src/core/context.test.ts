import { describe, expect, it } from "bun:test";
import { parseContextArgs } from "./context";

describe("parseContextArgs", () => {
  it("accepts evidence include key", () => {
    const parsed = parseContextArgs(["13", "--json", "--include=plan,todo,evidence,state,epic"]);
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }

    expect(parsed.planRef).toBe("13");
    expect(parsed.asJson).toBeTrue();
    expect(parsed.include.has("evidence")).toBeTrue();
    expect(parsed.include.has("epic")).toBeTrue();
  });
});
