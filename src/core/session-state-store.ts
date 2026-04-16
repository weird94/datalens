interface SessionState {
  selectedTabId: number | null
}

const EMPTY_SESSION_STATE: SessionState = {
  selectedTabId: null,
}

export class SessionStateStore {
  private readonly stateBySession = new Map<string, SessionState>()

  setSelectedTab(sessionId: string, tabId: number): void {
    const previousState = this.stateBySession.get(sessionId) ?? EMPTY_SESSION_STATE

    this.stateBySession.set(sessionId, {
      ...previousState,
      selectedTabId: tabId,
    })
  }

  getSelectedTab(sessionId: string): number | null {
    return this.stateBySession.get(sessionId)?.selectedTabId ?? EMPTY_SESSION_STATE.selectedTabId
  }

  clearSelectedTabIfMatches(sessionId: string, tabId: number): void {
    const previousState = this.stateBySession.get(sessionId)
    if (!previousState || previousState.selectedTabId !== tabId) {
      return
    }

    this.stateBySession.set(sessionId, {
      ...previousState,
      selectedTabId: null,
    })
  }

  clearSession(sessionId: string): void {
    this.stateBySession.delete(sessionId)
  }
}
