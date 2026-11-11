import { describe, expect, it } from "vitest";

import {
  applyImageQuotaMarks,
  mergeImageQuotaMark,
  parseImageQuotaExhaustion,
} from "@/modules/cloud-account/utils/image-quota-exhaustion";
import type { CloudQuotaData } from "@/modules/cloud-account/types";

function googleBody(
  overrides: {
    code?: number;
    status?: string;
    reason?: string;
    model?: string;
    reset?: string;
  } = {},
): string {
  return JSON.stringify(
    {
      error: {
        code: overrides.code ?? 429,
        message:
          "You have exhausted your capacity on this model. Your quota will reset after 4h58m37s.",
        status: overrides.status ?? "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: overrides.reason ?? "QUOTA_EXHAUSTED",
            domain: "cloudcode-pa.googleapis.com",
            metadata: {
              uiMessage: "true",
              model: overrides.model ?? "gemini-3.1-flash-image",
              quotaResetDelay: "4h58m37.666476761s",
              quotaResetTimeStamp: overrides.reset ?? "2026-11-11T04:48:33Z",
            },
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "17917.666476761s",
          },
        ],
      },
    },
    null,
    2,
  );
}

function errorStep(body: string, status = "ERROR"): string {
  return JSON.stringify({
    step_index: 6,
    source: "MODEL",
    type: "GENERIC",
    status,
    error: `image failed to generate: failed to generate content: 429 Too Many Requests, body: ${body}\n`,
    created_at: "2026-11-10T23:49:54Z",
  });
}

describe("parseImageQuotaExhaustion", () => {
  it("parses Antigravity's recorded image 429 step", () => {
    expect(parseImageQuotaExhaustion(errorStep(googleBody()))).toEqual({
      model: "gemini-3.1-flash-image",
      resetAtMs: Date.parse("2026-11-11T04:48:33Z"),
      occurredAtMs: Date.parse("2026-11-10T23:49:54Z"),
    });
  });

  it("ignores agent prose that mentions the error", () => {
    const line = JSON.stringify({
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-11T00:30:25Z",
      content:
        "Blocked by model quota on `gemini-3.1-flash-image`.\n- **Error**: `429 RESOURCE_EXHAUSTED`",
    });
    expect(parseImageQuotaExhaustion(line)).toBeNull();
  });

  it("ignores the error quoted inside a successful step's output", () => {
    const quoted = JSON.stringify({
      type: "GENERIC",
      status: "DONE",
      created_at: "2026-11-11T00:07:35Z",
      content: `Command output:\n${errorStep(googleBody())}`,
    });
    expect(parseImageQuotaExhaustion(quoted)).toBeNull();
  });

  it("ignores quota errors for non-image models", () => {
    expect(
      parseImageQuotaExhaustion(
        errorStep(googleBody({ model: "gemini-3.5-flash" })),
      ),
    ).toBeNull();
  });

  it("ignores other 429 reasons such as capacity throttling", () => {
    expect(
      parseImageQuotaExhaustion(
        errorStep(googleBody({ reason: "RATE_LIMIT_EXCEEDED" })),
      ),
    ).toBeNull();
  });

  it("ignores non-429 errors and malformed bodies", () => {
    expect(
      parseImageQuotaExhaustion(errorStep(googleBody({ code: 500 }))),
    ).toBeNull();
    expect(parseImageQuotaExhaustion(errorStep("{not json"))).toBeNull();
    expect(
      parseImageQuotaExhaustion(errorStep(googleBody({ reset: "soon" }))),
    ).toBeNull();
    expect(parseImageQuotaExhaustion("not json at all")).toBeNull();
  });
});

describe("image quota marks", () => {
  const now = Date.parse("2026-11-11T01:00:00Z");
  const reset = Date.parse("2026-11-11T05:21:00Z");
  const quota: CloudQuotaData = {
    models: {
      "gemini-3.1-flash-image": {
        percentage: 97,
        resetTime: "2026-11-11T05:34:13Z",
      },
      "models/gemini-3.5-flash": {
        percentage: 97,
        resetTime: "2026-11-11T05:34:13Z",
      },
    },
  };

  it("overrides only the marked image model until reset", () => {
    const marks = mergeImageQuotaMark(
      {},
      "acc-1",
      { model: "gemini-3.1-flash-image", resetAtMs: reset },
      now,
    );
    const applied = applyImageQuotaMarks(quota, marks["acc-1"], now);
    expect(applied?.models["gemini-3.1-flash-image"]).toEqual({
      percentage: 0,
      resetTime: "2026-11-11T05:21:00.000Z",
    });
    expect(applied?.models["models/gemini-3.5-flash"].percentage).toBe(97);
    expect(quota.models["gemini-3.1-flash-image"].percentage).toBe(97);
  });

  it("stops overriding once Google's reset time passes", () => {
    const marks = mergeImageQuotaMark(
      {},
      "acc-1",
      { model: "gemini-3.1-flash-image", resetAtMs: reset },
      now,
    );
    expect(applyImageQuotaMarks(quota, marks["acc-1"], reset + 1)).toBe(quota);
    expect(
      mergeImageQuotaMark(
        marks,
        "acc-2",
        { model: "gemini-3.1-flash-image", resetAtMs: reset - 10 },
        reset + 1,
      ),
    ).toEqual({});
  });

  it("keeps the later reset when the same model is marked twice", () => {
    let marks = mergeImageQuotaMark(
      {},
      "acc-1",
      { model: "gemini-3.1-flash-image", resetAtMs: reset },
      now,
    );
    marks = mergeImageQuotaMark(
      marks,
      "acc-1",
      { model: "gemini-3.1-flash-image", resetAtMs: reset - 60_000 },
      now,
    );
    expect(marks["acc-1"]["gemini-3.1-flash-image"]).toBe(reset);
  });
});
