import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { JsonTree } from "./JsonTree";

describe("JsonTree", () => {
  it("renders string, number, and boolean primitives with their keys", () => {
    render(<JsonTree data={{ title: "Build a todo app", count: 3, done: false }} />);

    expect(screen.getByText("title:")).toBeInTheDocument();
    expect(screen.getByText('"Build a todo app"')).toBeInTheDocument();
    expect(screen.getByText("count:")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("done:")).toBeInTheDocument();
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("renders null and undefined values distinctly", () => {
    render(<JsonTree data={{ a: null, b: undefined }} />);

    expect(screen.getByText("null")).toBeInTheDocument();
    expect(screen.getByText("undefined")).toBeInTheDocument();
  });

  it("renders an empty object and empty array inline without a toggle", () => {
    render(<JsonTree data={{ emptyObj: {}, emptyArr: [] }} />);

    expect(screen.getByText("{}")).toBeInTheDocument();
    expect(screen.getByText("[]")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "emptyObj" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "emptyArr" })).not.toBeInTheDocument();
  });

  it("renders nested objects and arrays expanded by default, with array items labeled by index", () => {
    render(<JsonTree data={{ goals: ["ship it", "test it"], nested: { x: 1 } }} />);

    expect(screen.getByText("0:")).toBeInTheDocument();
    expect(screen.getByText('"ship it"')).toBeInTheDocument();
    expect(screen.getByText("1:")).toBeInTheDocument();
    expect(screen.getByText('"test it"')).toBeInTheDocument();
    expect(screen.getByText("x:")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("collapses a node on click, hiding its children, and expands again on a second click", async () => {
    const user = userEvent.setup();
    render(<JsonTree data={{ nested: { x: 1 } }} />);

    expect(screen.getByText("x:")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /nested/ }));
    expect(screen.queryByText("x:")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /nested/ }));
    expect(screen.getByText("x:")).toBeInTheDocument();
  });
});
