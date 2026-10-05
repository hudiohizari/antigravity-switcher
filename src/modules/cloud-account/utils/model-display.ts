export interface ClaudeModelParsed {
  variant: 'Sonnet' | 'Opus' | 'Haiku';
  major: string;
  minor: string;
  isThinking: boolean;
  raw: string;
}

export const CLAUDE_DYNAMIC_PATTERN =
  /^claude-(sonnet|opus|haiku)-(\d+)-(\d+)(?:-(thinking))?$/i;

export const CLAUDE_LEGACY_PATTERN =
  /^claude-(\d+)-(\d+)-(sonnet|opus|haiku)(?:-(thinking))?$/i;

export const CLAUDE_BOUNDARY_PATTERN = /(?:^|[-_/])claude(?:[-_/]|$)/i;

export const STATIC_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'gemini-3.1-pro-low/high': 'Gemini 3.1 Pro (Low/High)',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
  'gemini-3-pro-image': 'Gemini 3 Pro Image',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'gemini-3-pro': 'Gemini 3 Pro',
  'gemini-3-flash': 'Gemini 3 Flash',
  'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-flash-lite': 'Gemini Flash Lite',
  'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
  'gpt-oss-120b': 'GPT OSS 120B',
};

export function isClaudeModel(modelName: string): boolean {
  if (!modelName || typeof modelName !== 'string') {
    return false;
  }
  return CLAUDE_BOUNDARY_PATTERN.test(modelName.trim());
}

export function parseClaudeModel(modelId: string): ClaudeModelParsed | null {
  if (!modelId || typeof modelId !== 'string') {
    return null;
  }
  const cleaned = modelId.replace(/^models\//i, '').trim();

  const dynamicMatch = cleaned.match(CLAUDE_DYNAMIC_PATTERN);
  if (dynamicMatch) {
    const [, rawVariant, major, minor, rawThinking] = dynamicMatch;
    const variant = (rawVariant.charAt(0).toUpperCase() +
      rawVariant.slice(1).toLowerCase()) as 'Sonnet' | 'Opus' | 'Haiku';
    return {
      variant,
      major,
      minor,
      isThinking: Boolean(rawThinking),
      raw: cleaned,
    };
  }

  const legacyMatch = cleaned.match(CLAUDE_LEGACY_PATTERN);
  if (legacyMatch) {
    const [, major, minor, rawVariant, rawThinking] = legacyMatch;
    const variant = (rawVariant.charAt(0).toUpperCase() +
      rawVariant.slice(1).toLowerCase()) as 'Sonnet' | 'Opus' | 'Haiku';
    return {
      variant,
      major,
      minor,
      isThinking: Boolean(rawThinking),
      raw: cleaned,
    };
  }

  return null;
}

export function formatModelDisplayName(
  modelName: string,
  apiDisplayName?: string,
): string {
  if (apiDisplayName && apiDisplayName.trim().length > 0) {
    return apiDisplayName.trim();
  }

  if (!modelName || typeof modelName !== 'string') {
    return '';
  }

  const cleaned = modelName.replace(/^models\//i, '').trim();

  if (STATIC_MODEL_DISPLAY_NAMES[cleaned]) {
    return STATIC_MODEL_DISPLAY_NAMES[cleaned];
  }

  const parsed = parseClaudeModel(cleaned);
  if (parsed) {
    const thinkingSuffix = parsed.isThinking ? ' (Thinking)' : '';
    return `Claude ${parsed.major}.${parsed.minor} ${parsed.variant}${thinkingSuffix}`;
  }

  return cleaned
    .replace(/-/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word.length > 2 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(' ');
}

export function formatTrayClaudeLabel(
  modelName: string,
  apiDisplayName?: string,
): string {
  const cleaned = (modelName || '')
    .replace(/^models\//i, '')
    .replace(/-thinking$/i, '')
    .replace(/\s*\(thinking\)$/i, '')
    .trim();

  const parsed = parseClaudeModel(cleaned);
  if (parsed) {
    if (parsed.variant.toLowerCase() === 'sonnet') {
      return `Claude ${parsed.major}.${parsed.minor}:`;
    }
    return `Claude ${parsed.major}.${parsed.minor} ${parsed.variant}:`;
  }

  if (apiDisplayName && apiDisplayName.trim().length > 0) {
    const cleanApi = apiDisplayName.replace(/\s*\(thinking\)$/i, '').trim();
    const apiParsed = cleanApi.match(
      /claude\s+(\d+)\.(\d+)(?:\s+(sonnet|opus|haiku))?/i,
    );
    if (apiParsed) {
      const [, major, minor, rawVariant] = apiParsed;
      const variant = rawVariant
        ? rawVariant.charAt(0).toUpperCase() + rawVariant.slice(1).toLowerCase()
        : '';
      if (!variant || variant.toLowerCase() === 'sonnet') {
        return `Claude ${major}.${minor}:`;
      }
      return `Claude ${major}.${minor} ${variant}:`;
    }
  }

  return 'Claude:';
}

function getVariantPriority(key: string): number {
  const lower = key.toLowerCase();
  if (lower.includes('opus')) return 3;
  if (lower.includes('sonnet')) return 2;
  if (lower.includes('haiku')) return 1;
  return 0;
}

export function selectBestTrayClaudeModel<
  T extends { percentage: number; display_name?: string },
>(
  models: Record<string, T | undefined> | undefined | null,
): { key: string; percentage: number; display_name?: string } | null {
  if (!models || typeof models !== 'object') {
    return null;
  }

  const claudeEntries: Array<{ key: string; val: T }> = [];
  for (const [key, val] of Object.entries(models)) {
    if (val && isClaudeModel(key)) {
      claudeEntries.push({ key, val });
    }
  }

  if (claudeEntries.length === 0) {
    return null;
  }

  claudeEntries.sort((a, b) => {
    const prioA = getVariantPriority(a.key);
    const prioB = getVariantPriority(b.key);
    if (prioA !== prioB) {
      return prioB - prioA;
    }

    const parsedA = parseClaudeModel(a.key);
    const parsedB = parseClaudeModel(b.key);
    if (parsedA && parsedB) {
      const numA = Number(parsedA.major) * 1000 + Number(parsedA.minor);
      const numB = Number(parsedB.major) * 1000 + Number(parsedB.minor);
      if (numA !== numB) {
        return numB - numA;
      }
    }

    const isThinkingA = a.key.toLowerCase().includes('thinking');
    const isThinkingB = b.key.toLowerCase().includes('thinking');
    if (isThinkingA !== isThinkingB) {
      return isThinkingA ? 1 : -1;
    }

    return a.key.localeCompare(b.key);
  });

  const best = claudeEntries[0];
  return {
    key: best.key,
    percentage: best.val.percentage,
    display_name: best.val.display_name,
  };
}
