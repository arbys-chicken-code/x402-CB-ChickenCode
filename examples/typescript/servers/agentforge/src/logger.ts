/**
 * Tiny dependency-free structured logger.
 *
 * Emits single-line JSON in production-friendly format while remaining readable
 * in a terminal. Keeping this in-house avoids pulling a heavy logging dependency
 * into an example, while still demonstrating the structured, level-filtered
 * logging you would expect from a production service.
 */

const LEVELS = ["debug", "info", "warn", "error"] as const;

/**
 * Supported log levels in increasing order of severity.
 */
export type LogLevel = (typeof LEVELS)[number];

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: "🔍",
  info: "ℹ️ ",
  warn: "⚠️ ",
  error: "❌",
};

/**
 * A namespaced, level-filtered structured logger.
 */
export class Logger {
  private readonly scope: string;
  private readonly minLevelIndex: number;

  /**
   * Create a logger.
   *
   * @param scope - Short label identifying the subsystem (e.g. "mcp", "http").
   * @param minLevel - Minimum level to emit; lower-severity logs are dropped.
   */
  constructor(scope: string, minLevel: LogLevel = "info") {
    this.scope = scope;
    this.minLevelIndex = LEVELS.indexOf(minLevel);
  }

  /**
   * Create a child logger that shares the same level but a nested scope.
   *
   * @param childScope - Sub-scope appended to the parent scope.
   * @returns A new {@link Logger} scoped to `parent:child`.
   */
  child(childScope: string): Logger {
    return new Logger(`${this.scope}:${childScope}`, LEVELS[this.minLevelIndex]);
  }

  /**
   * Log a debug-level message.
   *
   * @param message - Human-readable message.
   * @param fields - Optional structured context.
   */
  debug(message: string, fields?: Record<string, unknown>): void {
    this.emit("debug", message, fields);
  }

  /**
   * Log an info-level message.
   *
   * @param message - Human-readable message.
   * @param fields - Optional structured context.
   */
  info(message: string, fields?: Record<string, unknown>): void {
    this.emit("info", message, fields);
  }

  /**
   * Log a warning-level message.
   *
   * @param message - Human-readable message.
   * @param fields - Optional structured context.
   */
  warn(message: string, fields?: Record<string, unknown>): void {
    this.emit("warn", message, fields);
  }

  /**
   * Log an error-level message.
   *
   * @param message - Human-readable message.
   * @param fields - Optional structured context.
   */
  error(message: string, fields?: Record<string, unknown>): void {
    this.emit("error", message, fields);
  }

  /**
   * Internal helper that performs level filtering and formatting.
   *
   * @param level - Severity of the entry.
   * @param message - Human-readable message.
   * @param fields - Optional structured context.
   */
  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVELS.indexOf(level) < this.minLevelIndex) {
      return;
    }

    const timestamp = new Date().toISOString();
    const context = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    const line = `${LEVEL_ICONS[level]} ${timestamp} [${this.scope}] ${message}${context}`;

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

/**
 * Create the root application logger.
 *
 * @param minLevel - Minimum level to emit.
 * @returns A root {@link Logger} scoped to "agentforge".
 */
export function createLogger(minLevel: LogLevel): Logger {
  return new Logger("agentforge", minLevel);
}
