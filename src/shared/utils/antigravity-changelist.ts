import fs from "fs";
import path from "path";
import { getAntigravityExecutablePath } from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";

export const FALLBACK_CHANGELIST = "1003475615";
export const CHANGELIST_PATTERN = /\bchangelist\s+(\d{7,12})\b/i;
export const DEPOT_FILE_PATTERN = /\/google_src\/files\/(\d{7,12})\/depot\//i;

const DEFAULT_SCAN_TIMEOUT_MS = 5000;
const TAIL_OVERLAP_SIZE = 256;
const CHUNK_SIZE = 256 * 1024;

export interface ChangelistCacheEntry {
  path: string;
  size: number;
  mtimeMs: number;
  changelist: string;
}

let cachedChangelistEntry: ChangelistCacheEntry | null = null;
let cachedChangelist: string = FALLBACK_CHANGELIST;
let pendingChangelistResolution: Promise<string> | null = null;
let fallbackWarned = false;

export function extractChangelist(text: string): string | null {
  const clMatch = text.match(CHANGELIST_PATTERN);
  if (clMatch?.[1]) {
    return clMatch[1];
  }
  const depotMatch = text.match(DEPOT_FILE_PATTERN);
  if (depotMatch?.[1]) {
    return depotMatch[1];
  }
  return null;
}

export function resolveLanguageServerBinaryPath(options?: {
  platform?: NodeJS.Platform;
  customExecutablePath?: string;
}): string | null {
  const currentPlatform = options?.platform ?? process.platform;

  let execPath = options?.customExecutablePath;
  if (!execPath) {
    try {
      execPath = getAntigravityExecutablePath();
    } catch {
      execPath = "";
    }
  }

  if (currentPlatform === "darwin") {
    if (!execPath) {
      const defaultMacBinary =
        "/Applications/Antigravity.app/Contents/Resources/bin/language_server";
      return fs.existsSync(defaultMacBinary) ? defaultMacBinary : null;
    }

    const appIndex = execPath.toLowerCase().indexOf(".app");
    const appPath = appIndex >= 0 ? execPath.slice(0, appIndex + 4) : execPath;
    const candidate = path.join(
      appPath,
      "Contents",
      "Resources",
      "bin",
      "language_server",
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const defaultMacBinary =
      "/Applications/Antigravity.app/Contents/Resources/bin/language_server";
    return fs.existsSync(defaultMacBinary) ? defaultMacBinary : null;
  }

  if (execPath) {
    const binaryName =
      currentPlatform === "win32" ? "language_server.exe" : "language_server";
    const candidate = path.join(
      path.dirname(execPath),
      "resources",
      "bin",
      binaryName,
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function scanChangelistFromStream(
  stream: NodeJS.ReadableStream,
  timeoutMs: number = DEFAULT_SCAN_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let tail = "";
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (typeof (stream as any).destroy === "function") {
        (stream as any).destroy();
      }
      resolve(result);
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(null);
      }, timeoutMs);
    }

    stream.on("data", (chunk: Buffer | string) => {
      if (resolved) return;
      const chunkStr =
        typeof chunk === "string" ? chunk : chunk.toString("latin1");
      const combined = tail + chunkStr;
      const cl = extractChangelist(combined);
      if (cl) {
        finish(cl);
        return;
      }
      tail = combined.slice(-TAIL_OVERLAP_SIZE);
    });

    stream.on("error", () => {
      finish(null);
    });

    stream.on("end", () => {
      finish(null);
    });

    stream.on("close", () => {
      finish(null);
    });
  });
}

export async function scanChangelistFromFile(
  filePath: string,
  timeoutMs: number = DEFAULT_SCAN_TIMEOUT_MS,
): Promise<string | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
  return await scanChangelistFromStream(stream, timeoutMs);
}

export function getCachedChangelist(): string {
  return cachedChangelist;
}

export function getChangelistCacheEntry(): ChangelistCacheEntry | null {
  return cachedChangelistEntry;
}

export function resetChangelistCacheForTesting(): void {
  cachedChangelistEntry = null;
  cachedChangelist = FALLBACK_CHANGELIST;
  pendingChangelistResolution = null;
  fallbackWarned = false;
}

export async function resolveInstalledChangelist(options?: {
  forceScan?: boolean;
  timeoutMs?: number;
  binaryPath?: string;
  platform?: NodeJS.Platform;
}): Promise<string> {
  if (pendingChangelistResolution && !options?.forceScan) {
    return await pendingChangelistResolution;
  }

  const resolutionPromise = (async () => {
    try {
      const targetPath =
        options?.binaryPath ??
        resolveLanguageServerBinaryPath({ platform: options?.platform });
      if (!targetPath || !fs.existsSync(targetPath)) {
        if (!fallbackWarned) {
          fallbackWarned = true;
          logger.warn(
            `language_server binary not found, using fallback changelist ${FALLBACK_CHANGELIST}`,
          );
        }
        return FALLBACK_CHANGELIST;
      }

      const stat = await fs.promises.stat(targetPath);
      if (
        !options?.forceScan &&
        cachedChangelistEntry &&
        cachedChangelistEntry.path === targetPath &&
        cachedChangelistEntry.size === stat.size &&
        cachedChangelistEntry.mtimeMs === stat.mtimeMs
      ) {
        return cachedChangelistEntry.changelist;
      }

      const extracted = await scanChangelistFromFile(
        targetPath,
        options?.timeoutMs,
      );
      if (extracted) {
        cachedChangelistEntry = {
          path: targetPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          changelist: extracted,
        };
        cachedChangelist = extracted;
        return extracted;
      }

      if (!fallbackWarned) {
        fallbackWarned = true;
        logger.warn(
          `Failed to extract changelist from ${targetPath}, using fallback ${FALLBACK_CHANGELIST}`,
        );
      }
      return FALLBACK_CHANGELIST;
    } catch (error) {
      if (!fallbackWarned) {
        fallbackWarned = true;
        logger.warn(
          `Error resolving language_server changelist, using fallback ${FALLBACK_CHANGELIST}`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return FALLBACK_CHANGELIST;
    }
  })();

  pendingChangelistResolution = resolutionPromise;
  try {
    return await resolutionPromise;
  } finally {
    pendingChangelistResolution = null;
  }
}
