import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useActiveProject } from "./useActiveProject";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useActiveProject", () => {
  it("starts with null when nothing is stored", () => {
    const { result } = renderHook(() => useActiveProject());

    expect(result.current[0]).toBeNull();
  });

  it("persists the selected project id to localStorage and reflects it in state", () => {
    const { result } = renderHook(() => useActiveProject());

    act(() => result.current[1]("p1"));

    expect(result.current[0]).toBe("p1");
    expect(window.localStorage.getItem("idea-to-mvp:activeProjectId")).toBe("p1");
  });

  it("reads a previously stored project id on mount", () => {
    window.localStorage.setItem("idea-to-mvp:activeProjectId", "p2");

    const { result } = renderHook(() => useActiveProject());

    expect(result.current[0]).toBe("p2");
  });

  it("clears the stored project id when set to null", () => {
    window.localStorage.setItem("idea-to-mvp:activeProjectId", "p1");
    const { result } = renderHook(() => useActiveProject());

    act(() => result.current[1](null));

    expect(result.current[0]).toBeNull();
    expect(window.localStorage.getItem("idea-to-mvp:activeProjectId")).toBeNull();
  });
});
