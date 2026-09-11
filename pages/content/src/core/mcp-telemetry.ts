import type { ToolRisk } from './execution-policy';

export type McpTelemetryStatus = 'success' | 'error';

export interface McpTelemetryRecord {
  id: string;
  toolName: string;
  adapterName: string;
  startedAt: number;
  durationMs: number;
  status: McpTelemetryStatus;
  risk: ToolRisk;
  argumentKeys: string[];
  resultChars?: number;
  errorKind?: string;
}

export interface McpTelemetrySummary {
  calls: number;
  successes: number;
  errors: number;
  successRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
  callsByRisk: Record<ToolRisk, number>;
  callsByTool: Record<string, number>;
}

export interface McpTelemetryPendingCall {
  id: string;
  toolName: string;
  adapterName: string;
  startedAt: number;
  risk: ToolRisk;
  argumentKeys: string[];
}

const getSerializedLength = (value: unknown): number => {
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

const getErrorKind = (error: unknown): string => {
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
};

/**
 * Session-local MCP telemetry. Payload values and tool results are deliberately not
 * retained: only names, argument keys, sizes, timings and status are recorded.
 */
class McpTelemetry {
  private records: McpTelemetryRecord[] = [];
  private readonly maxRecords = 300;

  begin(
    toolName: string,
    adapterName: string,
    risk: ToolRisk,
    args: Record<string, unknown>,
  ): McpTelemetryPendingCall {
    return {
      id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      toolName,
      adapterName,
      startedAt: Date.now(),
      risk,
      argumentKeys: Object.keys(args).sort(),
    };
  }

  success(call: McpTelemetryPendingCall, result: unknown): McpTelemetryRecord {
    return this.complete(call, 'success', {
      resultChars: getSerializedLength(result),
    });
  }

  error(call: McpTelemetryPendingCall, error: unknown): McpTelemetryRecord {
    return this.complete(call, 'error', {
      errorKind: getErrorKind(error),
    });
  }

  private complete(
    call: McpTelemetryPendingCall,
    status: McpTelemetryStatus,
    extra: Pick<McpTelemetryRecord, 'resultChars' | 'errorKind'>,
  ): McpTelemetryRecord {
    const record: McpTelemetryRecord = {
      id: call.id,
      toolName: call.toolName,
      adapterName: call.adapterName,
      startedAt: call.startedAt,
      durationMs: Math.max(0, Date.now() - call.startedAt),
      status,
      risk: call.risk,
      argumentKeys: call.argumentKeys,
      ...extra,
    };

    this.records.push(record);
    if (this.records.length > this.maxRecords) this.records.shift();
    return record;
  }

  getRecords(): McpTelemetryRecord[] {
    return this.records.map(record => ({ ...record, argumentKeys: [...record.argumentKeys] }));
  }

  getSummary(): McpTelemetrySummary {
    const calls = this.records.length;
    const successes = this.records.filter(record => record.status === 'success').length;
    const errors = calls - successes;
    const durations = this.records.map(record => record.durationMs).sort((a, b) => a - b);
    const p95Index =
      durations.length > 0 ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : 0;
    const callsByRisk: Record<ToolRisk, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const callsByTool: Record<string, number> = {};

    this.records.forEach(record => {
      callsByRisk[record.risk] += 1;
      callsByTool[record.toolName] = (callsByTool[record.toolName] ?? 0) + 1;
    });

    return {
      calls,
      successes,
      errors,
      successRate: calls > 0 ? successes / calls : 1,
      averageDurationMs: calls > 0 ? durations.reduce((sum, value) => sum + value, 0) / calls : 0,
      p95DurationMs: durations.length > 0 ? durations[p95Index] : 0,
      callsByRisk,
      callsByTool,
    };
  }

  clear(): void {
    this.records = [];
  }
}

export const mcpTelemetry = new McpTelemetry();
export { McpTelemetry };
