import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjects } from "./useProjects";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useProjects", () => {
  it("fetches the project list and current project id from /api/projects on mount", async () => {
    const body = {
      projects: [
        { id: "p1", ideaText: "Build a todo app", repoName: "idea-to-mvp-1", createdAt: "2026-09-14T00:00:00.000Z" },
      ],
      currentProjectId: "p1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual(body.projects);
    expect(result.current.currentProjectId).toBe("p1");
    expect(fetch).toHaveBeenCalledWith("/api/projects");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.projects).toEqual([]);
    expect(result.current.currentProjectId).toBeNull();
  });
});
