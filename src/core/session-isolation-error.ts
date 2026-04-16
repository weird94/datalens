export const SESSION_ISOLATION_ERROR_NAME = 'SessionIsolationError'
export const TAB_LEASE_CONFLICT_ERROR_CODE = 'TAB_LEASE_CONFLICT'
export const JOB_OWNERSHIP_CONFLICT_ERROR_CODE = 'JOB_OWNERSHIP_CONFLICT'

export class SessionIsolationError extends Error {
  readonly code: string
  readonly retriable: boolean

  constructor(code: string, message: string) {
    super(message)
    this.name = SESSION_ISOLATION_ERROR_NAME
    this.code = code
    this.retriable = false
  }
}
