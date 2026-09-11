/**
 * Core Architecture Components
 *
 * Exports all core architectural components for Superpower.
 */

export { circuitBreaker, CircuitBreaker } from './circuit-breaker';
export type { CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerStats } from './circuit-breaker';

export { contextBridge, ContextBridge } from './context-bridge';
export type { ContextMessage, ContextBridgeConfig } from './context-bridge';

export { globalErrorHandler, GlobalErrorHandler } from './error-handler';
export type { ErrorContext, ErrorReport } from './error-handler';

export { performanceMonitor, PerformanceMonitor } from './performance';
export type { PerformanceMeasurement, MemoryUsage, PerformanceStats } from './performance';

export {
  DEFAULT_CONTEXT_BUDGET,
  estimateTokens,
  getContextBudgetReport,
  resolveContextBudget,
  truncateFreeText,
} from './context-budget';
export type { ContextBudgetConfig, ContextBudgetReport } from './context-budget';

export { routeTools } from './tool-router';
export type { RankedTool, RoutableTool, ToolRouteResult, ToolRouterOptions } from './tool-router';

export { evaluateToolExecution } from './execution-policy';
export type { ExecutionDecision, ExecutionPolicyMode, ExecutionPolicyResult, ToolRisk } from './execution-policy';

export { mcpTelemetry, McpTelemetry } from './mcp-telemetry';
export type {
  McpTelemetryPendingCall,
  McpTelemetryRecord,
  McpTelemetryStatus,
  McpTelemetrySummary,
} from './mcp-telemetry';

// Main initialization system (Session 10)
export {
  applicationInit,
  applicationCleanup,
  getInitializationStatus,
  forceReinitialization,
  initializationUtils,
} from './main-initializer';

// UI initialization utilities
export {
  initializeUIApplication,
  initializePopupApp,
  initializeOptionsApp,
  setupUICleanup,
  setupPopupApp,
  setupOptionsApp,
} from './ui-initializer';

// Import for default export
import { circuitBreaker } from './circuit-breaker';
import { contextBridge } from './context-bridge';
import { globalErrorHandler } from './error-handler';
import { performanceMonitor } from './performance';
import { mcpTelemetry } from './mcp-telemetry';

// Re-export default instances for convenience
export default {
  circuitBreaker,
  contextBridge,
  globalErrorHandler,
  performanceMonitor,
  mcpTelemetry,
};
