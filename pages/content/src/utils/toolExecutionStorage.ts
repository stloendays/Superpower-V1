/**
 * Tool Execution Storage Utility
 *
 * This utility stores information about executed tools including:
 * - URL where tool was executed
 * - Call ID
 * - Execution time
 * - Tool details (server name, tool name)
 *
 * It provides functions for adding new executed tools and retrieving tool execution history.
 */

import { logMessage } from './helpers';

// Storage key for executed tools
const EXECUTED_TOOLS_STORAGE_KEY = 'mcp_executed_tools';

// Maximum number of executed tools to store per URL (to avoid excessive storage use)
const MAX_TOOLS_PER_URL = 100;

// Interface for executed tool information
export interface ExecutedToolInfo {
  callId: string;
  executionTime: number; // timestamp in milliseconds
  toolName: string;
  serverName: string;
  result?: string; // Optional tool execution result
}

// Interface for URL to executed tools mapping
export interface ExecutedToolsMap {
  [url: string]: ExecutedToolInfo[];
}

/**
 * Add an executed tool to storage
 *
 * @param url The URL where the tool was executed
 * @param callId The call ID of the executed tool
 * @param toolName The name of the executed tool
 * @param serverName The server name of the executed tool
 * @param result The execution result (optional)
 * @returns Promise that resolves when the tool is stored
 */
export const addExecutedTool = async (
  url: string,
  callId: string,
  toolName: string,
  serverName: string,
  result?: string,
): Promise<void> => {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      logMessage('[Tool Execution Storage] Chrome storage API not available');
      return;
    }

    // Get current executed tools
    const storageResult = await chrome.storage.local.get(EXECUTED_TOOLS_STORAGE_KEY);
    const executedTools: ExecutedToolsMap = storageResult[EXECUTED_TOOLS_STORAGE_KEY] || {};

    // Initialize array for this URL if it doesn't exist
    if (!executedTools[url]) {
      executedTools[url] = [];
    }

    // Add new tool execution with current timestamp
    const toolInfo: ExecutedToolInfo = {
      callId,
      executionTime: Date.now(),
      toolName,
      serverName,
    };

    // Add result if provided
    if (result !== undefined) {
      toolInfo.result = result;
    }

    // Add to the beginning to keep most recent executions first
    executedTools[url].unshift(toolInfo);

    // Limit the number of stored tools per URL
    if (executedTools[url].length > MAX_TOOLS_PER_URL) {
      executedTools[url] = executedTools[url].slice(0, MAX_TOOLS_PER_URL);
    }

    // Store the updated map
    await chrome.storage.local.set({ [EXECUTED_TOOLS_STORAGE_KEY]: executedTools });
    logMessage(`[Tool Execution Storage] Stored executed tool: ${serverName}.${toolName} (${callId}) for URL: ${url}`);
  } catch (error) {
    logMessage(
      `[Tool Execution Storage] Error storing executed tool: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Get executed tools for a specific URL
 *
 * @param url The URL to get executed tools for
 * @returns Promise that resolves with an array of executed tool information
 */
export const getExecutedToolsForUrl = async (url: string): Promise<ExecutedToolInfo[]> => {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      logMessage('[Tool Execution Storage] Chrome storage API not available');
      return [];
    }

    const result = await chrome.storage.local.get(EXECUTED_TOOLS_STORAGE_KEY);
    const executedTools: ExecutedToolsMap = result[EXECUTED_TOOLS_STORAGE_KEY] || {};

    return executedTools[url] || [];
  } catch (error) {
    logMessage(
      `[Tool Execution Storage] Error retrieving executed tools: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};

/**
 * Get a specific executed tool by URL and callId
 *
 * @param url The URL where the tool was executed
 * @param callId The call ID of the tool
 * @returns Promise that resolves with the executed tool info or null if not found
 */
export const getExecutedToolByCallId = async (url: string, callId: string): Promise<ExecutedToolInfo | null> => {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      logMessage('[Tool Execution Storage] Chrome storage API not available');
      return null;
    }

    const result = await chrome.storage.local.get(EXECUTED_TOOLS_STORAGE_KEY);
    const executedTools: ExecutedToolsMap = result[EXECUTED_TOOLS_STORAGE_KEY] || {};

    if (!executedTools[url]) {
      return null;
    }

    const toolInfo = executedTools[url].find(tool => tool.callId === callId);
    return toolInfo || null;
  } catch (error) {
    logMessage(
      `[Tool Execution Storage] Error retrieving executed tool: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
};

/**
 * Get all executed tools across all URLs
 *
 * @returns Promise that resolves with a map of URLs to executed tool arrays
 */
export const getAllExecutedTools = async (): Promise<ExecutedToolsMap> => {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      logMessage('[Tool Execution Storage] Chrome storage API not available');
      return {};
    }

    const result = await chrome.storage.local.get(EXECUTED_TOOLS_STORAGE_KEY);
    return result[EXECUTED_TOOLS_STORAGE_KEY] || {};
  } catch (error) {
    logMessage(
      `[Tool Execution Storage] Error retrieving all executed tools: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
};

/**
 * Clear executed tools for a specific URL
 *
 * @param url The URL to clear executed tools for
 * @returns Promise that resolves when the tools are cleared
 */
export const clearExecutedToolsForUrl = async (url: string): Promise<void> => {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      logMessage('[Tool Execution Storage] Chrome storage API not available');
      return;
    }

    const result = await chrome.storage.local.get(EXECUTED_TOOLS_STORAGE_KEY);
    const executedTools: ExecutedToolsMap = result[EXECUTED_TOOLS_STORAGE_KEY] || {};

    // Remove the entry for this URL
    if (executedTools[url]) {
      delete executedTools[url];
      await chrome.storage.local.set({ [EXECUTED_TOOLS_STORAGE_KEY]: executedTools });
      logMessage(`[Tool Execution Storage] Cleared executed tools for URL: ${url}`);
    }
  } catch (error) {
    logMessage(
      `[Tool Execution Storage] Error clearing executed tools: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Clear all executed tools across all URLs
 *
 * @returns Promise that resolves when all tools are cleared
 */
export const clearAllExecutedTools = async (): Promise<void> => {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      logMessage('[Tool Execution Storage] Chrome storage API not available');
      return;
    }

    await chrome.storage.local.remove(EXECUTED_TOOLS_STORAGE_KEY);
    logMessage('[Tool Execution Storage] Cleared all executed tools');
  } catch (error) {
    logMessage(
      `[Tool Execution Storage] Error clearing all executed tools: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Check if a tool with the given call ID has been executed on a specific URL
 *
 * @param callId The call ID to check for
 * @param url The specific URL to check for the tool execution
 * @returns Promise that resolves with boolean indicating if the tool has been executed on the specified URL
 */
export const hasToolBeenExecuted = async (callId: string, url: string): Promise<boolean> => {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      logMessage('[Tool Execution Storage] Chrome storage API not available');
      return false;
    }

    const toolsForUrl = await getExecutedToolsForUrl(url);
    return toolsForUrl.some(tool => tool.callId === callId);
  } catch (error) {
    logMessage(
      `[Tool Execution Storage] Error checking if tool was executed on URL ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
};
