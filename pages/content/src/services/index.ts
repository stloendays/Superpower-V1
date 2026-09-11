/**
 * Services Index
 *
 * Centralized export point for all application services.
 */

import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('Services Index');

export {
  AutomationService,
  automationService,
  initializeAutomationService,
  cleanupAutomationService,
  type AutomationState,
  type ToolExecutionCompleteDetail,
} from './automation.service';
export { initializeDesktopGuiService, cleanupDesktopGuiService } from './desktop-gui.service';

export async function initializeAllServices(): Promise<void> {
  logger.debug('[Services] Initializing all application services...');

  try {
    const { initializeAutomationService } = await import('./automation.service');
    const { initializeDesktopGuiService } = await import('./desktop-gui.service');

    initializeAutomationService();
    initializeDesktopGuiService();

    logger.debug('[Services] All services initialized successfully');
  } catch (error) {
    logger.error('[Services] Error initializing services:', error);
    throw error;
  }
}

export async function cleanupAllServices(): Promise<void> {
  logger.debug('[Services] Cleaning up all application services...');

  try {
    const { cleanupAutomationService } = await import('./automation.service');
    const { cleanupDesktopGuiService } = await import('./desktop-gui.service');

    cleanupDesktopGuiService();
    cleanupAutomationService();

    logger.debug('[Services] All services cleaned up successfully');
  } catch (error) {
    logger.error('[Services] Error cleaning up services:', error);
  }
}
