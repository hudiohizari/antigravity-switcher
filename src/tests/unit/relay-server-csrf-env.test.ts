import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/shared/platform/languageServerCsrf", () => ({
  readLanguageServerCsrfFromProcess: vi.fn(async () => "env-admin-token"),
}));

import { RelayServer } from "@/modules/relay/relay-server";
import { PortDiscoveryService } from "@/modules/relay/port-discovery";
import { MockUpstreamServer } from "../helpers/mock-upstream";

// Antigravity >= 2.34: the page carries an empty token and the LS only
// accepts the one it got through ANTIGRAVITY_SERVER_CSRF_TOKEN.
const PAGE_2_34 =
  '<!doctype html><html><head><script>window.__APP_CONFIG__ = {"productName":"antigravity","csrfToken":"","appVersion":"2.34.0"};</script></head><body></body></html>';

describe("RelayServer with an Antigravity 2.34 upstream", () => {
  let upstream: MockUpstreamServer;
  let relay: RelayServer;
  let relayPort: number;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-csrf-env-"));
    upstream = new MockUpstreamServer({ csrfToken: "env-admin-token", validateCsrf: true });
    upstream.setCustomHtml(PAGE_2_34);
    const upstreamPort = await upstream.start();
    const logPath = path.join(tempDir, "main.log");
    fs.writeFileSync(logPath, `[LOG] listening on https://127.0.0.1:${upstreamPort}/\n`);
    const portDiscovery = new PortDiscoveryService({ logPath, pollIntervalMs: 50, debounceMs: 10 });
    relay = new RelayServer({
      config: { port: 0, host: "127.0.0.1", requirePairing: false },
      portDiscovery,
    });
    relayPort = (await relay.start()).port;
  });

  afterEach(async () => {
    await relay.stop();
    relay.dispose();
    await upstream.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("learns the token from the LS process and hands it to the relay page", async () => {
    await expect(relay.refreshCsrfToken()).resolves.toBe("env-admin-token");

    const html = await (await fetch(`http://127.0.0.1:${relayPort}/`)).text();
    expect(html).toContain('"csrfToken":"env-admin-token"');
  });

  it("forwards client RPCs with the env token the LS accepts", async () => {
    await relay.refreshCsrfToken();
    const res = await fetch(
      `http://127.0.0.1:${relayPort}/exa.language_server_pb.LanguageServerService/GetAuthStatus`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-codeium-csrf-token": "" },
        body: "{}",
      },
    );
    expect(res.status).not.toBe(401);
    const forwarded = upstream.recordedRequests.at(-1);
    expect(forwarded?.headers["x-codeium-csrf-token"]).toBe("env-admin-token");
  });
});
