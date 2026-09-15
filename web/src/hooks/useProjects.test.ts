import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjects } from "./useProjects";

afterEach(() => {
  vi.unstubAllGlobals();
});

const project = { id: "p1", name: "Todo app", repoName: "todo-app-abc", createdAt: "2026-09-15T00:00:00.000Z" };

describe("useProjects", () => {
  it("fetches the project list from /api/projects on mount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([project]) }));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual([project]);
    expect(fetch).toHaveBeenCalledWith("/api/projects");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.projects).toEqual([]);
  });

  it("creates a project via POST and prepends it to the list", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/projects" && !init) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === "/api/projects" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(project) });
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const created = await result.current.createProject("Todo app");

    expect(created).toEqual(project);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Todo app" }),
    });
    await waitFor(() => expect(result.current.projects).toEqual([project]));
  });

  it("throws from createProject when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (!init) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        return Promise.resolve({ ok: false, status: 400 });
      }),
    );
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.createProject("Bad")).rejects.toThrow();
  });
});
