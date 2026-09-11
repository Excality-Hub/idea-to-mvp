import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface JsonStore<T extends { id: string }> {
  list(): T[];
  get(id: string): T | undefined;
  create(item: T): void;
  delete(id: string): void;
}

export function createJsonStore<T extends { id: string }>(filePath: string, seed: T[] = []): JsonStore<T> {
  function readAll(): T[] {
    if (!existsSync(filePath)) return seed;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T[];
  }

  function writeAll(items: T[]): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(items, null, 2));
  }

  if (!existsSync(filePath) && seed.length > 0) {
    writeAll(seed);
  }

  return {
    list: () => readAll(),
    get: (id) => readAll().find((item) => item.id === id),
    create: (item) => writeAll([...readAll(), item]),
    delete: (id) => writeAll(readAll().filter((item) => item.id !== id)),
  };
}
