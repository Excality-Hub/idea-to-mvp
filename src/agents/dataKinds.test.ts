import { describe, expect, it } from "vitest";
import { BACKBONE_STAGES } from "../orchestrator/types.js";
import { BACKBONE_STAGE_IO, DATA_KINDS } from "./dataKinds.js";

describe("BACKBONE_STAGE_IO", () => {
  it("has an entry for every backbone stage, in the same order as BACKBONE_STAGES", () => {
    expect(Object.keys(BACKBONE_STAGE_IO)).toEqual(BACKBONE_STAGES);
  });

  it("only references data kinds that exist in DATA_KINDS", () => {
    const known = new Set<string>(DATA_KINDS);
    for (const { inputs, outputs } of Object.values(BACKBONE_STAGE_IO)) {
      for (const kind of [...inputs, ...outputs]) {
        expect(known.has(kind)).toBe(true);
      }
    }
  });

  it("has analyst require idea_text and produce analysis_summary", () => {
    expect(BACKBONE_STAGE_IO.analyst).toEqual({ inputs: ["idea_text"], outputs: ["analysis_summary"] });
  });

  it("has deploy require merged_code, which is exactly what merge produces", () => {
    expect(BACKBONE_STAGE_IO.deploy.inputs).toEqual(["merged_code"]);
    expect(BACKBONE_STAGE_IO.merge.outputs).toEqual(["merged_code"]);
  });

  it("has create_repo require nothing and produce repo", () => {
    expect(BACKBONE_STAGE_IO.create_repo).toEqual({ inputs: [], outputs: ["repo"] });
  });
});
