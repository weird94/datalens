import { describe, expect, it } from 'vitest'
import {
  TAB_LEASE_CONFLICT_ERROR_CODE,
  TabLeaseManager,
} from '../tab-lease-manager'

describe('TabLeaseManager', () => {
  it('moves the lease when the same session selects a new tab', () => {
    const manager = new TabLeaseManager()

    manager.assignLease('session-a', 11)
    manager.assignLease('session-a', 22)

    expect(manager.getOwnerSessionId(11)).toBeNull()
    expect(manager.getOwnerSessionId(22)).toBe('session-a')
    expect(manager.getLeasedTab('session-a')).toBe(22)
  })

  it('rejects a second session trying to lease the same tab', () => {
    const manager = new TabLeaseManager()

    manager.assignLease('session-a', 11)

    expect(() => manager.assignLease('session-b', 11)).toThrowError(
      expect.objectContaining({
        code: TAB_LEASE_CONFLICT_ERROR_CODE,
      })
    )
  })

  it('releases the leased tab when the session closes', () => {
    const manager = new TabLeaseManager()

    manager.assignLease('session-a', 11)
    manager.releaseLeaseBySession('session-a')

    expect(manager.getOwnerSessionId(11)).toBeNull()
    expect(manager.getLeasedTab('session-a')).toBeNull()
  })
})
