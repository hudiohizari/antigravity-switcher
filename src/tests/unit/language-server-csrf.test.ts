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

import {
  parseWindowsNetstatListener,
  readLanguageServerCsrfFromProcess,
  windowsEnvReadScript,
} from "@/shared/platform/languageServerCsrf";
import { withRelayCsrfToken } from "@/modules/relay/relay-server";

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

// Distinct pids per test: the module caches the token for the last pid it read.
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

  it("caches per pid, so a repeat lookup skips the env read", async () => {
    setPlatform("darwin");
    const pid = nextPid++;
    reply((cmd) => (cmd === "lsof" ? `${pid}\n` : "x ANTIGRAVITY_SERVER_CSRF_TOKEN=cached\n"));
    await readLanguageServerCsrfFromProcess(1);
    await expect(readLanguageServerCsrfFromProcess(1)).resolves.toBe("cached");
    expect(calls.filter((c) => c.cmd === "ps")).toHaveLength(1);
  });

  it("Linux: reads /proc/<pid>/environ", async () => {
    setPlatform("linux");
    const pid = nextPid++;
    reply(() => `${pid}\n`);
    readFileMock.mockResolvedValue("HOME=/u\0ANTIGRAVITY_SERVER_CSRF_TOKEN=linux-tok\0PATH=/bin\0");
    await expect(readLanguageServerCsrfFromProcess(5)).resolves.toBe("linux-tok");
    expect(readFileMock).toHaveBeenCalledWith(`/proc/${pid}/environ`, "utf8");
  });

  it("Windows: finds the pid with netstat and reads the env through PowerShell", async () => {
    setPlatform("win32");
    const pid = nextPid++;
    reply((cmd) => {
      if (cmd.endsWith("netstat.exe")) {
        return [
          "Active Connections",
          "  Proto  Local Address          Foreign Address        State           PID",
          `  TCP    127.0.0.1:59607        0.0.0.0:0              LISTENING       ${pid}`,
          `  TCP    127.0.0.1:59607        127.0.0.1:61000        ESTABLISHED     ${pid}`,
        ].join("\r\n");
      }
      if (cmd.endsWith("powershell.exe")) return "win-tok\r\n";
      return new Error(`unexpected ${cmd}`);
    });
    await expect(readLanguageServerCsrfFromProcess(59607)).resolves.toBe("win-tok");

    const ps = calls.find((c) => c.cmd.toLowerCase().endsWith("powershell.exe"))!;
    const encoded = ps.args[ps.args.indexOf("-EncodedCommand") + 1];
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    expect(script).toContain(`[AgsEnvReader]::Get(${pid}, 'ANTIGRAVITY_SERVER_CSRF_TOKEN')`);
  });

  it("Windows: returns null when PowerShell prints nothing", async () => {
    setPlatform("win32");
    const pid = nextPid++;
    reply((cmd) =>
      cmd.endsWith("netstat.exe")
        ? `  TCP    127.0.0.1:7000   0.0.0.0:0   LISTENING   ${pid}`
        : "",
    );
    await expect(readLanguageServerCsrfFromProcess(7000)).resolves.toBeNull();
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

describe("parseWindowsNetstatListener", () => {
  it("matches listeners regardless of the localized state column", () => {
    const out = [
      "  TCP    0.0.0.0:135            0.0.0.0:0              ABHÖREN         900",
      "  TCP    127.0.0.1:59607        0.0.0.0:0              ABHÖREN         4321",
      "  TCP    [::]:59608             [::]:0                 LISTENING       4321",
    ].join("\r\n");
    expect(parseWindowsNetstatListener(out, 59607)).toBe(4321);
    expect(parseWindowsNetstatListener(out, 59608)).toBe(4321);
  });

  it("ignores established connections and other ports", () => {
    const out = [
      "  TCP    127.0.0.1:59607        127.0.0.1:61000        ESTABLISHED     11",
      "  TCP    127.0.0.1:5960         0.0.0.0:0              LISTENING       12",
    ].join("\n");
    expect(parseWindowsNetstatListener(out, 59607)).toBeNull();
  });
});

describe("windowsEnvReadScript", () => {
  it("rejects a non-numeric pid so nothing can be injected into the script", () => {
    expect(() => windowsEnvReadScript(Number.NaN)).toThrow();
    expect(() => windowsEnvReadScript(-1)).toThrow();
  });
});

describe("withRelayCsrfToken", () => {
  it("fills the empty csrfToken Antigravity 2.34 serves", () => {
    const html = `<script>window.__APP_CONFIG__ = {"productName":"antigravity","csrfToken":"","appVersion":"2.34.0"};</script>`;
    expect(withRelayCsrfToken(html, "abc-123")).toContain(`"csrfToken":"abc-123"`);
  });

  it("leaves a page that already has a token untouched", () => {
    const html = `{"csrfToken":"real"}`;
    expect(withRelayCsrfToken(html, "other")).toBe(html);
  });
});
