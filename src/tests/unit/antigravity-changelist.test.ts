import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";
import fs from "fs";
import os from "os";
import path from "path";
import {
  extractChangelist,
  resolveLanguageServerBinaryPath,
  scanChangelistFromStream,
  scanChangelistFromFile,
  resolveInstalledChangelist,
  getCachedChangelist,
  getChangelistCacheEntry,
  resetChangelistCacheForTesting,
  FALLBACK_CHANGELIST,
} from "@/shared/utils/antigravity-changelist";
import { buildUserAgent } from "@/shared/utils/request-user-agent";
import * as pathsModule from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";

describe("antigravity-changelist", () => {
  let tempDir: string;

  beforeEach(() => {
    resetChangelistCacheForTesting();
    vi.restoreAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cl-test-"));
  });

  afterEach(() => {
    resetChangelistCacheForTesting();
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("extractChangelist", () => {
    it("extracts changelist from primary changelist with baseline pattern", () => {
      const text =
        "changelist 1003475615 with baseline 999750319 in a mint client based on //depot";
      expect(extractChangelist(text)).toBe("1003475615");
    });

    it("extracts changelist from secondary google_src depot pattern", () => {
      const text =
        "googlefile:/google_src/files/1003475615/depot/branches/antigravity_web_release_branch/999750319.1/google3";
      expect(extractChangelist(text)).toBe("1003475615");
    });

    it("prefers changelist pattern over depot pattern when both exist", () => {
      const text =
        "/google_src/files/999999999/depot/ ... changelist 1003475615 with baseline";
      expect(extractChangelist(text)).toBe("1003475615");
    });

    it("returns null when no pattern matches", () => {
      expect(
        extractChangelist("arbitrary binary payload with no metadata"),
      ).toBeNull();
      expect(extractChangelist("")).toBeNull();
    });
  });

  describe("resolveLanguageServerBinaryPath", () => {
    it("resolves darwin binary using custom executable path with .app slicing", () => {
      const fakeApp = path.join(tempDir, "Antigravity.app");
      const fakeBinDir = path.join(fakeApp, "Contents", "Resources", "bin");
      fs.mkdirSync(fakeBinDir, { recursive: true });
      const fakeBinary = path.join(fakeBinDir, "language_server");
      fs.writeFileSync(fakeBinary, "binary");

      const resolved = resolveLanguageServerBinaryPath({
        platform: "darwin",
        customExecutablePath: path.join(
          fakeApp,
          "Contents",
          "MacOS",
          "Antigravity",
        ),
      });

      expect(resolved).toBe(fakeBinary);
    });

    it("resolves darwin binary using custom executable path without .app extension", () => {
      const fakeDir = path.join(tempDir, "CustomDir");
      const fakeBinDir = path.join(fakeDir, "Contents", "Resources", "bin");
      fs.mkdirSync(fakeBinDir, { recursive: true });
      const fakeBinary = path.join(fakeBinDir, "language_server");
      fs.writeFileSync(fakeBinary, "binary");

      const resolved = resolveLanguageServerBinaryPath({
        platform: "darwin",
        customExecutablePath: fakeDir,
      });

      expect(resolved).toBe(fakeBinary);
    });

    it("falls back to default mac application path when executable path is empty", () => {
      vi.spyOn(pathsModule, "getAntigravityExecutablePath").mockReturnValue("");
      const defaultPath =
        "/Applications/Antigravity.app/Contents/Resources/bin/language_server";
      const exists = fs.existsSync(defaultPath);

      const resolved = resolveLanguageServerBinaryPath({
        platform: "darwin",
        customExecutablePath: "",
      });

      expect(resolved).toBe(exists ? defaultPath : null);
    });

    it("returns null when default mac application path is missing and executable path is empty", () => {
      vi.spyOn(pathsModule, "getAntigravityExecutablePath").mockReturnValue("");
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const resolved = resolveLanguageServerBinaryPath({
        platform: "darwin",
        customExecutablePath: "",
      });

      expect(resolved).toBeNull();
    });

    it("falls back to default mac application path when candidate does not exist but default does", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => {
        return (
          p ===
          "/Applications/Antigravity.app/Contents/Resources/bin/language_server"
        );
      });

      const resolved = resolveLanguageServerBinaryPath({
        platform: "darwin",
        customExecutablePath:
          "/NonExistent/Antigravity.app/Contents/MacOS/Antigravity",
      });

      expect(resolved).toBe(
        "/Applications/Antigravity.app/Contents/Resources/bin/language_server",
      );
    });

    it("returns null on darwin when candidate file does not exist and default is missing", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const resolved = resolveLanguageServerBinaryPath({
        platform: "darwin",
        customExecutablePath:
          "/NonExistent/Antigravity.app/Contents/MacOS/Antigravity",
      });

      expect(resolved).toBeNull();
    });

    it("resolves win32 binary path with language_server.exe candidate", () => {
      const fakeAppDir = path.join(tempDir, "Antigravity");
      const fakeBinDir = path.join(fakeAppDir, "resources", "bin");
      fs.mkdirSync(fakeBinDir, { recursive: true });
      const fakeExe = path.join(fakeBinDir, "language_server.exe");
      fs.writeFileSync(fakeExe, "binary");

      const resolved = resolveLanguageServerBinaryPath({
        platform: "win32",
        customExecutablePath: path.join(fakeAppDir, "Antigravity.exe"),
      });

      expect(resolved).toBe(fakeExe);
    });

    it("resolves linux binary path with language_server candidate", () => {
      const fakeAppDir = path.join(tempDir, "Antigravity");
      const fakeBinDir = path.join(fakeAppDir, "resources", "bin");
      fs.mkdirSync(fakeBinDir, { recursive: true });
      const fakeBin = path.join(fakeBinDir, "language_server");
      fs.writeFileSync(fakeBin, "binary");

      const resolved = resolveLanguageServerBinaryPath({
        platform: "linux",
        customExecutablePath: path.join(fakeAppDir, "Antigravity"),
      });

      expect(resolved).toBe(fakeBin);
    });

    it("returns null on win32/linux when candidate does not exist", () => {
      const resolved = resolveLanguageServerBinaryPath({
        platform: "linux",
        customExecutablePath: "/opt/antigravity/antigravity",
      });

      expect(resolved).toBeNull();
    });

    it("returns null on non-darwin when executable path is not resolved", () => {
      vi.spyOn(pathsModule, "getAntigravityExecutablePath").mockReturnValue("");

      const resolved = resolveLanguageServerBinaryPath({
        platform: "linux",
      });

      expect(resolved).toBeNull();
    });

    it("catches errors from getAntigravityExecutablePath and continues", () => {
      vi.spyOn(pathsModule, "getAntigravityExecutablePath").mockImplementation(
        () => {
          throw new Error("Detection failure");
        },
      );

      const resolved = resolveLanguageServerBinaryPath({
        platform: "linux",
      });

      expect(resolved).toBeNull();
    });
  });

  describe("scanChangelistFromStream", () => {
    it("extracts changelist within a single chunk", async () => {
      const stream = Readable.from([
        "hello changelist 1003475615 with baseline world",
      ]);
      const result = await scanChangelistFromStream(stream, 1000);
      expect(result).toBe("1003475615");
    });

    it("extracts changelist spanning across chunk boundaries", async () => {
      const chunk1 = Buffer.from("prefix data changelist ");
      const chunk2 = Buffer.from("1003475615 with baseline suffix");
      const stream = Readable.from([chunk1, chunk2]);

      const result = await scanChangelistFromStream(stream, 1000);
      expect(result).toBe("1003475615");
    });

    it("ignores subsequent chunks after match resolution", async () => {
      const stream = Readable.from([
        Buffer.from("changelist 1003475615 with baseline"),
        Buffer.from("changelist 1009999999 with baseline"),
      ]);
      const result = await scanChangelistFromStream(stream, 1000);
      expect(result).toBe("1003475615");
    });

    it("returns null when stream ends without match", async () => {
      const stream = Readable.from(["random text without changelist data"]);
      const result = await scanChangelistFromStream(stream, 1000);
      expect(result).toBeNull();
    });

    it("handles stream error gracefully and returns null", async () => {
      const stream = new Readable({
        read() {
          this.destroy(new Error("Stream read error"));
        },
      });

      const result = await scanChangelistFromStream(stream, 1000);
      expect(result).toBeNull();
    });

    it("returns null when stream scan times out", async () => {
      const stream = new Readable({
        read() {
          // Intentionally do not push to simulate hung stream
        },
      });

      const result = await scanChangelistFromStream(stream, 20);
      expect(result).toBeNull();
    });
  });

  describe("scanChangelistFromFile", () => {
    it("returns null when file does not exist", async () => {
      const result = await scanChangelistFromFile("/path/does/not/exist");
      expect(result).toBeNull();
    });

    it("scans and extracts changelist from real file", async () => {
      const filePath = path.join(tempDir, "test_binary");
      fs.writeFileSync(
        filePath,
        Buffer.concat([
          Buffer.alloc(1024, 0),
          Buffer.from("changelist 1003475615 with baseline 999750319"),
          Buffer.alloc(1024, 0),
        ]),
      );

      const result = await scanChangelistFromFile(filePath, 2000);
      expect(result).toBe("1003475615");
    });
  });

  describe("resolveInstalledChangelist and caching lifecycle", () => {
    it("falls back to FALLBACK_CHANGELIST and warns once when binary not found", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      const result1 = await resolveInstalledChangelist({
        binaryPath: "/missing/binary/path",
      });
      expect(result1).toBe(FALLBACK_CHANGELIST);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const result2 = await resolveInstalledChangelist({
        binaryPath: "/missing/binary/path",
      });
      expect(result2).toBe(FALLBACK_CHANGELIST);
      // Still only 1 warning (warn once requirement)
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("scans file, populates cache, and returns extracted changelist", async () => {
      const filePath = path.join(tempDir, "language_server");
      fs.writeFileSync(
        filePath,
        "dummy /google_src/files/1003475615/depot/branches/ content",
      );

      expect(getCachedChangelist()).toBe(FALLBACK_CHANGELIST);

      const cl = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl).toBe("1003475615");
      expect(getCachedChangelist()).toBe("1003475615");

      const cacheEntry = getChangelistCacheEntry();
      expect(cacheEntry).not.toBeNull();
      expect(cacheEntry?.changelist).toBe("1003475615");
      expect(cacheEntry?.path).toBe(filePath);

      // Cache hit on subsequent call
      const cl2 = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl2).toBe("1003475615");
    });

    it("detects mtime change and invalidates cache with re-scan", async () => {
      const filePath = path.join(tempDir, "language_server");
      fs.writeFileSync(filePath, "dummy changelist 1003475615 with baseline");

      const cl1 = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl1).toBe("1003475615");

      // Update file content with new CL and modified time
      const newMtime = new Date(Date.now() + 5000);
      fs.writeFileSync(filePath, "dummy changelist 1009999999 with baseline");
      fs.utimesSync(filePath, newMtime, newMtime);

      const cl2 = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl2).toBe("1009999999");
      expect(getCachedChangelist()).toBe("1009999999");
    });

    it("falls back when file content yields no changelist", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const filePath = path.join(tempDir, "unparseable_binary");
      fs.writeFileSync(filePath, "no recognizable tokens here");

      const cl = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl).toBe(FALLBACK_CHANGELIST);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("handles unexpected filesystem exceptions gracefully", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const filePath = path.join(tempDir, "error_binary");
      fs.writeFileSync(filePath, "content");
      vi.spyOn(fs.promises, "stat").mockRejectedValue(
        new Error("Permission denied"),
      );

      const cl = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl).toBe(FALLBACK_CHANGELIST);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent resolutions with single-flight promise", async () => {
      const filePath = path.join(tempDir, "language_server");
      fs.writeFileSync(filePath, "dummy changelist 1003475615 with baseline");

      const [res1, res2, res3] = await Promise.all([
        resolveInstalledChangelist({ binaryPath: filePath }),
        resolveInstalledChangelist({ binaryPath: filePath }),
        resolveInstalledChangelist({ binaryPath: filePath }),
      ]);

      expect(res1).toBe("1003475615");
      expect(res2).toBe("1003475615");
      expect(res3).toBe("1003475615");
    });

    it("resolves changelist automatically discovering binary path when omitted", async () => {
      const cl = await resolveInstalledChangelist();
      expect(cl).toBe("1003475615");
    });

    it("detects size change and invalidates cache with re-scan", async () => {
      const filePath = path.join(tempDir, "language_server");
      fs.writeFileSync(filePath, "dummy changelist 1003475615 with baseline");

      const cl1 = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl1).toBe("1003475615");

      const stat1 = fs.statSync(filePath);
      fs.writeFileSync(
        filePath,
        "dummy changelist 1007777777 with baseline and extra content bytes to increase size",
      );
      fs.utimesSync(filePath, stat1.atime, stat1.mtime);

      const cl2 = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl2).toBe("1007777777");
    });

    it("handles string rejection in resolveInstalledChangelist catch", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const filePath = path.join(tempDir, "error_binary_str");
      fs.writeFileSync(filePath, "content");
      vi.spyOn(fs.promises, "stat").mockRejectedValue("non-error exception");

      const cl = await resolveInstalledChangelist({ binaryPath: filePath });
      expect(cl).toBe(FALLBACK_CHANGELIST);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("resolves changelist with platform override without binaryPath", async () => {
      const cl = await resolveInstalledChangelist({ platform: "win32" });
      expect(cl).toBe(FALLBACK_CHANGELIST);
    });

    it("bypasses cache when forceScan option is true", async () => {
      const filePath = path.join(tempDir, "language_server");
      fs.writeFileSync(filePath, "dummy changelist 1003475615 with baseline");

      await resolveInstalledChangelist({ binaryPath: filePath });
      expect(getChangelistCacheEntry()?.changelist).toBe("1003475615");

      // Replace file in-place with new CL
      fs.writeFileSync(filePath, "dummy changelist 1008888888 with baseline");

      const forced = await resolveInstalledChangelist({
        binaryPath: filePath,
        forceScan: true,
      });
      expect(forced).toBe("1008888888");
      expect(getCachedChangelist()).toBe("1008888888");
    });
  });

  describe("User-Agent integration", () => {
    it("formats User-Agent with cached changelist by default", () => {
      const ua = buildUserAgent("2.25.0", "darwin", "arm64");
      expect(ua).toBe(
        "antigravity/hub/2.25.0 (aidev_client; os_type=darwin; arch=arm64; cl=1003475615; auth_method=oauth)",
      );
    });

    it("formats User-Agent with dynamic custom changelist when provided", () => {
      const ua = buildUserAgent("2.25.0", "darwin", "arm64", "1009999999");
      expect(ua).toBe(
        "antigravity/hub/2.25.0 (aidev_client; os_type=darwin; arch=arm64; cl=1009999999; auth_method=oauth)",
      );
    });
  });
});
