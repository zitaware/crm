import type { LoggerService } from '@nestjs/common';
import { createLogger } from '@zitaware/config';

const logger = createLogger({ service: 'api' });

/**
 * Routes Nest's own framework logging (bootstrap, route mapping, etc.)
 * through the shared structured logger via app.useLogger(...), so no Nest
 * internal log bypasses redaction (docs/02, docs/14).
 */
export class NestStructuredLogger implements LoggerService {
  log(message: unknown, context?: string) {
    logger.info('nest.log', { message, context });
  }

  error(message: unknown, trace?: string, context?: string) {
    logger.error('nest.error', { message, trace, context });
  }

  warn(message: unknown, context?: string) {
    logger.warn('nest.warn', { message, context });
  }

  debug(message: unknown, context?: string) {
    logger.info('nest.debug', { message, context });
  }

  verbose(message: unknown, context?: string) {
    logger.info('nest.verbose', { message, context });
  }
}
