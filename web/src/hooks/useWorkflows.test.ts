import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflows } from "./useWorkflows";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorkflows", () => {
  it("does not fetch when projectId is null", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkflows(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.workflows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches workflows from /api/projects/:projectId/workflows on mount", async () => {
    const workflows = [{ id: "p1-default", projectId: "p1", name: "Default", slots: {}, createdAt: "2026-01-01T00:00:00.000Z" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(workflows) }));

    const { result } = renderHook(() => useWorkflows("p1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows).toEqual(workflows);
    expect(fetch).toHaveBeenCalledWith("/api/projects/p1/workflows");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useWorkflows("p1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.workflows).toEqual([]);
  });

  it("refetches when projectId changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderHook(({ projectId }) => useWorkflows(projectId), { initialProps: { projectId: "p1" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/workflows"));

    rerender({ projectId: "p2" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/p2/workflows"));
  });
});
