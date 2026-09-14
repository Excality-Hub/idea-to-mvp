import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProject } from "./useProject";

afterEach(() => {
  vi.unstubAllGlobals();
});

const project = {
  id: "p1",
  ideaText: "Build a todo app",
  repoName: "idea-to-mvp-1",
  createdAt: "2026-09-14T00:00:00.000Z",
  events: [],
};

describe("useProject", () => {
  it("does not fetch when id is null", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProject(null));

    expect(result.current.project).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the project from /api/projects/:id when id is set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(project) }));

    const { result } = renderHook(() => useProject("p1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.project).toEqual(project);
    expect(fetch).toHaveBeenCalledWith("/api/projects/p1");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const { result } = renderHook(() => useProject("nope"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.project).toBeUndefined();
  });
});
