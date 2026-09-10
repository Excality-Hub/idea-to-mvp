import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonStore } from "./jsonStore.js";

interface Widget {
  id: string;
  name: string;
}

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "json-store-test-"));
  return join(dir, "widgets.json");
}

describe("createJsonStore", () => {
  it("seeds the file with the given items when it doesn't exist yet", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, [{ id: "a", name: "A" }]);

    expect(store.list()).toEqual([{ id: "a", name: "A" }]);
  });

  it("starts empty when no seed is given and the file doesn't exist", () => {
    const store = createJsonStore<Widget>(tempFile());

    expect(store.list()).toEqual([]);
  });

  it("persists a created item so a fresh store reading the same file sees it", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, []);

    store.create({ id: "b", name: "B" });

    const reopened = createJsonStore<Widget>(filePath, []);
    expect(reopened.list()).toEqual([{ id: "b", name: "B" }]);
  });

  it("get() finds an item by id, or returns undefined", () => {
    const store = createJsonStore<Widget>(tempFile(), [{ id: "a", name: "A" }]);

    expect(store.get("a")).toEqual({ id: "a", name: "A" });
    expect(store.get("missing")).toBeUndefined();
  });

  it("delete() removes an item by id and persists the removal", () => {
    const filePath = tempFile();
    const store = createJsonStore<Widget>(filePath, [{ id: "a", name: "A" }, { id: "b", name: "B" }]);

    store.delete("a");

    expect(store.list()).toEqual([{ id: "b", name: "B" }]);
    const reopened = createJsonStore<Widget>(filePath, []);
    expect(reopened.list()).toEqual([{ id: "b", name: "B" }]);
  });
});
