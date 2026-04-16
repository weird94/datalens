import { SessionStateStore } from './session-state-store'

export class SessionManager extends SessionStateStore {
  setSelectedTab(sessionId: string | undefined, tabId: number): void {
    if (!sessionId) {
      return
    }

    super.setSelectedTab(sessionId, tabId)
  }

  getSelectedTab(sessionId: string | undefined): number | null {
    if (!sessionId) {
      return null
    }

    return super.getSelectedTab(sessionId)
  }

  clearSession(sessionId: string | undefined): void {
    if (!sessionId) {
      return
    }

    super.clearSession(sessionId)
  }
}
