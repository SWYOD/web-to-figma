export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

/** Простой structured console logger — общий для main-процесса Electron и Figma plugin sandbox. */
export function createConsoleLogger(scope: string): Logger {
  const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    const line = `[${scope}] ${message}`
    const fn = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
    if (context) fn(line, context)
    else fn(line)
  }
  return {
    debug: (m, c) => log('debug', m, c),
    info: (m, c) => log('info', m, c),
    warn: (m, c) => log('warn', m, c),
    error: (m, c) => log('error', m, c)
  }
}
