import fs from "node:fs";
import path from "node:path";
import type { CanonicalAntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  getBackupsDir,
  type PathResolutionOptions,
} from "@/shared/platform/paths";

export const getTargetDir = (
  target: CanonicalAntigravityAppTarget,
  opt?: PathResolutionOptions,
) => path.join(getBackupsDir(opt), target);

export const copyIfExists = (s: string, d: string) => {
  if (fs.existsSync(s)) {
    fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(s, path.join(d, path.basename(s)));
  }
};

export function getDirSize(p: string): number {
  if (!fs.existsSync(p)) return 0;
  try {
    return fs.readdirSync(p, { withFileTypes: true }).reduce((acc, e) => {
      const full = path.join(p, e.name);
      return (
        acc +
        (e.isDirectory()
          ? getDirSize(full)
          : e.isFile()
            ? fs.statSync(full).size
            : 0)
      );
    }, 0);
  } catch {
    return 0;
  }
}
