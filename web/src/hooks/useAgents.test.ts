import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "./useAgents";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAgents", () => {
  it("fetches agents from /api/agents on mount", async () => {
    const agents = [
      { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(agents) }),
    );

    const { result } = renderHook(() => useAgents());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toEqual(agents);
    expect(fetch).toHaveBeenCalledWith("/api/agents");
  });

  it("sets an error message when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useAgents());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.agents).toEqual([]);
  });

  it("refetch() re-requests the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "a", name: "A", instructions: "do a", repoAccess: false, createdAt: "2026-01-01T00:00:00.000Z" },
          ]),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toEqual([]);

    result.current.refetch();

    await waitFor(() => expect(result.current.agents).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
