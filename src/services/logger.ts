// =============================================================================
// FOUNDRY — Structured Logger
// Minimal structured logger — JSON output for production, pretty for dev.
// Replaces raw console.log/warn/error across server code.
// =============================================================================

interface LogContext {
  productId?: string;
  founderId?: string;
  requestId?: string;
  jobName?: string;
  agentName?: string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== 'production';

function formatLog(level: string, message: string, ctx?: LogContext): string {
  if (isDev) return `[${level.toUpperCase()}] ${message}${ctx ? ' ' + JSON.stringify(ctx) : ''}`;
  return JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...ctx });
}

export const logger = {
  info: (message: string, ctx?: LogContext) => console.log(formatLog('info', message, ctx)),
  warn: (message: string, ctx?: LogContext) => console.warn(formatLog('warn', message, ctx)),
  error: (message: string, ctx?: LogContext) => console.error(formatLog('error', message, ctx)),
  debug: (message: string, ctx?: LogContext) => { if (isDev) console.log(formatLog('debug', message, ctx)); },
};
