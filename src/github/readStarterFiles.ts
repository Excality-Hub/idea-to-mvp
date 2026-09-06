import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface StarterFile {
  path: string;
  content: string;
}

export function readStarterFiles(starterDir: string): StarterFile[] {
  const files: StarterFile[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
      } else {
        files.push({
          path: relative(starterDir, fullPath).split("\\").join("/"),
          content: readFileSync(fullPath, "utf-8"),
        });
      }
    }
  }

  walk(starterDir);
  return files;
}
