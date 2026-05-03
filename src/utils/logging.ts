const DEBUG_LOG_LEVELS = new Set(["debug", "trace"]);

let runtimeLogLevel = normalizeLogLevel(process.env.LOG_LEVEL);

function normalizeLogLevel(level?: string): string {
  return level?.trim().toLowerCase() || "info";
}

export function setRuntimeLogLevel(level: string): void {
  runtimeLogLevel = normalizeLogLevel(level);
}

export function isDebugLoggingEnabled(): boolean {
  return DEBUG_LOG_LEVELS.has(runtimeLogLevel);
}

export function debugLog(...args: Parameters<typeof console.log>): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  console.log(...args);
}
