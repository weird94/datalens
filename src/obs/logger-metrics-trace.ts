type LogScalar = boolean | number | string | null
type LogValue = LogContext | LogScalar | LogValue[]

export interface LogContext {
  requestId?: string
  jobId?: string
  toolName?: string
  commandName?: string
  stateBefore?: string
  stateAfter?: string
  latencyMs?: number
  errorCode?: string
  [key: string]: LogValue | undefined
}

type LogLevel = 'info' | 'warn' | 'error'
type LogSink = (level: LogLevel, line: string) => void

function writeToStderr(line: string): void {
  process.stderr.write(`${line}\n`)
}

export class Logger {
  constructor(private readonly sink: LogSink) {}

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    const payload = {
      scope: 'mcp-server',
      level,
      message,
      ...(context ? { context } : {}),
    }
    this.sink(level, JSON.stringify(payload))
  }

  info(message: string, context?: LogContext): void {
    this.emit('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.emit('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.emit('error', message, context)
  }
}

export function createLogger(): Logger {
  return new Logger((_level, line) => {
    writeToStderr(line)
  })
}

export const logger = createLogger()
