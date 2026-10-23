import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildUserAgent,
  FALLBACK_VERSION,
  getPlatformTag,
  getArchTag,
} from "@/shared/utils/request-user-agent";
import {
  buildInternalApiHeaders,
  GoogleAPIService,
} from "@/modules/cloud-account/services/GoogleAPIService";
import { mockAxiosRequests } from "../helpers/mock-axios-request";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Request User-Agent construction", () => {
  it("formats official client User-Agent matching language server specification", () => {
    const userAgent = buildUserAgent("2.25.0", "darwin", "arm64");
    expect(userAgent).toBe(
      "antigravity/hub/2.25.0 (aidev_client; os_type=darwin; arch=arm64; cl=1003475615; auth_method=oauth)",
    );
  });

  it("formats Windows platform and amd64 architecture correctly", () => {
    const userAgent = buildUserAgent("2.25.0", "windows", "amd64");
    expect(userAgent).toBe(
      "antigravity/hub/2.25.0 (aidev_client; os_type=windows; arch=amd64; cl=1003475615; auth_method=oauth)",
    );
  });

  it("formats Linux platform correctly", () => {
    const userAgent = buildUserAgent("2.25.0", "linux", "amd64");
    expect(userAgent).toBe(
      "antigravity/hub/2.25.0 (aidev_client; os_type=linux; arch=amd64; cl=1003475615; auth_method=oauth)",
    );
  });

  it("uses default platform and arch when omitted", () => {
    const userAgent = buildUserAgent("2.25.0");
    const expectedPlatform = getPlatformTag();
    const expectedArch = getArchTag();
    expect(userAgent).toBe(
      `antigravity/hub/2.25.0 (aidev_client; os_type=${expectedPlatform}; arch=${expectedArch}; cl=1003475615; auth_method=oauth)`,
    );
  });

  it("verifies FALLBACK_VERSION is 2.25.0", () => {
    expect(FALLBACK_VERSION).toBe("2.25.0");
  });
});

describe("Google internal API headers", () => {
  it("constructs headers without project header when project ID is omitted", () => {
    const headers = buildInternalApiHeaders("token-123");
    expect(headers.Authorization).toBe("Bearer token-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toContain("antigravity/hub/");
    expect(headers["User-Agent"]).toContain("aidev_client");
    expect(headers["X-Goog-User-Project"]).toBeUndefined();
  });

  it("constructs headers with X-Goog-User-Project when project ID is provided", () => {
    const headers = buildInternalApiHeaders("token-123", "gcp-project-xyz");
    expect(headers.Authorization).toBe("Bearer token-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Goog-User-Project"]).toBe("gcp-project-xyz");
  });

  it("omits X-Goog-User-Project when project ID is empty or whitespace", () => {
    const emptyHeaders = buildInternalApiHeaders("token-123", "");
    expect(emptyHeaders["X-Goog-User-Project"]).toBeUndefined();

    const whitespaceHeaders = buildInternalApiHeaders("token-123", "   ");
    expect(whitespaceHeaders["X-Goog-User-Project"]).toBeUndefined();
  });
});

describe("GoogleAPIService endpoint and header dispatching", () => {
  it("includes X-Goog-User-Project on quota request when project context is available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          models: {
            "gemini-4-argon": {
              displayName: "Gemini 4 Argon",
              quotaInfo: {
                remainingFraction: 1,
                resetTime: "2026-05-05T00:00:00Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ groups: [] }),
      });

    mockAxiosRequests(fetchMock);

    const { ConfigManager } = await import("@/modules/config/ipc/manager");
    vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({
      proxy: { upstream_proxy: { enabled: false } },
    } as any);

    vi.spyOn(GoogleAPIService, "fetchProjectContext").mockResolvedValue({
      projectId: "project-alpha",
      subscriptionTier: "standard",
    });

    const result = await GoogleAPIService.fetchQuota("auth-token-1");
    expect(result.models["gemini-4-argon"]).toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const quotaCallHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(quotaCallHeaders?.["X-Goog-User-Project"]).toBe("project-alpha");
    expect(quotaCallHeaders?.["User-Agent"]).toContain("antigravity/hub/");

    const summaryCallHeaders = fetchMock.mock.calls[1]?.[1]?.headers;
    expect(summaryCallHeaders?.["X-Goog-User-Project"]).toBe("project-alpha");
  });

  it("retries fetchQuota without project ID and header on 403 forbidden", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          models: {
            "gemini-4-argon-high": {
              displayName: "Gemini 4 Argon (High)",
              quotaInfo: {
                remainingFraction: 0.8,
                resetTime: "2026-05-05T00:00:00Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ groups: [] }),
      });

    mockAxiosRequests(fetchMock);

    const { ConfigManager } = await import("@/modules/config/ipc/manager");
    vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({
      proxy: { upstream_proxy: { enabled: false } },
    } as any);

    vi.spyOn(GoogleAPIService, "fetchProjectContext").mockResolvedValue({
      projectId: "project-restricted",
      subscriptionTier: "free",
    });

    const result = await GoogleAPIService.fetchQuota("auth-token-2");
    expect(result.models["gemini-4-argon-high"]).toBeDefined();
    expect(result.models["gemini-4-argon-high"].percentage).toBe(80);

    // Call 0 had project ID and header
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.["X-Goog-User-Project"]).toBe(
      "project-restricted",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ project: "project-restricted" }),
    );

    // Call 1 (retry) had no project ID and no X-Goog-User-Project header
    expect(
      fetchMock.mock.calls[1]?.[1]?.headers?.["X-Goog-User-Project"],
    ).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({}));
  });

  it("prioritizes daily loadCodeAssist endpoint in fetchProjectContext", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        cloudaicompanionProject: "daily-project-123",
      }),
    });

    mockAxiosRequests(fetchMock);

    const { ConfigManager } = await import("@/modules/config/ipc/manager");
    vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({
      proxy: { upstream_proxy: { enabled: false } },
    } as any);

    const context = await GoogleAPIService.fetchProjectContext("auth-token-3");
    expect(context.projectId).toBe("daily-project-123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    );
  });
});
