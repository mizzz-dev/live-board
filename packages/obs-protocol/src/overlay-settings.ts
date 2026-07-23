export type BroadcastOverlayTheme = 'transparent' | 'whiteboard' | 'blackboard';
export type BroadcastPreset =
  | 'simple'
  | 'illustration'
  | 'whiteboard'
  | 'blackboard'
  | 'obs-priority';
export type BroadcastPerformanceMode = 'balanced' | 'obs-priority';

export type BroadcastOverlayTransition =
  | { type: 'none'; durationMs: 0 }
  | { type: 'fade'; durationMs: number };

export interface BroadcastOverlaySettings {
  preset: BroadcastPreset;
  theme: BroadcastOverlayTheme;
  transition: BroadcastOverlayTransition;
  performanceMode: BroadcastPerformanceMode;
  customCss: string;
  customCssEnabled: boolean;
  customCssFallback: boolean;
}

export interface OverlayCssSanitizeResult {
  accepted: boolean;
  css: string;
  reason: string | null;
}

export const MAX_OVERLAY_CUSTOM_CSS_LENGTH = 20_000;

export const DEFAULT_BROADCAST_OVERLAY_SETTINGS: Readonly<BroadcastOverlaySettings> =
  Object.freeze({
    preset: 'simple',
    theme: 'transparent',
    transition: Object.freeze({ type: 'fade', durationMs: 120 }),
    performanceMode: 'balanced',
    customCss: '',
    customCssEnabled: false,
    customCssFallback: false,
  });

const PRESET_SETTINGS: Readonly<Record<BroadcastPreset, BroadcastOverlaySettings>> =
  Object.freeze({
    simple: {
      preset: 'simple',
      theme: 'transparent',
      transition: { type: 'fade', durationMs: 120 },
      performanceMode: 'balanced',
      customCss: '',
      customCssEnabled: false,
      customCssFallback: false,
    },
    illustration: {
      preset: 'illustration',
      theme: 'transparent',
      transition: { type: 'fade', durationMs: 180 },
      performanceMode: 'balanced',
      customCss: '',
      customCssEnabled: false,
      customCssFallback: false,
    },
    whiteboard: {
      preset: 'whiteboard',
      theme: 'whiteboard',
      transition: { type: 'fade', durationMs: 100 },
      performanceMode: 'balanced',
      customCss: '',
      customCssEnabled: false,
      customCssFallback: false,
    },
    blackboard: {
      preset: 'blackboard',
      theme: 'blackboard',
      transition: { type: 'fade', durationMs: 100 },
      performanceMode: 'balanced',
      customCss: '',
      customCssEnabled: false,
      customCssFallback: false,
    },
    'obs-priority': {
      preset: 'obs-priority',
      theme: 'transparent',
      transition: { type: 'none', durationMs: 0 },
      performanceMode: 'obs-priority',
      customCss: '',
      customCssEnabled: false,
      customCssFallback: false,
    },
  });

const FORBIDDEN_CSS_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /@import\b/i, reason: '@importは利用できません' },
  { pattern: /@font-face\b/i, reason: '@font-faceは利用できません' },
  { pattern: /@namespace\b/i, reason: '@namespaceは利用できません' },
  { pattern: /<\/?style\b/i, reason: 'styleタグ断片は利用できません' },
  { pattern: /url\s*\(/i, reason: 'url()は利用できません' },
  { pattern: /expression\s*\(/i, reason: 'expression()は利用できません' },
  { pattern: /(?:javascript|data|file|ftp|https?):\s*/i, reason: '外部schemeは利用できません' },
  { pattern: /(?:^|[\s{;])behavior\s*:/i, reason: 'behaviorは利用できません' },
  { pattern: /-moz-binding\s*:/i, reason: '-moz-bindingは利用できません' },
  { pattern: /\\(?:2f|5c)\s*/i, reason: 'エスケープされたパス指定は利用できません' },
];

export function sanitizeOverlayCustomCss(input: unknown): OverlayCssSanitizeResult {
  if (typeof input !== 'string') {
    return { accepted: false, css: '', reason: 'CSSは文字列で指定してください' };
  }
  const css = input.trim();
  if (css.length === 0) {
    return { accepted: true, css: '', reason: null };
  }
  if (css.length > MAX_OVERLAY_CUSTOM_CSS_LENGTH) {
    return {
      accepted: false,
      css: '',
      reason: `CSSは${MAX_OVERLAY_CUSTOM_CSS_LENGTH.toLocaleString()}文字以内で指定してください`,
    };
  }
  for (const forbidden of FORBIDDEN_CSS_PATTERNS) {
    if (forbidden.pattern.test(css)) {
      return { accepted: false, css: '', reason: forbidden.reason };
    }
  }
  if (css.includes('@')) {
    return { accepted: false, css: '', reason: 'CSSの@ルールは利用できません' };
  }
  if (!hasBalancedCssSyntax(css)) {
    return { accepted: false, css: '', reason: 'CSSの括弧・引用符が閉じられていません' };
  }
  return { accepted: true, css, reason: null };
}

export function applyBroadcastPreset(
  preset: BroadcastPreset,
): BroadcastOverlaySettings {
  return cloneSettings(PRESET_SETTINGS[preset]);
}

export function parseBroadcastOverlaySettings(
  input: unknown,
): BroadcastOverlaySettings {
  if (!isRecord(input)) return cloneSettings(DEFAULT_BROADCAST_OVERLAY_SETTINGS);

  const preset = isBroadcastPreset(input.preset) ? input.preset : 'simple';
  const base = applyBroadcastPreset(preset);
  const theme = isBroadcastOverlayTheme(input.theme) ? input.theme : base.theme;
  const performanceMode = isBroadcastPerformanceMode(input.performanceMode)
    ? input.performanceMode
    : base.performanceMode;
  const transition = parseTransition(input.transition, base.transition);
  const customCssEnabled = input.customCssEnabled === true;
  const sanitized = sanitizeOverlayCustomCss(input.customCss ?? '');
  const customCssFallback = customCssEnabled && !sanitized.accepted;

  return {
    preset,
    theme,
    transition,
    performanceMode,
    customCss: sanitized.accepted ? sanitized.css : '',
    customCssEnabled:
      customCssEnabled && sanitized.accepted && sanitized.css.length > 0,
    customCssFallback,
  };
}

export function isBroadcastPreset(value: unknown): value is BroadcastPreset {
  return (
    value === 'simple' ||
    value === 'illustration' ||
    value === 'whiteboard' ||
    value === 'blackboard' ||
    value === 'obs-priority'
  );
}

export function isBroadcastOverlayTheme(
  value: unknown,
): value is BroadcastOverlayTheme {
  return value === 'transparent' || value === 'whiteboard' || value === 'blackboard';
}

function isBroadcastPerformanceMode(
  value: unknown,
): value is BroadcastPerformanceMode {
  return value === 'balanced' || value === 'obs-priority';
}

function parseTransition(
  input: unknown,
  fallback: BroadcastOverlayTransition,
): BroadcastOverlayTransition {
  if (!isRecord(input)) return { ...fallback };
  if (input.type === 'none' && input.durationMs === 0) {
    return { type: 'none', durationMs: 0 };
  }
  if (
    input.type === 'fade' &&
    typeof input.durationMs === 'number' &&
    Number.isInteger(input.durationMs) &&
    input.durationMs >= 0 &&
    input.durationMs <= 2_000
  ) {
    return { type: 'fade', durationMs: input.durationMs };
  }
  return { ...fallback };
}

function hasBalancedCssSyntax(css: string): boolean {
  let braces = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let inComment = false;

  for (let index = 0; index < css.length; index += 1) {
    const current = css[index]!;
    const next = css[index + 1];

    if (inComment) {
      if (current === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === quote) {
        quote = null;
      }
      continue;
    }
    if (current === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === '{') {
      braces += 1;
      if (braces > 16) return false;
    } else if (current === '}') {
      braces -= 1;
      if (braces < 0) return false;
    }
  }

  return braces === 0 && quote === null && !inComment && !escaped;
}

function cloneSettings(
  settings: Readonly<BroadcastOverlaySettings>,
): BroadcastOverlaySettings {
  return {
    ...settings,
    transition: { ...settings.transition },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
