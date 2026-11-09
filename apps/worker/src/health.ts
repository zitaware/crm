import { createServer, type Server } from 'node:http';

export interface WorkerHealthState {
  lastHeartbeatAt: string | null;
  lastSuccessfulJobAt: string | null;
  pgBossConnected: boolean;
}

/**
 * Minimal HTTP health listener — the worker has no other reason to expose
 * a port, but PM2 process status alone does not prove the application is
 * healthy (docs/14-runtime-deployment.md), so /healthz reports heartbeat
 * and last-job state explicitly.
 */
export function startHealthServer(port: number, state: WorkerHealthState): Server {
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'worker', ...state }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port);
  return server;
}
