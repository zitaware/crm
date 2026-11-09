import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@zitaware/database';
import { createLogger } from '@zitaware/config';

const prisma = new PrismaClient();
const logger = createLogger({ service: 'api' });

@Controller()
export class HealthController {
  @Get('healthz')
  liveness() {
    return { status: 'ok', service: 'api', timestamp: new Date().toISOString() };
  }

  @Get('readyz')
  async readiness() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        service: 'api',
        database: 'reachable',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('readiness.database_unreachable', { error });
      throw new HttpException(
        {
          status: 'error',
          service: 'api',
          database: 'unreachable',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
