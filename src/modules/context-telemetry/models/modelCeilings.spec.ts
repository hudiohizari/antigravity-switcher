import { describe, it, expect } from "vitest";
import {
  resolveModelContextWindow,
  calculatePressureState,
  getAvailableModelCeilings,
  KNOWN_MODEL_CEILINGS,
} from "./modelCeilings";

describe("modelCeilings.spec (Ceiling Alignment & Compaction Guard)", () => {
  describe("AC-03: Gemini 3.8 Flash Active Compaction Ceiling (256,000 tokens)", () => {
    it("resolves gemini-3.8-flash to 256,000 tokens ceiling with authoritative true", () => {
      const ceiling = resolveModelContextWindow("gemini-3.8-flash");
      expect(ceiling.displayName).toBe("Gemini 3.8 Flash");
      expect(ceiling.maxTokens).toBe(256_000);
      expect(ceiling.isAuthoritative).toBe(true);
    });

    it("resolves gemini-3.8-flash-high to 256,000 tokens ceiling with authoritative true", () => {
      const ceiling = resolveModelContextWindow("gemini-3.8-flash-high");
      expect(ceiling.displayName).toBe("Gemini 3.8 Flash (High)");
      expect(ceiling.maxTokens).toBe(256_000);
      expect(ceiling.isAuthoritative).toBe(true);
    });

    it("resolves MODEL_PLACEHOLDER_M318 wire placeholder to 256,000 tokens ceiling", () => {
      const ceiling = resolveModelContextWindow("MODEL_PLACEHOLDER_M318");
      expect(ceiling.displayName).toBe("Gemini 3.8 Flash");
      expect(ceiling.maxTokens).toBe(256_000);
      expect(ceiling.isAuthoritative).toBe(true);
    });

    it("verifies KNOWN_MODEL_CEILINGS array strictly defines 256_000 for Flash and Argon variants", () => {
      const flashHighDef = KNOWN_MODEL_CEILINGS.find(
        (c) => c.id === "gemini-3.8-flash-high",
      );
      expect(flashHighDef).toBeDefined();
      expect(flashHighDef?.maxTokens).toBe(256_000);

      const flashDef = KNOWN_MODEL_CEILINGS.find(
        (c) => c.id === "gemini-3.8-flash",
      );
      expect(flashDef).toBeDefined();
      expect(flashDef?.maxTokens).toBe(256_000);

      for (const [input, expectedName] of [
        ["gemini-4-argon", "Gemini 4 Argon"],
        ["gemini-4-argon-low", "Gemini 4 Argon (Low)"],
        ["gemini-4-argon-medium", "Gemini 4 Argon (Medium)"],
        ["gemini-4-argon-high", "Gemini 4 Argon (High)"],
        ["MODEL_PLACEHOLDER_M418", "Gemini 4 Argon (Medium)"],
        ["MODEL_PLACEHOLDER_M408", "Gemini 4 Argon"],
      ] as const) {
        const res = resolveModelContextWindow(input);
        expect(res).toMatchObject({
          displayName: expectedName,
          maxTokens: 256_000,
          isAuthoritative: true,
        });
      }
    });
  });

  describe("AC-04: Accurate Context Pressure & Compaction Risk Telemetry", () => {
    it("evaluates 230,000 tokens on 256,000 ceiling as 89.8% (high_pressure) and prevents normal misreporting", () => {
      const usedTokens = 230_000;
      const trueCeiling = 256_000;
      const oldCeiling = 1_000_000;

      // True Antigravity 2.0 ceiling ratio
      const ratio = Number(((usedTokens / trueCeiling) * 100).toFixed(1));
      expect(ratio).toBe(89.8);
      expect(calculatePressureState(ratio)).toBe("high_pressure");

      // Critical risk threshold: 230,400+ tokens evaluates to >= 90.0%
      const criticalTokens = 230_400;
      const criticalRatio = Number(
        ((criticalTokens / trueCeiling) * 100).toFixed(1),
      );
      expect(criticalRatio).toBe(90.0);
      expect(calculatePressureState(criticalRatio)).toBe("critical_risk");

      // 2-arg calculation
      expect(calculatePressureState(criticalTokens, trueCeiling)).toBe(
        "critical_risk",
      );
      expect(calculatePressureState(usedTokens, trueCeiling)).toBe(
        "high_pressure",
      );

      // Verifies contrast against old misleading 1M ceiling
      const oldRatio = Number(((usedTokens / oldCeiling) * 100).toFixed(1));
      expect(oldRatio).toBe(23.0);
      expect(calculatePressureState(oldRatio)).toBe("normal");
      expect(calculatePressureState(usedTokens, oldCeiling)).toBe("normal");
    });

    it("verifies strict percentage boundaries for 1-arg calculatePressureState", () => {
      expect(calculatePressureState(0.0)).toBe("normal");
      expect(calculatePressureState(69.9)).toBe("normal");
      expect(calculatePressureState(70.0)).toBe("high_pressure");
      expect(calculatePressureState(89.9)).toBe("high_pressure");
      expect(calculatePressureState(90.0)).toBe("critical_risk");
      expect(calculatePressureState(100.0)).toBe("critical_risk");
    });
  });

  describe("Claude 5.5 Opus Context Ceilings (840,000 tokens)", () => {
    it("resolves Claude 5.5 Opus variants and placeholders to 840,000 tokens authoritative", () => {
      const cases = [
        {
          input: "claude-opus-5-5-high",
          name: "Claude 5.5 Opus (High)",
        },
        {
          input: "claude-5-5-opus-high",
          name: "Claude 5.5 Opus (High)",
        },
        {
          input: "claude-opus-5-5-medium",
          name: "Claude 5.5 Opus (Medium)",
        },
        {
          input: "MODEL_PLACEHOLDER_M401",
          name: "Claude 5.5 Opus (Medium)",
        },
        {
          input: "claude-opus-5-5-low",
          name: "Claude 5.5 Opus (Low)",
        },
        {
          input: "MODEL_PLACEHOLDER_M400",
          name: "Claude 5.5 Opus (Low)",
        },
        {
          input: "claude-opus-5-5-max",
          name: "Claude 5.5 Opus (Max)",
        },
        {
          input: "MODEL_PLACEHOLDER_M402",
          name: "Claude 5.5 Opus (Max)",
        },
        {
          input: "claude-5-5-opus-thinking",
          name: "Claude 5.5 Opus (Thinking)",
        },
        {
          input: "claude-opus-5-5",
          name: "Claude 5.5 Opus",
        },
        {
          input: "claude-5-5-opus",
          name: "Claude 5.5 Opus",
        },
        {
          input: "MODEL_PLACEHOLDER_M403",
          name: "Claude 5.5 Opus",
        },
      ];

      for (const { input, name } of cases) {
        const ceiling = resolveModelContextWindow(input);
        expect(ceiling.displayName).toBe(name);
        expect(ceiling.maxTokens).toBe(840_000);
        expect(ceiling.isAuthoritative).toBe(true);
      }
    });

    it("formats dynamic Claude fallback with effort tier suffixes", () => {
      const fallbackHigh = resolveModelContextWindow("claude-haiku-4-5-high");
      expect(fallbackHigh.displayName).toBe("Claude 4.5 Haiku (High)");
      expect(fallbackHigh.maxTokens).toBe(160_000);
      expect(fallbackHigh.isAuthoritative).toBe(true);

      const fallbackLow = resolveModelContextWindow("claude-sonnet-4-7-low");
      expect(fallbackLow.displayName).toBe("Claude 4.7 Sonnet (Low)");
      expect(fallbackLow.maxTokens).toBe(160_000);
      expect(fallbackLow.isAuthoritative).toBe(true);
    });
  });
});
