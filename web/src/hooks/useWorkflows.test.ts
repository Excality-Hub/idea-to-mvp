import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflows } from "./useWorkflows";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorkflows", () => {
  it("fetches workflows from /api/workflows on mount", async () => {
    const workflows = [
      {
        id: "default",
        name: "Default",
        slots: { afterAnalyst: [], afterArchitect: [], afterQa: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(workflows) }),
    );

    const { result } = renderHook(() => useWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows).toEqual(workflows);
    expect(fetch).toHaveBeenCalledWith("/api/workflows");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useWorkflows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.workflows).toEqual([]);
  });
});
