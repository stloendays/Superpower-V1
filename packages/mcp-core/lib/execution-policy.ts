export type ToolRisk = 'low' | 'medium' | 'high' | 'critical';
export type ExecutionPolicyMode = 'audit' | 'guarded';
export type ExecutionDecision = 'allow' | 'confirm';

export interface ExecutionPolicyResult {
  decision: ExecutionDecision;
  risk: ToolRisk;
  reasons: string[];
  sensitiveArgumentKeys: string[];
}

const DESTRUCTIVE_PATTERNS = [
  /(^|[_\-.])(delete|destroy|drop|truncate|purge|erase|wipe|revoke|terminate|kill)([_\-.]|$)/i,
  /remove[_\-.]?(all|account|repo|repository|database|table|file|folder)/i,
  /force[_\-.]?(push|delete|reset)/i,
];

const WRITE_PATTERNS = [
  /(^|[_\-.])(create|update|edit|write|save|send|submit|post|upload|move|rename|merge|deploy|publish|install)([_\-.]|$)/i,
  /add[_\-.]?(comment|review|label|member|file)/i,
];

const EXTERNAL_SIDE_EFFECT_PATTERNS = [
  /(email|mail|message|slack|sms|notification)/i,
  /(deploy|publish|release|merge|payment|purchase|order)/i,
];

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /credential/i,
  /authorization/i,
  /cookie/i,
];

const collectArgumentKeys = (value: unknown, prefix = '', depth = 0): string[] => {
  if (!value || typeof value !== 'object' || depth > 3) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectArgumentKeys(item, `${prefix}[${index}]`, depth + 1));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...collectArgumentKeys(child, path, depth + 1)];
  });
};

/**
 * Value-blind execution risk classifier. It only uses tool metadata and argument key
 * names, so callers can classify actions without persisting payload values.
 */
export const evaluateToolExecution = (
  toolName: string,
  args: Record<string, unknown> = {},
  description = '',
  mode: ExecutionPolicyMode = 'audit',
): ExecutionPolicyResult => {
  const searchable = `${toolName} ${description}`;
  const argumentKeys = collectArgumentKeys(args);
  const sensitiveArgumentKeys = argumentKeys.filter(key => SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key)));
  const destructive = DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(searchable));
  const writes = WRITE_PATTERNS.some(pattern => pattern.test(searchable));
  const externalSideEffect = EXTERNAL_SIDE_EFFECT_PATTERNS.some(pattern => pattern.test(searchable));
  const reasons: string[] = [];

  let risk: ToolRisk = 'low';

  if (writes) {
    risk = 'medium';
    reasons.push('tool can modify state');
  }

  if (externalSideEffect) {
    risk = 'high';
    reasons.push('tool can cause an external side effect');
  }

  if (destructive) {
    risk = 'critical';
    reasons.push('tool appears destructive or irreversible');
  }

  if (sensitiveArgumentKeys.length > 0) {
    reasons.push('arguments include sensitive-looking fields');
    if (risk === 'low') risk = 'medium';
  }

  if (reasons.length === 0) reasons.push('read-only or no side effect detected');

  const requiresConfirmation = mode === 'guarded' && (risk === 'high' || risk === 'critical');
  return {
    decision: requiresConfirmation ? 'confirm' : 'allow',
    risk,
    reasons,
    sensitiveArgumentKeys,
  };
};
