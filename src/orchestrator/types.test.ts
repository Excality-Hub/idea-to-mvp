import { describe, expect, it } from "vitest";
import { ABORTABLE_STAGES } from "./types.js";

describe("ABORTABLE_STAGES", () => {
  it("lists exactly the four LLM-driven agent stages", () => {
    expect(ABORTABLE_STAGES).toEqual(["analyst", "architect", "developer", "qa"]);
  });
});
