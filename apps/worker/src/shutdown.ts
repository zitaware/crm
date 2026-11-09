import type { Logger } from '@zitaware/config';

// Slightly under PM2's 30s kill_timeout for the worker process
// (ecosystem.config.cjs), so we exit voluntarily before PM2 force-kills.
const SHUTDOWN_BUDGET_MS = 25_000;

export function registerGracefulShutdown(logger: Logger, cleanup: () => Promise<void>) {
  let shuttingDown = false;

  async function handleSignal(signal: NodeJS.Signals) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('worker.shutdown_started', { signal });

    const timeout = setTimeout(() => {
      logger.error('worker.shutdown_timed_out', { signal });
      process.exit(1);
    }, SHUTDOWN_BUDGET_MS);

    try {
      await cleanup();
      clearTimeout(timeout);
      logger.info('worker.shutdown_complete', { signal });
      process.exit(0);
    } catch (error) {
      clearTimeout(timeout);
      logger.error('worker.shutdown_failed', { error });
      process.exit(1);
    }
  }

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}
