import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 2000;
// Add-Type compiles C# on first use, which takes a second or two.
const WINDOWS_ENV_READ_TIMEOUT_MS = 15000;
const CSRF_ENV_VAR = "ANTIGRAVITY_SERVER_CSRF_TOKEN";
const CSRF_ENV_RE = new RegExp(`(?:^|[\\s\\0])${CSRF_ENV_VAR}=([^\\s\\0]+)`);

const WINDOWS_SYSTEM32 = path.win32.join(
  process.env.SystemRoot && path.win32.isAbsolute(process.env.SystemRoot)
    ? process.env.SystemRoot
    : "C:\\Windows",
  "System32",
);
const WINDOWS_NETSTAT = path.win32.join(WINDOWS_SYSTEM32, "NETSTAT.EXE");
const WINDOWS_POWERSHELL = path.win32.join(
  WINDOWS_SYSTEM32,
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

let cached: { pid: number; token: string } | null = null;

// Antigravity >= 2.34 no longer embeds the LS admin CSRF token in the served
// page (it ships `csrfToken:""`) nor in argv; it hands it to the language
// server through this env var. Read it from the process listening on `port`.
export async function readLanguageServerCsrfFromProcess(
  port: number,
): Promise<string | null> {
  try {
    const pid = await findListeningPid(port);
    if (!pid) return null;
    if (cached?.pid === pid) return cached.token;
    const token = await readEnvToken(pid);
    cached = token ? { pid, token } : null;
    return token;
  } catch {
    return null;
  }
}

async function findListeningPid(port: number): Promise<number | null> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(WINDOWS_NETSTAT, ["-ano", "-p", "TCP"], {
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseWindowsNetstatListener(stdout, port);
  }
  if (process.platform !== "darwin" && process.platform !== "linux") return null;
  const { stdout } = await execFileAsync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    { timeout: EXEC_TIMEOUT_MS },
  );
  const pid = Number(stdout.trim().split("\n")[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// The state column ("LISTENING") is localized, so match on the wildcard
// remote address a listener always shows instead.
export function parseWindowsNetstatListener(
  netstat: string,
  port: number,
): number | null {
  for (const line of netstat.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+(?:0\.0\.0\.0|\[::\]):0\s+\S+\s+(\d+)\s*$/i);
    if (m && Number(m[1]) === port) {
      const pid = Number(m[2]);
      if (pid > 0) return pid;
    }
  }
  return null;
}

async function readEnvToken(pid: number): Promise<string | null> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      WINDOWS_POWERSHELL,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(windowsEnvReadScript(pid)),
      ],
      { timeout: WINDOWS_ENV_READ_TIMEOUT_MS, windowsHide: true },
    );
    const token = stdout.trim();
    return token.length > 0 && !/\s/.test(token) ? token : null;
  }
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
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

// Reads one variable from another (same-user, 64-bit) process's environment
// block via its PEB: PEB+0x20 -> RTL_USER_PROCESS_PARAMETERS, whose
// Environment pointer is at +0x80 and EnvironmentSize at +0x3F0.
export function windowsEnvReadScript(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid pid: ${pid}`);
  }
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AgsEnvReader {
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationProcess(IntPtr h, int cls, IntPtr[] info, int len, out int ret);
  static byte[] Read(IntPtr h, long addr, int size) {
    var buf = new byte[size];
    IntPtr read;
    if (!ReadProcessMemory(h, new IntPtr(addr), buf, new IntPtr(size), out read)) return null;
    return buf;
  }
  public static string Get(int pid, string name) {
    if (IntPtr.Size != 8) return null;
    IntPtr h = OpenProcess(0x0410, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      var pbi = new IntPtr[6];
      int ret;
      if (NtQueryInformationProcess(h, 0, pbi, IntPtr.Size * 6, out ret) != 0) return null;
      var peb = Read(h, pbi[1].ToInt64() + 0x20, 8);
      if (peb == null) return null;
      long pp = BitConverter.ToInt64(peb, 0);
      var envPtr = Read(h, pp + 0x80, 8);
      var envSize = Read(h, pp + 0x3F0, 8);
      if (envPtr == null || envSize == null) return null;
      long size = BitConverter.ToInt64(envSize, 0);
      if (size <= 0 || size > 4 * 1024 * 1024) size = 256 * 1024;
      var block = Read(h, BitConverter.ToInt64(envPtr, 0), (int)size);
      if (block == null) return null;
      string prefix = name + "=";
      foreach (var entry in Encoding.Unicode.GetString(block).Split('\\0')) {
        if (entry.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return entry.Substring(prefix.Length);
      }
      return null;
    } finally { CloseHandle(h); }
  }
}
'@
$t = [AgsEnvReader]::Get(${pid}, '${CSRF_ENV_VAR}')
if ($t) { [Console]::Out.Write($t) }
`;
}
