import {
  SessionIsolationError,
  TAB_LEASE_CONFLICT_ERROR_CODE,
} from './session-isolation-error'

function buildTabLeaseConflictMessage(tabId: number, ownerSessionId: string): string {
  return `Tab ${String(tabId)} is already leased by session ${ownerSessionId}`
}

export { TAB_LEASE_CONFLICT_ERROR_CODE }

export class TabLeaseManager {
  private readonly ownerByTab = new Map<number, string>()
  private readonly tabBySession = new Map<string, number>()

  assertLeaseAvailable(sessionId: string, tabId: number): void {
    const ownerSessionId = this.ownerByTab.get(tabId)
    if (ownerSessionId && ownerSessionId !== sessionId) {
      throw new SessionIsolationError(
        TAB_LEASE_CONFLICT_ERROR_CODE,
        buildTabLeaseConflictMessage(tabId, ownerSessionId)
      )
    }
  }

  assignLease(sessionId: string, tabId: number): void {
    this.assertLeaseAvailable(sessionId, tabId)

    const previousTabId = this.tabBySession.get(sessionId)
    if (previousTabId && previousTabId !== tabId) {
      this.ownerByTab.delete(previousTabId)
    }

    this.ownerByTab.set(tabId, sessionId)
    this.tabBySession.set(sessionId, tabId)
  }

  getOwnerSessionId(tabId: number): string | null {
    return this.ownerByTab.get(tabId) ?? null
  }

  getLeasedTab(sessionId: string): number | null {
    return this.tabBySession.get(sessionId) ?? null
  }

  releaseLeaseByTab(tabId: number): void {
    const ownerSessionId = this.ownerByTab.get(tabId)
    if (!ownerSessionId) {
      return
    }

    this.ownerByTab.delete(tabId)
    this.tabBySession.delete(ownerSessionId)
  }

  releaseLeaseBySession(sessionId: string): void {
    const tabId = this.tabBySession.get(sessionId)
    if (!tabId) {
      return
    }

    this.tabBySession.delete(sessionId)
    this.ownerByTab.delete(tabId)
  }
}
