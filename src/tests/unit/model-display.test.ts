import { describe, expect, it } from 'vitest';
import {
  CLAUDE_BOUNDARY_PATTERN,
  CLAUDE_DYNAMIC_PATTERN,
  CLAUDE_LEGACY_PATTERN,
  formatModelDisplayName,
  formatTrayClaudeLabel,
  isClaudeModel,
  parseClaudeModel,
  selectBestTrayClaudeModel,
  STATIC_MODEL_DISPLAY_NAMES,
} from '@/modules/cloud-account/utils/model-display';

describe('model-display utility', () => {
  describe('regex patterns', () => {
    it('CLAUDE_DYNAMIC_PATTERN matches standard claude variants', () => {
      expect(CLAUDE_DYNAMIC_PATTERN.test('claude-sonnet-4-6')).toBe(true);
      expect(CLAUDE_DYNAMIC_PATTERN.test('claude-opus-4-6-thinking')).toBe(true);
      expect(CLAUDE_DYNAMIC_PATTERN.test('claude-haiku-4-5')).toBe(true);
      expect(CLAUDE_DYNAMIC_PATTERN.test('gemini-3-flash')).toBe(false);
    });

    it('CLAUDE_LEGACY_PATTERN matches legacy versioned claude', () => {
      expect(CLAUDE_LEGACY_PATTERN.test('claude-3-7-sonnet')).toBe(true);
      expect(CLAUDE_LEGACY_PATTERN.test('claude-3-5-sonnet-thinking')).toBe(true);
      expect(CLAUDE_LEGACY_PATTERN.test('claude-sonnet-4-6')).toBe(false);
    });

    it('CLAUDE_BOUNDARY_PATTERN matches boundary delimited claude', () => {
      expect(CLAUDE_BOUNDARY_PATTERN.test('claude-sonnet-4-6')).toBe(true);
      expect(CLAUDE_BOUNDARY_PATTERN.test('models/claude-opus-4-6')).toBe(true);
      expect(CLAUDE_BOUNDARY_PATTERN.test('my_claude_model')).toBe(true);
      expect(CLAUDE_BOUNDARY_PATTERN.test('enclave')).toBe(false);
      expect(CLAUDE_BOUNDARY_PATTERN.test('declauder')).toBe(false);
    });
  });

  describe('isClaudeModel', () => {
    it('returns true for Claude model identifiers', () => {
      expect(isClaudeModel('claude-opus-4-6')).toBe(true);
      expect(isClaudeModel('models/claude-sonnet-4-6')).toBe(true);
      expect(isClaudeModel('claude-haiku-4-5-thinking')).toBe(true);
      expect(isClaudeModel('custom-claude-test')).toBe(true);
    });

    it('returns false for non-Claude or invalid inputs', () => {
      expect(isClaudeModel('gemini-3-flash')).toBe(false);
      expect(isClaudeModel('enclave-box')).toBe(false);
      expect(isClaudeModel('')).toBe(false);
      expect(isClaudeModel(null as unknown as string)).toBe(false);
      expect(isClaudeModel(undefined as unknown as string)).toBe(false);
    });
  });

  describe('parseClaudeModel', () => {
    it('parses dynamic pattern successfully', () => {
      const parsed = parseClaudeModel('claude-opus-4-6-thinking');
      expect(parsed).toEqual({
        variant: 'Opus',
        major: '4',
        minor: '6',
        isThinking: true,
        raw: 'claude-opus-4-6-thinking',
      });
    });

    it('parses legacy pattern successfully', () => {
      const parsed = parseClaudeModel('models/claude-3-7-sonnet');
      expect(parsed).toEqual({
        variant: 'Sonnet',
        major: '3',
        minor: '7',
        isThinking: false,
        raw: 'claude-3-7-sonnet',
      });
    });

    it('returns null for non-matching or invalid input', () => {
      expect(parseClaudeModel('gemini-3-flash')).toBeNull();
      expect(parseClaudeModel('')).toBeNull();
      expect(parseClaudeModel(null as unknown as string)).toBeNull();
    });
  });

  describe('formatModelDisplayName', () => {
    it('honors non-empty apiDisplayName with highest precedence', () => {
      expect(formatModelDisplayName('claude-opus-4-6', 'Claude 4.6 Opus Upstream')).toBe(
        'Claude 4.6 Opus Upstream',
      );
      expect(formatModelDisplayName('models/claude-sonnet-4-6', 'Sonnet Flagship')).toBe(
        'Sonnet Flagship',
      );
    });

    it('ignores whitespace-only apiDisplayName and falls back to dynamic formatting', () => {
      expect(formatModelDisplayName('models/claude-opus-4-6', '  ')).toBe('Claude 4.6 Opus');
      expect(formatModelDisplayName('claude-opus-4-6', '')).toBe('Claude 4.6 Opus');
    });

    it('strips leading models/ prefix', () => {
      expect(formatModelDisplayName('models/claude-opus-4-6')).toBe('Claude 4.6 Opus');
      expect(formatModelDisplayName('models/claude-sonnet-4-5-thinking')).toBe(
        'Claude 4.5 Sonnet (Thinking)',
      );
    });

    it('formats canonical Claude model identifiers correctly', () => {
      expect(formatModelDisplayName('claude-opus-4-6', 'Claude 4.6 Opus')).toBe(
        'Claude 4.6 Opus',
      );
      expect(formatModelDisplayName('models/claude-opus-4-6')).toBe('Claude 4.6 Opus');
      expect(formatModelDisplayName('claude-opus-4-6')).toBe('Claude 4.6 Opus');
      expect(formatModelDisplayName('claude-opus-4-6-thinking')).toBe(
        'Claude 4.6 Opus (Thinking)',
      );
      expect(formatModelDisplayName('claude-sonnet-4-5')).toBe('Claude 4.5 Sonnet');
      expect(formatModelDisplayName('claude-sonnet-4-5-thinking')).toBe(
        'Claude 4.5 Sonnet (Thinking)',
      );
      expect(formatModelDisplayName('claude-haiku-4-5')).toBe('Claude 4.5 Haiku');
      expect(formatModelDisplayName('claude-opus-5-5')).toBe('Claude 5.5 Opus');
    });

    it('preserves known static Gemini and legacy models', () => {
      expect(formatModelDisplayName('gemini-3.1-pro-preview')).toBe('Gemini 3.1 Pro Preview');
      expect(formatModelDisplayName('gemini-3-flash')).toBe('Gemini 3 Flash');
      expect(formatModelDisplayName('claude-3-5-sonnet')).toBe('Claude 3.5 Sonnet');
      expect(formatModelDisplayName('gpt-oss-120b')).toBe('GPT OSS 120B');
    });

    it('falls back to capitalized hyphen-to-space formatting for unknown models', () => {
      expect(formatModelDisplayName('custom-gpt-model')).toBe('Custom Gpt Model');
      expect(formatModelDisplayName('an-unknown-ai')).toBe('an Unknown ai');
    });

    it('handles empty or non-string modelName safely', () => {
      expect(formatModelDisplayName('')).toBe('');
      expect(formatModelDisplayName(null as unknown as string)).toBe('');
      expect(formatModelDisplayName(undefined as unknown as string)).toBe('');
    });
  });

  describe('formatTrayClaudeLabel', () => {
    it('drops Sonnet variant for concise tray width', () => {
      expect(formatTrayClaudeLabel('claude-sonnet-4-6')).toBe('Claude 4.6:');
      expect(formatTrayClaudeLabel('claude-sonnet-4-5')).toBe('Claude 4.5:');
      expect(formatTrayClaudeLabel('claude-sonnet-4-6-thinking')).toBe('Claude 4.6:');
      expect(formatTrayClaudeLabel('models/claude-sonnet-4-6')).toBe('Claude 4.6:');
      expect(formatTrayClaudeLabel('claude-3-7-sonnet')).toBe('Claude 3.7:');
    });

    it('retains Opus and Haiku variants in tray labels', () => {
      expect(formatTrayClaudeLabel('claude-opus-4-6')).toBe('Claude 4.6 Opus:');
      expect(formatTrayClaudeLabel('claude-opus-4-6-thinking')).toBe('Claude 4.6 Opus:');
      expect(formatTrayClaudeLabel('claude-haiku-4-5')).toBe('Claude 4.5 Haiku:');
      expect(formatTrayClaudeLabel('claude-haiku-4-5-thinking')).toBe('Claude 4.5 Haiku:');
    });

    it('extracts version and variant from apiDisplayName when modelId is unparsed', () => {
      expect(
        formatTrayClaudeLabel('custom-claude', 'Claude 4.6 Opus (Thinking)'),
      ).toBe('Claude 4.6 Opus:');
      expect(
        formatTrayClaudeLabel('custom-claude', 'Claude 4.6 Sonnet'),
      ).toBe('Claude 4.6:');
      expect(
        formatTrayClaudeLabel('custom-claude', 'Claude 4.5'),
      ).toBe('Claude 4.5:');
    });

    it('falls back to Claude: when no version can be resolved', () => {
      expect(formatTrayClaudeLabel('claude-custom-unknown')).toBe('Claude:');
      expect(formatTrayClaudeLabel('')).toBe('Claude:');
    });
  });

  describe('selectBestTrayClaudeModel', () => {
    it('returns null for null, undefined, or empty models', () => {
      expect(selectBestTrayClaudeModel(null)).toBeNull();
      expect(selectBestTrayClaudeModel(undefined)).toBeNull();
      expect(selectBestTrayClaudeModel({})).toBeNull();
      expect(
        selectBestTrayClaudeModel({
          'gemini-3-flash': { percentage: 100 },
        }),
      ).toBeNull();
    });

    it('prioritizes Opus over Sonnet and Haiku', () => {
      const models = {
        'claude-haiku-4-5': { percentage: 50 },
        'claude-sonnet-4-6': { percentage: 90 },
        'claude-opus-4-6': { percentage: 80 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('claude-opus-4-6');
      expect(best?.percentage).toBe(80);
    });

    it('prioritizes Sonnet over Haiku', () => {
      const models = {
        'claude-haiku-4-5': { percentage: 50 },
        'claude-sonnet-4-5': { percentage: 70 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('claude-sonnet-4-5');
      expect(best?.percentage).toBe(70);
    });

    it('prefers non-thinking base model over thinking variant within same tier regardless of map order', () => {
      const models1 = {
        'claude-opus-4-6-thinking': { percentage: 80 },
        'claude-opus-4-6': { percentage: 85 },
      };
      expect(selectBestTrayClaudeModel(models1)?.key).toBe('claude-opus-4-6');

      const models2 = {
        'claude-opus-4-6': { percentage: 85 },
        'claude-opus-4-6-thinking': { percentage: 80 },
      };
      expect(selectBestTrayClaudeModel(models2)?.key).toBe('claude-opus-4-6');
    });

    it('prefers higher version when variants are identical', () => {
      const models = {
        'claude-opus-4-5': { percentage: 60 },
        'claude-opus-4-6': { percentage: 90 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('claude-opus-4-6');
    });

    it('picks available thinking model if only thinking model is available', () => {
      const models = {
        'claude-opus-4-6-thinking': { percentage: 85 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('claude-opus-4-6-thinking');
      expect(best?.percentage).toBe(85);
    });

    it('handles models with prefix models/', () => {
      const models = {
        'models/claude-opus-4-6': { percentage: 90 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('models/claude-opus-4-6');
      expect(best?.percentage).toBe(90);
    });

    it('breaks ties using thinking status when versions are identical', () => {
      const models = {
        'claude-sonnet-4-6-thinking': { percentage: 90 },
        'claude-sonnet-4-6': { percentage: 90 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('claude-sonnet-4-6');
    });

    it('handles tie breaking when unversioned models have thinking variants', () => {
      const models = {
        'claude-custom-thinking': { percentage: 40 },
        'claude-custom': { percentage: 40 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('claude-custom');
    });

    it('uses fallback priority 0 for unclassified Claude variants', () => {
      const models = {
        'claude-beta': { percentage: 40 },
        'claude-alpha': { percentage: 30 },
      };
      const best = selectBestTrayClaudeModel(models);
      expect(best?.key).toBe('claude-alpha');
    });
  });
});
