export type ContextPressureState = "normal" | "high_pressure" | "critical_risk";

export interface ModelCeilingDefinition {
  id: string;
  displayName: string;
  pattern: RegExp;
  maxTokens: number;
  isAuthoritative: boolean;
}

export interface ModelCeilingInfo {
  id: string;
  displayName: string;
  maxTokens: number;
  isAuthoritative: boolean;
}

export const KNOWN_MODEL_CEILINGS: ModelCeilingDefinition[] = [
  // Claude 4.6 Opus (Thinking)
  {
    id: "claude-4.6-opus-thinking",
    displayName: "Claude 4.6 Opus (Thinking)",
    pattern: /(?:claude-opus-4-6-thinking|claude-opus-4-6)/i,
    maxTokens: 160_000,
    isAuthoritative: true,
  },
  // Claude 4.6 Sonnet (Thinking)
  {
    id: "claude-4.6-sonnet-thinking",
    displayName: "Claude 4.6 Sonnet (Thinking)",
    pattern:
      /(?:claude-sonnet-4-6-thinking|claude-sonnet-4-6|claude-3-7-sonnet)/i,
    maxTokens: 160_000,
    isAuthoritative: true,
  },
  // Claude 4.5 Opus (Thinking)
  {
    id: "claude-4.5-opus-thinking",
    displayName: "Claude 4.5 Opus (Thinking)",
    pattern: /(?:claude-opus-4-5-thinking|claude-opus-4-5)/i,
    maxTokens: 160_000,
    isAuthoritative: true,
  },
  // Claude 4.5 Sonnet (Thinking)
  {
    id: "claude-4.5-sonnet-thinking",
    displayName: "Claude 4.5 Sonnet (Thinking)",
    pattern: /(?:claude-sonnet-4-5-thinking|claude-sonnet-4-5)/i,
    maxTokens: 160_000,
    isAuthoritative: true,
  },
  // Claude 3.5 Sonnet
  {
    id: "claude-3.5-sonnet",
    displayName: "Claude 3.5 Sonnet",
    pattern:
      /(?:claude-(?:3-5|3\.5)-sonnet|MODEL_PLACEHOLDER_M26|MODEL_PLACEHOLDER_M34)/i,
    maxTokens: 160_000,
    isAuthoritative: true,
  },
  // Gemini 3.8 Flash (High)
  {
    id: "gemini-3.8-flash-high",
    displayName: "Gemini 3.8 Flash (High)",
    pattern: /(?:gemini-(?:3\.8|3\.5)-flash-high)/i,
    maxTokens: 256_000,
    isAuthoritative: true,
  },
  // Gemini 3.8 Flash
  {
    id: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    pattern:
      /(?:gemini-(?:3\.8|3\.5|3\.1|3|2\.5|2\.0)-flash|gemini-flash|MODEL_PLACEHOLDER_M318)/i,
    maxTokens: 256_000,
    isAuthoritative: true,
  },
  // Gemini 3.1 Pro
  {
    id: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    pattern:
      /(?:gemini-(?:3\.1|3|2\.5|2\.0)-pro|gemini-pro|MODEL_PLACEHOLDER_M29)/i,
    maxTokens: 256_000,
    isAuthoritative: true,
  },
  // GPT OSS 120B
  {
    id: "gpt-oss-120b",
    displayName: "GPT OSS 120B",
    pattern: /(?:^|[-_/])gpt-oss-120b(?:[-_/]|$)/i,
    maxTokens: 128_000,
    isAuthoritative: true,
  },
];

export const CLAUDE_BOUNDARY_REGEX = /(?:^|[-_/])claude(?:[-_/]|$)/i;
export const GEMINI_BOUNDARY_REGEX = /(?:^|[-_/])gemini(?:[-_/]|$)/i;

export const FALLBACK_MODEL_CEILING: ModelCeilingDefinition = {
  id: "unknown-model",
  displayName: "Unknown Model",
  pattern: /.*/,
  maxTokens: 128_000,
  isAuthoritative: false,
};

/**
 * Resolves the maximum context window ceiling from a model identifier or proto enum.
 */
export function resolveModelContextWindow(rawModel?: string): ModelCeilingInfo {
  if (!rawModel || typeof rawModel !== "string") {
    return {
      id: FALLBACK_MODEL_CEILING.id,
      displayName: FALLBACK_MODEL_CEILING.displayName,
      maxTokens: FALLBACK_MODEL_CEILING.maxTokens,
      isAuthoritative: FALLBACK_MODEL_CEILING.isAuthoritative,
    };
  }

  const trimmed = rawModel.trim();
  for (const def of KNOWN_MODEL_CEILINGS) {
    if (def.pattern.test(trimmed)) {
      return {
        id: def.id,
        displayName: def.displayName,
        maxTokens: def.maxTokens,
        isAuthoritative: def.isAuthoritative,
      };
    }
  }

  if (CLAUDE_BOUNDARY_REGEX.test(trimmed)) {
    const cleaned = trimmed.replace(/^models\//i, "");
    const dynamicMatch = cleaned.match(
      /^claude-(sonnet|opus|haiku)-(\d+)-(\d+)(?:-(thinking))?$/i,
    );
    let displayName = "Claude (Dynamic)";
    if (dynamicMatch) {
      const [, rawVariant, major, minor, thinking] = dynamicMatch;
      const variant =
        rawVariant.charAt(0).toUpperCase() + rawVariant.slice(1).toLowerCase();
      displayName = `Claude ${major}.${minor} ${variant}${thinking ? " (Thinking)" : ""}`;
    } else {
      const legacyMatch = cleaned.match(
        /^claude-(\d+)-(\d+)-(sonnet|opus|haiku)(?:-(thinking))?$/i,
      );
      if (legacyMatch) {
        const [, major, minor, rawVariant, thinking] = legacyMatch;
        const variant =
          rawVariant.charAt(0).toUpperCase() +
          rawVariant.slice(1).toLowerCase();
        displayName = `Claude ${major}.${minor} ${variant}${thinking ? " (Thinking)" : ""}`;
      }
    }

    return {
      id: trimmed,
      displayName,
      maxTokens: 160_000,
      isAuthoritative: true,
    };
  }

  if (GEMINI_BOUNDARY_REGEX.test(trimmed)) {
    const cleaned = trimmed.replace(/^models\//i, "");
    const match = cleaned.match(/^gemini(?:-(\d+(?:\.\d+)?))?(?:-(.+))?$/i);
    let displayName = "Gemini (Dynamic)";
    if (match) {
      const [, version, variant] = match;
      if (version && variant) {
        const formattedVariant = variant
          .split("-")
          .map(
            (word) =>
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join(" ");
        displayName = `Gemini ${version} ${formattedVariant}`;
      } else if (variant) {
        const formattedVariant = variant
          .split("-")
          .map(
            (word) =>
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join(" ");
        displayName = `Gemini ${formattedVariant}`;
      } else if (version) {
        displayName = `Gemini ${version}`;
      }
    }

    return {
      id: trimmed,
      displayName,
      maxTokens: 256_000,
      isAuthoritative: true,
    };
  }

  return {
    id: FALLBACK_MODEL_CEILING.id,
    displayName: trimmed || FALLBACK_MODEL_CEILING.displayName,
    maxTokens: FALLBACK_MODEL_CEILING.maxTokens,
    isAuthoritative: FALLBACK_MODEL_CEILING.isAuthoritative,
  };
}

/**
 * Evaluates context pressure based on exact percentage boundaries:
 * - < 70.0%: normal
 * - 70.0% - 89.9%: high_pressure
 * - >= 90.0%: critical_risk
 *
 * Can be invoked with:
 * - ratio percentage directly: calculatePressureState(ratioPct)
 * - used tokens and max tokens: calculatePressureState(usedTokens, maxTokens)
 */
export function calculatePressureState(
  ratioPctOrUsed: number,
  maxTokens?: number,
): ContextPressureState {
  const ratioPct =
    maxTokens !== undefined && maxTokens > 0
      ? Number(((ratioPctOrUsed / maxTokens) * 100).toFixed(1))
      : ratioPctOrUsed;

  if (ratioPct >= 90.0) {
    return "critical_risk";
  }
  if (ratioPct >= 70.0) {
    return "high_pressure";
  }
  return "normal";
}

/**
 * Returns canonical list of available models for client-side switch preview calculations.
 * Empty since preview was removed per user request.
 */
export function getAvailableModelCeilings(): ModelCeilingInfo[] {
  return [];
}
