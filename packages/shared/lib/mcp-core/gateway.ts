import {
  DEFAULT_CONTEXT_BUDGET,
  resolveContextBudget,
  type ContextBudgetConfig,
} from './context-budget.js';
import {
  evaluateToolExecution,
  type ExecutionPolicyMode,
  type ExecutionPolicyResult,
} from './execution-policy.js';
import { McpTelemetry, type McpTelemetryRecord, type McpTelemetrySummary } from './mcp-telemetry.js';
import { routeTools, type RoutableTool, type ToolRouteResult, type ToolRouterOptions } from './tool-router.js';

export interface McpGatewayTransport<TTool extends RoutableTool = RoutableTool> {
  /** Stable adapter label used for local telemetry. */
  adapterName: string;
  listTools(): Promise<TTool[]>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface McpGatewayConfirmationContext {
  toolName: string;
  args: Record<string, unknown>;
  policy: ExecutionPolicyResult;
}

export type McpGatewayConfirmationHandler = (
  context: McpGatewayConfirmationContext,
) => boolean | Promise<boolean>;

export interface McpGatewayOptions {
  taskFocus?: string;
  router?: ToolRouterOptions;
  contextBudget?: Partial<ContextBudgetConfig>;
  policyMode?: ExecutionPolicyMode;
  confirm?: McpGatewayConfirmationHandler;
  telemetry?: McpTelemetry;
}

export class McpGatewayConfirmationRequiredError extends Error {
  constructor(public readonly policy: ExecutionPolicyResult) {
    super('This MCP action requires confirmation before execution.');
    this.name = 'McpGatewayConfirmationRequiredError';
  }
}

export class McpGatewayRejectedError extends Error {
  constructor(public readonly policy: ExecutionPolicyResult) {
    super('This MCP action was rejected by the confirmation handler.');
    this.name = 'McpGatewayRejectedError';
  }
}

/**
 * Browser-agnostic orchestration layer between an AI client and any MCP transport.
 *
 * The gateway owns routing, budget configuration, execution policy and privacy-safe
 * telemetry. Browser DOM integration and concrete MCP transport remain adapters.
 */
export class McpGateway<TTool extends RoutableTool = RoutableTool> {
  private taskFocus: string;
  private policyMode: ExecutionPolicyMode;
  private readonly routerOptions: ToolRouterOptions;
  private readonly contextBudget: ContextBudgetConfig;
  private readonly telemetry: McpTelemetry;
  private readonly confirm?: McpGatewayConfirmationHandler;

  constructor(
    private readonly transport: McpGatewayTransport<TTool>,
    options: McpGatewayOptions = {},
  ) {
    this.taskFocus = options.taskFocus ?? '';
    this.policyMode = options.policyMode ?? 'audit';
    this.routerOptions = { ...options.router };
    this.contextBudget = resolveContextBudget(options.contextBudget);
    this.telemetry = options.telemetry ?? new McpTelemetry();
    this.confirm = options.confirm;
  }

  setTaskFocus(taskFocus: string): void {
    this.taskFocus = taskFocus.trim();
  }

  getTaskFocus(): string {
    return this.taskFocus;
  }

  setPolicyMode(mode: ExecutionPolicyMode): void {
    this.policyMode = mode;
  }

  getPolicyMode(): ExecutionPolicyMode {
    return this.policyMode;
  }

  getContextBudget(): ContextBudgetConfig {
    return { ...this.contextBudget };
  }

  routeCatalog(tools: TTool[]): ToolRouteResult<TTool> {
    return routeTools(tools, this.taskFocus, {
      ...this.routerOptions,
      maxTools: this.routerOptions.maxTools ?? this.contextBudget.maxToolCount ?? DEFAULT_CONTEXT_BUDGET.maxToolCount,
    });
  }

  async listTools(): Promise<ToolRouteResult<TTool>> {
    return this.routeCatalog(await this.transport.listTools());
  }

  evaluate(toolName: string, args: Record<string, unknown> = {}, description = ''): ExecutionPolicyResult {
    return evaluateToolExecution(toolName, args, description, this.policyMode);
  }

  async callTool(toolName: string, args: Record<string, unknown> = {}, description = ''): Promise<unknown> {
    const policy = this.evaluate(toolName, args, description);

    if (policy.decision === 'confirm') {
      if (!this.confirm) throw new McpGatewayConfirmationRequiredError(policy);
      const confirmed = await this.confirm({ toolName, args, policy });
      if (!confirmed) throw new McpGatewayRejectedError(policy);
    }

    const pending = this.telemetry.begin(toolName, this.transport.adapterName, policy.risk, args);
    try {
      const result = await this.transport.callTool(toolName, args);
      this.telemetry.success(pending, result);
      return result;
    } catch (error) {
      this.telemetry.error(pending, error);
      throw error;
    }
  }

  getTelemetryRecords(): McpTelemetryRecord[] {
    return this.telemetry.getRecords();
  }

  getTelemetrySummary(): McpTelemetrySummary {
    return this.telemetry.getSummary();
  }

  clearTelemetry(): void {
    this.telemetry.clear();
  }
}
