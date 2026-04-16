export const DEFAULT_DAEMON_CONTROL_HOST = '127.0.0.1'
export const DEFAULT_DAEMON_CONTROL_PORT = 17374
export const MCP_DAEMON_CONTROL_HOST_ENV = 'MCP_DAEMON_CONTROL_HOST'
export const MCP_DAEMON_CONTROL_PORT_ENV = 'MCP_DAEMON_CONTROL_PORT'

function readEnvInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback
  }

  const parsed = Number(rawValue)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getDaemonControlHost(): string {
  return process.env[MCP_DAEMON_CONTROL_HOST_ENV] || DEFAULT_DAEMON_CONTROL_HOST
}

export function getDaemonControlPort(): number {
  return readEnvInt(process.env[MCP_DAEMON_CONTROL_PORT_ENV], DEFAULT_DAEMON_CONTROL_PORT)
}
