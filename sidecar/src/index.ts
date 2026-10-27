/**
 * Sidecar entrypoint. Prints a single JSON line on stdout once ready so the
 * Wails shell can parse port/token without extra dependencies:
 *
 *   {"event":"ready","port":43123,"pid":12345,"version":"0.1.0"}
 */

import crypto from 'node:crypto';
import { startSidecar } from './app/server.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

const token = process.env.SIDCAR_TOKEN ?? arg('token') ?? crypto.randomBytes(24).toString('hex');
const port = Number(arg('port') ?? process.env.SIDCAR_PORT ?? 0);
const version = process.env.npm_package_version ?? '0.1.0';

const running = await startSidecar({ token, port, version });

process.stdout.write(
  `${JSON.stringify({ event: 'ready', port: running.port, pid: process.pid, version })}\n`,
);

const shutdown = async (): Promise<void> => {
  await running.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
