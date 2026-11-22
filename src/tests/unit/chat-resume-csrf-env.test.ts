import { beforeEach, describe, expect, it, vi } from "vitest";

const readEnvToken = vi.fn<(port: number) => Promise<string | null>>();
vi.mock("@/shared/platform/languageServerCsrf", () => ({
  readLanguageServerCsrfFromProcess: (port: number) => readEnvToken(port),
}));

import {
  ChatResumeDispatcher,
  type HttpRequester,
} from "@/modules/chat-resume/ChatResumeDispatcher";
import { SessionContinuityBuffer } from "@/modules/chat-resume/SessionContinuityBuffer";

const PAGE_2_34 = `<script>window.__APP_CONFIG__ = {"productName":"antigravity","csrfToken":"","appVersion":"2.34.0"};</script>`;

describe("ChatResumeDispatcher handshake against Antigravity 2.34", () => {
  let requester: ReturnType<typeof vi.fn>;
  let dispatcher: ChatResumeDispatcher;

  beforeEach(() => {
    readEnvToken.mockReset();
    requester = vi.fn(async (url: string, opts: { headers?: Record<string, string> }) => {
      if (url.endsWith("/")) return { status: 200, headers: { "content-type": "text/html" }, data: PAGE_2_34 };
      const ok = opts.headers?.["x-codeium-csrf-token"] === "env-admin-token";
      return ok
        ? { status: 200, headers: { "content-type": "application/json" }, data: "{}" }
        : { status: 401, headers: { "content-type": "application/json" }, data: "missing CSRF token" };
    });
    dispatcher = new ChatResumeDispatcher({
      buffer: new SessionContinuityBuffer(),
      httpRequester: requester as unknown as HttpRequester,
      handshakeTimeoutMs: 500,
      initialBackoffMs: 10,
      maxBackoffMs: 20,
    });
  });

  it("falls back to the token in the LS process env when the page has none", async () => {
    readEnvToken.mockResolvedValue("env-admin-token");
    const result = await dispatcher.performReadinessHandshake(62165);
    expect(result).toEqual({ ready: true, csrfToken: "env-admin-token" });
    expect(readEnvToken).toHaveBeenCalledWith(62165);
  });

  it("still times out cleanly when the env token is unavailable", async () => {
    readEnvToken.mockResolvedValue(null);
    const result = await dispatcher.performReadinessHandshake(62165);
    expect(result.ready).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it("prefers a token embedded in the page (pre-2.34) without touching the process", async () => {
    requester.mockImplementationOnce(async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      data: `<script>window.__APP_CONFIG__ = {csrfToken: "env-admin-token"};</script>`,
    }));
    const result = await dispatcher.performReadinessHandshake(62165);
    expect(result.ready).toBe(true);
    expect(readEnvToken).not.toHaveBeenCalled();
  });
});
