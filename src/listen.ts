import type { FastifyInstance } from "fastify";

const LOCALHOST = "127.0.0.1";
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}

function canFallbackToLocalhost(err: unknown, host: string): boolean {
  if (!WILDCARD_HOSTS.has(host) || !isNodeError(err)) {
    return false;
  }

  return err.code === "EACCES" || err.code === "EPERM";
}

export async function listenWithHostFallback(
  app: FastifyInstance,
  options: { port: number; host: string; label: string }
): Promise<string> {
  try {
    await app.listen({ port: options.port, host: options.host });
    return options.host;
  } catch (err) {
    if (!canFallbackToLocalhost(err, options.host)) {
      throw err;
    }

    app.log.warn(
      { err, host: options.host, fallbackHost: LOCALHOST, port: options.port },
      `${options.label} could not bind to ${options.host}; retrying on ${LOCALHOST}`
    );

    await app.listen({ port: options.port, host: LOCALHOST });
    return LOCALHOST;
  }
}

export function displayHost(host: string): string {
  return WILDCARD_HOSTS.has(host) ? "localhost" : host;
}
