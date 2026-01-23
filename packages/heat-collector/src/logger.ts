type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export const createLogger = (level: LogLevel = "info") => {
  const threshold = LEVELS[level] ?? 20;
  const log = (lvl: LogLevel, message: string, context?: Record<string, any>) => {
    if (LEVELS[lvl] < threshold) return;
    const payload = {
      level: lvl,
      msg: message,
      ts: new Date().toISOString(),
      ...context
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  };

  return {
    debug: (msg: string, ctx?: Record<string, any>) => log("debug", msg, ctx),
    info: (msg: string, ctx?: Record<string, any>) => log("info", msg, ctx),
    warn: (msg: string, ctx?: Record<string, any>) => log("warn", msg, ctx),
    error: (msg: string, ctx?: Record<string, any>) => log("error", msg, ctx)
  };
};

export type Logger = ReturnType<typeof createLogger>;
