import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 2000;
const CSRF_ENV_RE = /(?:^|[\s\0])ANTIGRAVITY_SERVER_CSRF_TOKEN=([^\s\0]+)/;

// Antigravity >= 2.34 no longer embeds the LS admin CSRF token in the served
// page (it ships `csrfToken:""`) nor in argv; it hands it to the language
// server through this env var. Read it from the process listening on `port`.
export async function readLanguageServerCsrfFromProcess(
  port: number,
): Promise<string | null> {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return null;
  }
  try {
    const { stdout: pids } = await execFileAsync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { timeout: EXEC_TIMEOUT_MS },
    );
    const pid = Number(pids.trim().split("\n")[0]);
    if (!Number.isInteger(pid) || pid <= 0) return null;

    const env =
      process.platform === "linux"
        ? await fs.readFile(`/proc/${pid}/environ`, "utf8")
        : (
            await execFileAsync("ps", ["eww", "-o", "command=", "-p", String(pid)], {
              timeout: EXEC_TIMEOUT_MS,
              maxBuffer: 4 * 1024 * 1024,
            })
          ).stdout;
    return env.match(CSRF_ENV_RE)?.[1] ?? null;
  } catch {
    return null;
  }
}
