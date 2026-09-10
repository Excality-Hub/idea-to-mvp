import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunPlan } from "./useRunPlan";
import { STAGE_ORDER } from "@/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRunPlan", () => {
  it("returns the default backbone order while idle, without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRunPlan(true, 0));

    expect(result.current).toEqual(STAGE_ORDER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the plan when isIdle becomes false, and uses it once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(["create_repo", "analyst", "custom:sec-1", "architect"]),
      }),
    );

    const { result, rerender } = renderHook(({ isIdle }) => useRunPlan(isIdle, 0), {
      initialProps: { isIdle: true },
    });
    expect(result.current).toEqual(STAGE_ORDER);

    rerender({ isIdle: false });

    await waitFor(() =>
      expect(result.current).toEqual(["create_repo", "analyst", "custom:sec-1", "architect"]),
    );
    expect(fetch).toHaveBeenCalledWith("/api/run/plan");
  });

  it("falls back to the default backbone order when the plan endpoint returns an empty array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));

    const { result, rerender } = renderHook(({ isIdle }) => useRunPlan(isIdle, 0), {
      initialProps: { isIdle: true },
    });

    rerender({ isIdle: false });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toEqual(STAGE_ORDER);
  });

  it("resets to the default backbone order when isIdle becomes true again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(["create_repo", "analyst"]) }),
    );

    const { result, rerender } = renderHook(({ isIdle }) => useRunPlan(isIdle, 0), {
      initialProps: { isIdle: true },
    });
    rerender({ isIdle: false });
    await waitFor(() => expect(result.current).toEqual(["create_repo", "analyst"]));

    rerender({ isIdle: true });

    expect(result.current).toEqual(STAGE_ORDER);
  });

  it("refetches the plan when runGeneration changes even though isIdle did not", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["create_repo", "analyst"]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["create_repo", "architect", "qa"]),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ isIdle, runGeneration }) => useRunPlan(isIdle, runGeneration),
      { initialProps: { isIdle: false, runGeneration: 0 } },
    );

    await waitFor(() => expect(result.current).toEqual(["create_repo", "analyst"]));

    rerender({ isIdle: false, runGeneration: 1 });

    await waitFor(() => expect(result.current).toEqual(["create_repo", "architect", "qa"]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
