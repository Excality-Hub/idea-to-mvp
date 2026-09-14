import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StageFlowGraph } from "./StageFlowGraph";
import type { EventsByStage } from "@/lib/runEvents";
import type { StageName } from "@/types";

const eventsByStage: EventsByStage = {
  analyst: [{ stage: "analyst", status: "done", message: "done", timestamp: "2026-01-01T00:00:00.000Z" }],
  architect: [{ stage: "architect", status: "running", message: "working", timestamp: "2026-01-01T00:01:00.000Z" }],
};
const stageOrder: StageName[] = ["analyst", "architect"];
const labelFor = (stage: StageName) => (stage === "analyst" ? "Analyst" : "Architect");

describe("StageFlowGraph", () => {
  it("renders one node per stage in stageOrder, labeled via labelFor", async () => {
    render(
      <StageFlowGraph eventsByStage={eventsByStage} stageOrder={stageOrder} labelFor={labelFor} onSelectStage={vi.fn()} />,
    );

    await screen.findByText("Analyst");
    expect(screen.getByText("Architect")).toBeInTheDocument();
  });

  it("calls onSelectStage with the clicked stage's name", async () => {
    const onSelectStage = vi.fn();
    const user = userEvent.setup();
    render(
      <StageFlowGraph
        eventsByStage={eventsByStage}
        stageOrder={stageOrder}
        labelFor={labelFor}
        onSelectStage={onSelectStage}
      />,
    );
    await screen.findByText("Analyst");

    await user.click(screen.getByText("Analyst"));

    expect(onSelectStage).toHaveBeenCalledWith("analyst");
  });
});
