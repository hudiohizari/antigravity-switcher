import { describe, it, expect } from "vitest";
import {
  resolveModelContextWindow,
  calculatePressureState,
  getAvailableModelCeilings,
  CLAUDE_BOUNDARY_REGEX,
  GEMINI_BOUNDARY_REGEX,
  KNOWN_MODEL_CEILINGS,
} from "@/modules/context-telemetry/models/modelCeilings";
import { resolveConcurrentModelName } from "@/modules/context-telemetry/components/ContextDashboard";

describe("modelCeilings (Context Ceiling Mapping & Pressure Bounds)", () => {
  describe("resolveModelContextWindow (Antigravity 2.0 Models)", () => {
    it("maps Claude 4.6 Opus (Thinking) to exact displayName and 160,000 tokens", () => {
      const thinking = resolveModelContextWindow("claude-opus-4-6-thinking");
      expect(thinking.displayName).toBe("Claude 4.6 Opus (Thinking)");
      expect(thinking.maxTokens).toBe(160_000);
      expect(thinking.isAuthoritative).toBe(true);

      const standard = resolveModelContextWindow("claude-opus-4-6");
      expect(standard.displayName).toBe("Claude 4.6 Opus (Thinking)");
      expect(standard.maxTokens).toBe(160_000);
      expect(standard.isAuthoritative).toBe(true);
    });

    it("maps Claude 4.6 Sonnet (Thinking) and 3.7 Sonnet to exact displayName and 160,000 tokens", () => {
      const sonnet46Thinking = resolveModelContextWindow("claude-sonnet-4-6-thinking");
      expect(sonnet46Thinking.displayName).toBe("Claude 4.6 Sonnet (Thinking)");
      expect(sonnet46Thinking.maxTokens).toBe(160_000);
      expect(sonnet46Thinking.isAuthoritative).toBe(true);

      const sonnet46 = resolveModelContextWindow("claude-sonnet-4-6");
      expect(sonnet46.displayName).toBe("Claude 4.6 Sonnet (Thinking)");
      expect(sonnet46.maxTokens).toBe(160_000);
      expect(sonnet46.isAuthoritative).toBe(true);

      const sonnet37 = resolveModelContextWindow("claude-3-7-sonnet");
      expect(sonnet37.displayName).toBe("Claude 4.6 Sonnet (Thinking)");
      expect(sonnet37.maxTokens).toBe(160_000);
      expect(sonnet37.isAuthoritative).toBe(true);
    });

    it("maps Claude 4.5 Opus and Sonnet (Thinking) to exact displayNames and 160,000 tokens", () => {
      const opus45 = resolveModelContextWindow("claude-opus-4-5-thinking");
      expect(opus45.displayName).toBe("Claude 4.5 Opus (Thinking)");
      expect(opus45.maxTokens).toBe(160_000);
      expect(opus45.isAuthoritative).toBe(true);

      const sonnet45 = resolveModelContextWindow("claude-sonnet-4-5-thinking");
      expect(sonnet45.displayName).toBe("Claude 4.5 Sonnet (Thinking)");
      expect(sonnet45.maxTokens).toBe(160_000);
      expect(sonnet45.isAuthoritative).toBe(true);
    });

    it("maps Claude 3.5 Sonnet and wire enums M26/M34 to Claude 3.5 Sonnet and 160,000 tokens", () => {
      const sonnet35 = resolveModelContextWindow("claude-3-5-sonnet");
      expect(sonnet35.displayName).toBe("Claude 3.5 Sonnet");
      expect(sonnet35.maxTokens).toBe(160_000);
      expect(sonnet35.isAuthoritative).toBe(true);

      const m26 = resolveModelContextWindow("MODEL_PLACEHOLDER_M26");
      expect(m26.displayName).toBe("Claude 3.5 Sonnet");
      expect(m26.maxTokens).toBe(160_000);
      expect(m26.isAuthoritative).toBe(true);

      const m34 = resolveModelContextWindow("MODEL_PLACEHOLDER_M34");
      expect(m34.displayName).toBe("Claude 3.5 Sonnet");
      expect(m34.maxTokens).toBe(160_000);
      expect(m34.isAuthoritative).toBe(true);
    });

    it("maps Gemini 3.8 Flash (High) to exact displayName and 256,000 tokens (AC-03)", () => {
      const flashHigh = resolveModelContextWindow("gemini-3.8-flash-high");
      expect(flashHigh.displayName).toBe("Gemini 3.8 Flash (High)");
      expect(flashHigh.maxTokens).toBe(256_000);
      expect(flashHigh.isAuthoritative).toBe(true);
    });

    it("maps Gemini 3.8 Flash and M318 wire placeholder to exact displayName and 256,000 tokens (AC-03)", () => {
      const flash = resolveModelContextWindow("gemini-3.8-flash");
      expect(flash.displayName).toBe("Gemini 3.8 Flash");
      expect(flash.maxTokens).toBe(256_000);
      expect(flash.isAuthoritative).toBe(true);

      const m318 = resolveModelContextWindow("MODEL_PLACEHOLDER_M318");
      expect(m318.displayName).toBe("Gemini 3.8 Flash");
      expect(m318.maxTokens).toBe(256_000);
      expect(m318.isAuthoritative).toBe(true);
    });

    it("maps Gemini 3.1 Pro and M29 wire placeholder to exact displayName and 256,000 tokens", () => {
      const pro = resolveModelContextWindow("gemini-3.1-pro");
      expect(pro.displayName).toBe("Gemini 3.1 Pro");
      expect(pro.maxTokens).toBe(256_000);
      expect(pro.isAuthoritative).toBe(true);

      const m29 = resolveModelContextWindow("MODEL_PLACEHOLDER_M29");
      expect(m29.displayName).toBe("Gemini 3.1 Pro");
      expect(m29.maxTokens).toBe(256_000);
      expect(m29.isAuthoritative).toBe(true);
    });

    it("maps gpt-oss-120b and models/gpt-oss-120b to exact displayName and 128,000 tokens (isAuthoritative: true)", () => {
      const gptOss = resolveModelContextWindow("gpt-oss-120b");
      expect(gptOss.displayName).toBe("GPT OSS 120B");
      expect(gptOss.maxTokens).toBe(128_000);
      expect(gptOss.isAuthoritative).toBe(true);

      const prefixedGptOss = resolveModelContextWindow("models/gpt-oss-120b");
      expect(prefixedGptOss.displayName).toBe("GPT OSS 120B");
      expect(prefixedGptOss.maxTokens).toBe(128_000);
      expect(prefixedGptOss.isAuthoritative).toBe(true);
    });

    it("falls back to default fallback (128,000 tokens, isAuthoritative: false) for non-Antigravity models (GPT-4o, DeepSeek)", () => {
      const gpt4o = resolveModelContextWindow("gpt-4o");
      expect(gpt4o.maxTokens).toBe(128_000);
      expect(gpt4o.isAuthoritative).toBe(false);

      const gpt4oMini = resolveModelContextWindow("gpt-4o-mini");
      expect(gpt4oMini.maxTokens).toBe(128_000);
      expect(gpt4oMini.isAuthoritative).toBe(false);

      const o1 = resolveModelContextWindow("o1-preview");
      expect(o1.maxTokens).toBe(128_000);
      expect(o1.isAuthoritative).toBe(false);

      const deepseekChat = resolveModelContextWindow("deepseek-chat");
      expect(deepseekChat.maxTokens).toBe(128_000);
      expect(deepseekChat.isAuthoritative).toBe(false);

      const deepseekR1 = resolveModelContextWindow("deepseek-r1");
      expect(deepseekR1.maxTokens).toBe(128_000);
      expect(deepseekR1.isAuthoritative).toBe(false);
    });

    it("resolves dynamic and uncataloged Claude models to authoritative 160,000 tokens", () => {
      // Uncataloged dynamic pattern model
      const opus55 = resolveModelContextWindow("claude-opus-5-5");
      expect(opus55.displayName).toBe("Claude 5.5 Opus");
      expect(opus55.maxTokens).toBe(160_000);
      expect(opus55.isAuthoritative).toBe(true);

      // Uncataloged dynamic thinking model
      const haiku45Thinking = resolveModelContextWindow("claude-haiku-4-5-thinking");
      expect(haiku45Thinking.displayName).toBe("Claude 4.5 Haiku (Thinking)");
      expect(haiku45Thinking.maxTokens).toBe(160_000);
      expect(haiku45Thinking.isAuthoritative).toBe(true);

      // Prefix models/ handling
      const prefixed = resolveModelContextWindow("models/claude-haiku-4-5");
      expect(prefixed.displayName).toBe("Claude 4.5 Haiku");
      expect(prefixed.maxTokens).toBe(160_000);
      expect(prefixed.isAuthoritative).toBe(true);

      // Legacy pattern in boundary fallback (both with and without thinking)
      const legacyDynamicThinking = resolveModelContextWindow("claude-4-0-sonnet-thinking");
      expect(legacyDynamicThinking.displayName).toBe("Claude 4.0 Sonnet (Thinking)");
      expect(legacyDynamicThinking.maxTokens).toBe(160_000);
      expect(legacyDynamicThinking.isAuthoritative).toBe(true);

      const legacyDynamic = resolveModelContextWindow("claude-4-0-haiku");
      expect(legacyDynamic.displayName).toBe("Claude 4.0 Haiku");
      expect(legacyDynamic.maxTokens).toBe(160_000);
      expect(legacyDynamic.isAuthoritative).toBe(true);

      // Custom Claude variant without version pattern
      const customClaude = resolveModelContextWindow("custom-claude-variant");
      expect(customClaude.displayName).toBe("Claude (Dynamic)");
      expect(customClaude.maxTokens).toBe(160_000);
      expect(customClaude.isAuthoritative).toBe(true);
    });

    it("does not match non-Claude models with substring claude without boundary delimiters", () => {
      const enclave = resolveModelContextWindow("enclave-model");
      expect(enclave.maxTokens).toBe(128_000);
      expect(enclave.isAuthoritative).toBe(false);

      const declauder = resolveModelContextWindow("declauder-v2");
      expect(declauder.maxTokens).toBe(128_000);
      expect(declauder.isAuthoritative).toBe(false);
    });

    it("resolves dynamic and uncataloged Gemini models to authoritative 256,000 tokens", () => {
      // Dynamic uncataloged versioned model
      const gemini15Pro = resolveModelContextWindow("gemini-1.5-pro");
      expect(gemini15Pro.displayName).toBe("Gemini 1.5 Pro");
      expect(gemini15Pro.maxTokens).toBe(256_000);
      expect(gemini15Pro.isAuthoritative).toBe(true);

      // Dynamic uncataloged variant model
      const vision = resolveModelContextWindow("gemini-vision-preview");
      expect(vision.displayName).toBe("Gemini Vision Preview");
      expect(vision.maxTokens).toBe(256_000);
      expect(vision.isAuthoritative).toBe(true);

      // Dynamic and uncataloged Gemini model resolution
      const flashImage = resolveModelContextWindow("gemini-flash-image");
      expect(flashImage.maxTokens).toBe(256_000);
      expect(flashImage.isAuthoritative).toBe(true);

      const geminiPro = resolveModelContextWindow("gemini-pro");
      expect(geminiPro.maxTokens).toBe(256_000);
      expect(geminiPro.isAuthoritative).toBe(true);

      // Prefix models/ handling
      const prefixed = resolveModelContextWindow("models/gemini-2.5-flash");
      expect(prefixed.displayName).toBe("Gemini 3.8 Flash");
      expect(prefixed.maxTokens).toBe(256_000);
      expect(prefixed.isAuthoritative).toBe(true);

      // Custom uncataloged Gemini model
      const uncataloged = resolveModelContextWindow("uncataloged-gemini-model");
      expect(uncataloged.displayName).toBe("Gemini (Dynamic)");
      expect(uncataloged.maxTokens).toBe(256_000);
      expect(uncataloged.isAuthoritative).toBe(true);

      // Dynamic uncataloged version-only model
      const versionOnly = resolveModelContextWindow("gemini-9");
      expect(versionOnly.displayName).toBe("Gemini 9");
      expect(versionOnly.maxTokens).toBe(256_000);
      expect(versionOnly.isAuthoritative).toBe(true);

      // Delimiter variations
      const slashGemini = resolveModelContextWindow("custom/gemini/v2");
      expect(slashGemini.maxTokens).toBe(256_000);
      expect(slashGemini.isAuthoritative).toBe(true);
    });

    it("does not match non-Gemini models with substring gemini without boundary delimiters", () => {
      const ingeminate = resolveModelContextWindow("ingeminate-model");
      expect(ingeminate.maxTokens).toBe(128_000);
      expect(ingeminate.isAuthoritative).toBe(false);

      const ageminix = resolveModelContextWindow("ageminix");
      expect(ageminix.maxTokens).toBe(128_000);
      expect(ageminix.isAuthoritative).toBe(false);
    });

    it("exports GEMINI_BOUNDARY_REGEX and CLAUDE_BOUNDARY_REGEX patterns correctly", () => {
      expect(GEMINI_BOUNDARY_REGEX.test("gemini")).toBe(true);
      expect(GEMINI_BOUNDARY_REGEX.test("models/gemini-1.5-pro")).toBe(true);
      expect(GEMINI_BOUNDARY_REGEX.test("ingeminate")).toBe(false);

      expect(CLAUDE_BOUNDARY_REGEX.test("claude")).toBe(true);
      expect(CLAUDE_BOUNDARY_REGEX.test("models/claude-3-5-sonnet")).toBe(true);
      expect(CLAUDE_BOUNDARY_REGEX.test("enclave")).toBe(false);
    });

    it("falls back to 128,000 tokens for unknown or empty models with isAuthoritative = false", () => {
      const fallback = resolveModelContextWindow("custom-fine-tuned-model");
      expect(fallback.maxTokens).toBe(128_000);
      expect(fallback.isAuthoritative).toBe(false);

      const nullFallback = resolveModelContextWindow(undefined);
      expect(nullFallback.maxTokens).toBe(128_000);
      expect(nullFallback.isAuthoritative).toBe(false);

      const emptyFallback = resolveModelContextWindow("");
      expect(emptyFallback.maxTokens).toBe(128_000);
      expect(emptyFallback.isAuthoritative).toBe(false);

      const whitespaceFallback = resolveModelContextWindow("   ");
      expect(whitespaceFallback.maxTokens).toBe(128_000);
      expect(whitespaceFallback.displayName).toBe("Unknown Model");
      expect(whitespaceFallback.isAuthoritative).toBe(false);
    });
  });

  describe("calculatePressureState (Strict Boundaries)", () => {
    it("classifies < 70.0% as normal", () => {
      expect(calculatePressureState(0.0)).toBe("normal");
      expect(calculatePressureState(45.5)).toBe("normal");
      expect(calculatePressureState(69.9)).toBe("normal");
    });

    it("classifies 70.0% - 89.9% as high_pressure", () => {
      expect(calculatePressureState(70.0)).toBe("high_pressure");
      expect(calculatePressureState(75.2)).toBe("high_pressure");
      expect(calculatePressureState(89.9)).toBe("high_pressure");
    });

    it("classifies >= 90.0% as critical_risk", () => {
      expect(calculatePressureState(90.0)).toBe("critical_risk");
      expect(calculatePressureState(95.0)).toBe("critical_risk");
      expect(calculatePressureState(100.0)).toBe("critical_risk");
      expect(calculatePressureState(115.0)).toBe("critical_risk");
    });

    it("evaluates context pressure accurately against Antigravity 256,000 compaction ceiling (AC-04)", () => {
      const usedTokens = 230_000;
      const trueCeiling = 256_000;
      const oldCeiling = 1_000_000;

      // Ratio against true Antigravity ceiling evaluates to ~89.8% (89.84375%)
      const ratio = Number(((usedTokens / trueCeiling) * 100).toFixed(1));
      expect(ratio).toBe(89.8);
      // High pressure warning, NOT normal
      expect(calculatePressureState(ratio)).toBe("high_pressure");

      // Critical compaction threshold: 230,400+ tokens on 256,000 window evaluates to >= 90.0%
      const criticalTokens = 230_400;
      const criticalRatio = Number(((criticalTokens / trueCeiling) * 100).toFixed(1));
      expect(criticalRatio).toBe(90.0);
      expect(calculatePressureState(criticalRatio)).toBe("critical_risk");

      // Direct 2-arg calculation: calculatePressureState(usedTokens, maxTokens)
      expect(calculatePressureState(criticalTokens, trueCeiling)).toBe("critical_risk");
      expect(calculatePressureState(231_000, trueCeiling)).toBe("critical_risk");
      expect(calculatePressureState(usedTokens, trueCeiling)).toBe("high_pressure");

      // System does NOT report 'normal' or evaluate against 1,000,000 API brochure ceiling
      const misleadingRatioOld = Number(((usedTokens / oldCeiling) * 100).toFixed(1));
      expect(misleadingRatioOld).toBe(23.0);
      expect(calculatePressureState(misleadingRatioOld)).toBe("normal");
      expect(calculatePressureState(usedTokens, oldCeiling)).toBe("normal");
    });
  });

  describe("getAvailableModelCeilings", () => {
    it("returns empty model list since switch compatibility preview is removed", () => {
      const models = getAvailableModelCeilings();
      expect(models).toEqual([]);
    });
  });

  describe("resolveConcurrentModelName (ContextDashboard Concurrent Model Resolution)", () => {
    it("resolves >= 2,000,000 tokens to Gemini 3.1 Pro", () => {
      expect(resolveConcurrentModelName(2_000_000)).toBe("Gemini 3.1 Pro");
      expect(resolveConcurrentModelName(2_500_000)).toBe("Gemini 3.1 Pro");
    });

    it("resolves >= 256,000 tokens to Gemini 3.8 Flash", () => {
      expect(resolveConcurrentModelName(256_000)).toBe("Gemini 3.8 Flash");
      expect(resolveConcurrentModelName(500_000)).toBe("Gemini 3.8 Flash");
    });

    it("resolves >= 160,000 tokens to Claude Sonnet (not Antigravity Model)", () => {
      expect(resolveConcurrentModelName(160_000)).toBe("Claude Sonnet");
      expect(resolveConcurrentModelName(200_000)).toBe("Claude Sonnet");
    });

    it("falls back to Antigravity Model for tokens < 160,000", () => {
      expect(resolveConcurrentModelName(128_000)).toBe("Antigravity Model");
      expect(resolveConcurrentModelName(100_000)).toBe("Antigravity Model");
      expect(resolveConcurrentModelName(0)).toBe("Antigravity Model");
    });
  });
});
