import { loadEnv, createLogger, type Env } from '@zitaware/config';
import { createPrismaClient } from '@zitaware/database';
import { createBoss } from './boss';
import { startHealthServer, type WorkerHealthState } from './health';
import { registerGracefulShutdown } from './shutdown';
import { runOutboxDispatchJob } from './outbox-dispatcher';
import { runPaymentAlertOpenerJob } from './payment-alert-opener';
import { runSalaryDraftGeneratorJob } from './salary-draft-generator';
import { FakeNotificationProvider } from './notification-providers/fake.provider';
import { SmtpNotificationProvider, createSmtpTransport } from './notification-providers/smtp.provider';
import type { NotificationProvider } from './notification-providers/provider';

const OUTBOX_DISPATCH_INTERVAL_MS = 10_000;
const OUTBOX_BATCH_SIZE = 25;
// Running more often than "daily" (docs/05) is strictly safer for a
// reminder feature and costs nothing — the whole operation is naturally
// idempotent (PaymentAlert.sourceEventId/sourceInstallmentId are
// hard-unique, ADR-064 decision 3), so a source is never double-opened or
// double-notified regardless of tick frequency. Tightened from 15 minutes
// to 30 seconds so a freshly-created milestone's alert appears without
// needing a worker restart to trigger the boot-time run below.
const PAYMENT_ALERT_OPENER_INTERVAL_MS = 30_000;
const SALARY_DRAFT_GENERATOR_INTERVAL_MS = 60 * 60 * 1000;
const WORKER_ID = `worker-${process.pid}-${Date.now()}`;

function selectNotificationProvider(env: Env, logger: ReturnType<typeof createLogger>): NotificationProvider {
  if (env.SMTP_PASS.startsWith('replace-with-')) {
    logger.warn('worker.notification_provider_fake', {
      reason: 'SMTP_PASS is a placeholder value',
    });
    return new FakeNotificationProvider();
  }
  const transport = createSmtpTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    fromEmail: env.SMTP_FROM_EMAIL ?? env.SMTP_USER,
  });
  logger.info('worker.notification_provider_smtp', { host: env.SMTP_HOST, port: env.SMTP_PORT });
  return new SmtpNotificationProvider(transport, env.SMTP_FROM_EMAIL ?? env.SMTP_USER, env.SMTP_FROM_NAME);
}

async function main() {
  const env = loadEnv();
  const logger = createLogger({ service: 'worker' });

  const state: WorkerHealthState = {
    lastHeartbeatAt: null,
    lastSuccessfulJobAt: null,
    pgBossConnected: false,
  };

  const boss = createBoss(env.DATABASE_URL, env.PGBOSS_SCHEMA);
  boss.on('error', (error) => logger.error('worker.pgboss_error', { error }));

  await boss.start();
  state.pgBossConnected = true;
  logger.info('worker.pgboss_started');

  // No real job handlers yet (Phase 1 foundation) — a single noop job
  // proves the queue pipeline works end-to-end.
  await boss.work('noop', async () => {
    state.lastSuccessfulJobAt = new Date().toISOString();
  });

  const prisma = createPrismaClient();
  const notificationProvider = selectNotificationProvider(env, logger);

  const outboxDispatchTick = setInterval(() => {
    void runOutboxDispatchJob({
      prisma,
      provider: notificationProvider,
      workerId: WORKER_ID,
      batchSize: OUTBOX_BATCH_SIZE,
      leaseTimeoutMinutes: env.OUTBOX_LEASE_TIMEOUT_MINUTES,
      webPublicUrl: env.WEB_PUBLIC_URL,
    }).then(() => {
      state.lastSuccessfulJobAt = new Date().toISOString();
    });
  }, OUTBOX_DISPATCH_INTERVAL_MS);

  // Unlike the 10s outbox tick (where waiting for the first interval is
  // negligible), a 15-minute interval left to fire only on its own schedule
  // would mean every worker restart silently delays alerts by up to 15
  // minutes with no visible symptom — run once immediately on boot, then
  // on the normal interval after that.
  void runPaymentAlertOpenerJob(prisma).then(() => {
    state.lastSuccessfulJobAt = new Date().toISOString();
  });
  const paymentAlertOpenerTick = setInterval(() => {
    void runPaymentAlertOpenerJob(prisma).then(() => {
      state.lastSuccessfulJobAt = new Date().toISOString();
    });
  }, PAYMENT_ALERT_OPENER_INTERVAL_MS);

  // Hourly is plenty: this job only ever acts once a month, on the first
  // tick after a month ends, and every later tick is a cheap no-op guarded
  // by the batch that already exists. Runs on boot for the same reason the
  // payment alert opener above does — a restart shouldn't delay a month's draft.
  void runSalaryDraftGeneratorJob(prisma).then(() => {
    state.lastSuccessfulJobAt = new Date().toISOString();
  });
  const salaryDraftGeneratorTick = setInterval(() => {
    void runSalaryDraftGeneratorJob(prisma).then(() => {
      state.lastSuccessfulJobAt = new Date().toISOString();
    });
  }, SALARY_DRAFT_GENERATOR_INTERVAL_MS);

  const heartbeat = setInterval(() => {
    state.lastHeartbeatAt = new Date().toISOString();
  }, 15_000);
  state.lastHeartbeatAt = new Date().toISOString();

  const healthServer = startHealthServer(env.WORKER_HEALTH_PORT, state);
  logger.info('worker.listening', { port: env.WORKER_HEALTH_PORT });

  registerGracefulShutdown(logger, async () => {
    clearInterval(heartbeat);
    clearInterval(outboxDispatchTick);
    clearInterval(paymentAlertOpenerTick);
    clearInterval(salaryDraftGeneratorTick);
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      healthServer.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'error', event: 'worker.fatal_startup_error', error }));
  process.exit(1);
});
