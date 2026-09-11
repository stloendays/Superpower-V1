export interface ContextBudgetConfig {
  /** Hard ceiling for generated MCP instructions. */
  maxInstructionChars: number;
  /** Maximum number of tool definitions injected when no tighter router limit is supplied. */
  maxToolCount: number;
  /** Per-tool ceiling before a schema is reduced to a safe top-level summary. */
  maxToolChars: number;
  /** Maximum custom-instruction payload copied into the generated context. */
  maxCustomInstructionChars: number;
  /** Heuristic used only for UI/reporting; it is not a tokenizer. */
  charsPerEstimatedToken: number;
}

export interface ContextBudgetReport {
  chars: number;
  estimatedTokens: number;
  utilization: number;
  withinBudget: boolean;
}

export const DEFAULT_CONTEXT_BUDGET: Readonly<ContextBudgetConfig> = Object.freeze({
  maxInstructionChars: 24_000,
  maxToolCount: 24,
  maxToolChars: 1_800,
  maxCustomInstructionChars: 4_000,
  charsPerEstimatedToken: 4,
});

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const resolveContextBudget = (overrides: Partial<ContextBudgetConfig> = {}): ContextBudgetConfig => {
  const resolved = { ...DEFAULT_CONTEXT_BUDGET };

  if (isPositiveFiniteNumber(overrides.maxInstructionChars)) resolved.maxInstructionChars = overrides.maxInstructionChars;
  if (isPositiveFiniteNumber(overrides.maxToolCount)) resolved.maxToolCount = Math.floor(overrides.maxToolCount);
  if (isPositiveFiniteNumber(overrides.maxToolChars)) resolved.maxToolChars = overrides.maxToolChars;
  if (isPositiveFiniteNumber(overrides.maxCustomInstructionChars)) {
    resolved.maxCustomInstructionChars = overrides.maxCustomInstructionChars;
  }
  if (isPositiveFiniteNumber(overrides.charsPerEstimatedToken)) {
    resolved.charsPerEstimatedToken = overrides.charsPerEstimatedToken;
  }

  return resolved;
};

export const estimateTokens = (text: string, charsPerToken = DEFAULT_CONTEXT_BUDGET.charsPerEstimatedToken): number => {
  if (!text) return 0;
  const divisor = Math.max(1, charsPerToken);
  return Math.ceil(text.length / divisor);
};

/**
 * Truncate free-form text at a word boundary. This is intentionally not used on
 * serialized JSON/CSN schemas because cutting structured syntax in the middle can
 * make the model infer invalid parameters.
 */
export const truncateFreeText = (text: string, maxChars: number): string => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return '…'.slice(0, maxChars);

  const candidate = normalized.slice(0, maxChars - 1);
  const boundary = candidate.lastIndexOf(' ');
  const safe = boundary > Math.floor(maxChars * 0.65) ? candidate.slice(0, boundary) : candidate;
  return `${safe.trimEnd()}…`;
};

export const getContextBudgetReport = (
  text: string,
  config: Partial<ContextBudgetConfig> = {},
): ContextBudgetReport => {
  const resolved = resolveContextBudget(config);
  const chars = text.length;
  return {
    chars,
    estimatedTokens: estimateTokens(text, resolved.charsPerEstimatedToken),
    utilization: chars / resolved.maxInstructionChars,
    withinBudget: chars <= resolved.maxInstructionChars,
  };
};
