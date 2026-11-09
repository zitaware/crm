import { getCorrelationId } from './correlation';
import { redact } from './redact';

export type LogLevel = 'info' | 'warn' | 'error';

export type ServiceName = 'web' | 'api' | 'worker';

export interface LoggerOptions {
  service: ServiceName;
}

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  service: ServiceName;
  environment: string;
  correlationId: string | undefined;
  event: string;
  context: unknown;
}

/**
 * The only place in the codebase allowed to call raw console.* (enforced by
 * the root ESLint no-console rule). Every other module must log through the
 * logger returned here so redaction and structure stay centralized.
 */
export function createLogger({ service }: LoggerOptions) {
  function write(level: LogLevel, event: string, context: unknown = {}) {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      service,
      environment: process.env.NODE_ENV ?? 'development',
      correlationId: getCorrelationId(),
      event,
      context: redact(context),
    };

    const line = JSON.stringify(record);
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    info: (event: string, context?: unknown) => write('info', event, context),
    warn: (event: string, context?: unknown) => write('warn', event, context),
    error: (event: string, context?: unknown) => write('error', event, context),
  };
}

export type Logger = ReturnType<typeof createLogger>;
