import { describe, expect, it } from "vitest";
import {
  aggregateQuotaModelFamilies,
  aggregateVisibleQuotaModelFamilies,
  getQuotaModelFamilyDisplayName,
  getQuotaModelFamilyId,
} from "@/modules/cloud-account/utils/quota-model-families";
import type { CloudQuotaModelInfo } from "@/modules/cloud-account/types";

function quota(percentage: number, resetTime: string): CloudQuotaModelInfo {
  return {
    percentage,
    resetTime,
  };
}

describe("quota model families", () => {
  it("uses the minimum remaining quota and earliest reset in a registered family", () => {
    const aggregated = aggregateQuotaModelFamilies({
      "gemini-3.1-pro-low": quota(80, "2026-07-30T10:00:00.000Z"),
      "gemini-pro-agent": quota(5, "2026-07-30T12:00:00.000Z"),
      "gemini-3.1-pro-preview": quota(40, "2026-07-30T08:00:00.000Z"),
    });

    expect(aggregated["gemini-3.1-pro"]).toMatchObject({
      percentage: 5,
      resetTime: "2026-07-30T08:00:00.000Z",
      display_name: "Gemini 3.1 Pro",
    });
    expect(Object.keys(aggregated)).toEqual(["gemini-3.1-pro"]);
  });

  it("aggregates Flash aliases without filtering thinking model names", () => {
    const aggregated = aggregateQuotaModelFamilies({
      "gemini-2.5-flash": quota(60, "2026-07-30T12:00:00.000Z"),
      "gemini-2.5-flash-thinking": quota(7, "2026-07-30T09:00:00.000Z"),
    });

    expect(aggregated["gemini-flash-lite"]).toMatchObject({
      percentage: 7,
      resetTime: "2026-07-30T09:00:00.000Z",
    });
  });

  it("keeps unknown models, including names containing thinking", () => {
    const aggregated = aggregateQuotaModelFamilies({
      "vendor-experimental-thinking-v9": quota(23, "not-a-date"),
    });

    expect(aggregated).toEqual({
      "vendor-experimental-thinking-v9": quota(23, "not-a-date"),
    });
  });

  it("does not merge independently routed Claude families", () => {
    expect(getQuotaModelFamilyId("claude-sonnet-4-6-thinking")).toBe(
      "claude-sonnet-4-6",
    );
    expect(getQuotaModelFamilyId("claude-opus-4-6-thinking")).toBe(
      "claude-opus-4-6",
    );
  });

  it("routes gemini-3.8-flash variants to gemini-3.8-flash family", () => {
    expect(getQuotaModelFamilyId("gemini-3.8-flash-high")).toBe(
      "gemini-3.8-flash",
    );
    expect(getQuotaModelFamilyId("gemini-3.8-flash-medium")).toBe(
      "gemini-3.8-flash",
    );
    expect(getQuotaModelFamilyId("gemini-3.8-flash-low")).toBe(
      "gemini-3.8-flash",
    );
  });

  it("keeps hidden routed members in the conservative family value", () => {
    const aggregated = aggregateVisibleQuotaModelFamilies(
      {
        "gemini-3.1-pro-low": quota(5, "2026-07-30T08:00:00.000Z"),
        "gemini-pro-agent": quota(80, "2026-07-30T10:00:00.000Z"),
      },
      {
        "gemini-3.1-pro-low": false,
      },
    );

    expect(aggregated["gemini-3.1-pro"].percentage).toBe(5);
  });

  describe("getQuotaModelFamilyDisplayName and dynamic Claude family aggregation", () => {
    it("dynamically formats Claude families as Claude {Major}.{Minor} {Variant}", () => {
      expect(getQuotaModelFamilyDisplayName("claude-opus-4-6")).toBe("Claude 4.6 Opus");
      expect(getQuotaModelFamilyDisplayName("claude-sonnet-4-5")).toBe("Claude 4.5 Sonnet");
      expect(getQuotaModelFamilyDisplayName("claude-haiku-4-5")).toBe("Claude 4.5 Haiku");
      expect(getQuotaModelFamilyDisplayName("claude-opus-5-5")).toBe("Claude 5.5 Opus");
    });

    it("returns static display names for non-Claude families", () => {
      expect(getQuotaModelFamilyDisplayName("gemini-3.1-pro")).toBe("Gemini 3.1 Pro");
      expect(getQuotaModelFamilyDisplayName("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
      expect(getQuotaModelFamilyDisplayName("gpt-oss-120b")).toBe("GPT OSS 120B");
      expect(getQuotaModelFamilyDisplayName("unknown-vendor-v1")).toBeUndefined();
    });

    it("aggregates Claude model families with dynamic family titles", () => {
      // claude-opus-4-6 and claude-opus-4-6-thinking
      const opusAggregated = aggregateQuotaModelFamilies({
        "claude-opus-4-6": quota(85, "2026-09-09T20:00:00.000Z"),
        "claude-opus-4-6-thinking": quota(60, "2026-09-09T18:00:00.000Z"),
      });
      expect(opusAggregated["claude-opus-4-6"]).toMatchObject({
        percentage: 60,
        resetTime: "2026-09-09T18:00:00.000Z",
        display_name: "Claude 4.6 Opus",
      });

      // claude-sonnet-4-5 and claude-sonnet-4-5-thinking
      const sonnetAggregated = aggregateQuotaModelFamilies({
        "claude-sonnet-4-5": quota(75, "2026-09-09T20:00:00.000Z"),
        "claude-sonnet-4-5-thinking": quota(90, "2026-09-09T22:00:00.000Z"),
      });
      expect(sonnetAggregated["claude-sonnet-4-5"]).toMatchObject({
        percentage: 75,
        resetTime: "2026-09-09T20:00:00.000Z",
        display_name: "Claude 4.5 Sonnet",
      });

      // claude-haiku-4-5 and claude-haiku-4-5-thinking
      const haikuAggregated = aggregateQuotaModelFamilies({
        "claude-haiku-4-5": quota(50, "2026-09-09T20:00:00.000Z"),
        "claude-haiku-4-5-thinking": quota(50, "2026-09-09T21:00:00.000Z"),
      });
      expect(haikuAggregated["claude-haiku-4-5"]).toMatchObject({
        percentage: 50,
        resetTime: "2026-09-09T20:00:00.000Z",
        display_name: "Claude 4.5 Haiku",
      });
    });
  });
});
