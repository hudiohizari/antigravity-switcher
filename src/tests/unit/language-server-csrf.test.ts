import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
const readFileMock = vi.fn();
vi.mock("node:child_process", () => {
  const execFile = (...args: unknown[]) => execFileMock(...args);
  return { execFile, default: { execFile } };
});
vi.mock("node:fs/promises", () => {
  const readFile = (...args: unknown[]) => readFileMock(...args);
  return { readFile, default: { readFile } };
});

import { readLanguageServerCsrfFromProcess } from "@/shared/platform/languageServerCsrf";

type Call = { cmd: string; args: string[] };
let calls: Call[] = [];

function reply(handler: (cmd: string, args: string[]) => string | Error) {
  execFileMock.mockImplementation((cmd: string, ...rest: unknown[]) => {
    const cb = rest.at(-1) as (e: Error | null, r?: { stdout: string }) => void;
    if (typeof cb !== "function") return;
    const args = rest[0] as string[];
    calls.push({ cmd, args });
    const out = handler(cmd.toLowerCase(), args);
    if (out instanceof Error) cb(out);
    else cb(null, { stdout: out });
  });
}

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

let nextPid = 1000;

beforeEach(() => {
  execFileMock.mockReset();
  readFileMock.mockReset();
  calls = [];
});
afterEach(() => setPlatform(realPlatform));

describe("readLanguageServerCsrfFromProcess", () => {
  it("macOS: reads the token from the env of the process listening on the port", async () => {
    setPlatform("darwin");
    const pid = nextPid++;
    reply((cmd) =>
      cmd === "lsof"
        ? `${pid}\n`
        : `/bin/language_server --standalone HOME=/u ANTIGRAVITY_SERVER_CSRF_TOKEN=mac-tok PATH=/bin\n`,
    );
    await expect(readLanguageServerCsrfFromProcess(62165)).resolves.toBe("mac-tok");
    expect(calls[0]).toEqual({
      cmd: "lsof",
      args: ["-nP", "-iTCP:62165", "-sTCP:LISTEN", "-t"],
    });
    expect(calls[1].args).toContain(String(pid));
  });

  it("Linux: reads /proc/<pid>/environ", async () => {
    setPlatform("linux");
    const pid = nextPid++;
    reply(() => `${pid}\n`);
    readFileMock.mockResolvedValue("HOME=/u\0ANTIGRAVITY_SERVER_CSRF_TOKEN=linux-tok\0PATH=/bin\0");
    await expect(readLanguageServerCsrfFromProcess(5)).resolves.toBe("linux-tok");
    expect(readFileMock).toHaveBeenCalledWith(`/proc/${pid}/environ`, "utf8");
  });

  it("returns null when nothing listens, the var is absent, or a command fails", async () => {
    setPlatform("darwin");
    reply(() => "");
    await expect(readLanguageServerCsrfFromProcess(1)).resolves.toBeNull();

    const pid = nextPid++;
    reply((cmd) => (cmd === "lsof" ? `${pid}\n` : "/bin/x HOME=/u\n"));
    await expect(readLanguageServerCsrfFromProcess(1)).resolves.toBeNull();

    reply(() => new Error("lsof missing"));
    await expect(readLanguageServerCsrfFromProcess(1)).resolves.toBeNull();
  });

  it("returns null on unsupported platforms without running anything", async () => {
    setPlatform("freebsd");
    reply(() => new Error("should not run"));
    await expect(readLanguageServerCsrfFromProcess(1)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
