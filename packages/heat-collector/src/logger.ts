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

    const normalized = context
      ? Object.fromEntries(
          Object.entries(context).map(([key, value]) => [key, normalizeLogValue(value)])
        )
      : undefined;

    const payload = {
      level: lvl,
      msg: message,
      ts: new Date().toISOString(),
      ...normalized
    };
    const line = JSON.stringify(payload);

    if (lvl === "error") {
      // eslint-disable-next-line no-console
      console.error(line);
      return;
    }
    if (lvl === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(line);
  };

  return {
    debug: (msg: string, ctx?: Record<string, any>) => log("debug", msg, ctx),
    info: (msg: string, ctx?: Record<string, any>) => log("info", msg, ctx),
    warn: (msg: string, ctx?: Record<string, any>) => log("warn", msg, ctx),
    error: (msg: string, ctx?: Record<string, any>) => log("error", msg, ctx)
  };
};

export type Logger = ReturnType<typeof createLogger>;

const normalizeLogValue = (value: any) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
};
