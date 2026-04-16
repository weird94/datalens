import { describe, expect, it, vi } from 'vitest'
import type { BridgeCommandName, JsonObject } from '../../bridge/protocol'
import { ToolExecutor } from '../tool-executor'
import { JobOwnershipStore } from '../job-ownership-store'
import { SessionStateStore } from '../session-state-store'
import {
  JOB_OWNERSHIP_CONFLICT_ERROR_CODE,
  TAB_LEASE_CONFLICT_ERROR_CODE,
} from '../session-isolation-error'
import { TabLeaseManager } from '../tab-lease-manager'
import { ToolRegistry } from '../tool-registry'

describe('ToolExecutor', () => {
  it('keeps selected tabs isolated per session', async () => {
    const sendCommand = vi.fn<
      [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
      Promise<JsonObject>
    >(async (commandName, payload) => {
      if (commandName === 'browser.use_tab') {
        return {
          tab: {
            id: payload.tabId,
            active: true,
          },
        }
      }

      return {
        ok: true,
      }
    })

    const executor = new ToolExecutor(
      new ToolRegistry(),
      sendCommand,
      new SessionStateStore(),
      new TabLeaseManager(),
      new JobOwnershipStore()
    )

    await executor.invoke('browser_use_tab', { tabId: 11 }, 'session-a')
    await executor.invoke('scrape_detect_tables', {}, 'session-a')
    await executor.invoke('scrape_detect_tables', {}, 'session-b')

    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      'scrape.detect_tables',
      expect.objectContaining({
        tabId: 11,
      }),
      expect.objectContaining({
        requestId: expect.any(String),
      })
    )
    expect(sendCommand).toHaveBeenNthCalledWith(
      3,
      'scrape.detect_tables',
      expect.not.objectContaining({
        tabId: 11,
      }),
      expect.objectContaining({
        requestId: expect.any(String),
      })
    )
  })

  it('allows multiple sessions to list tabs without leasing the active tab', async () => {
    const sendCommand = vi.fn<
      [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
      Promise<JsonObject>
    >(async commandName => {
      if (commandName === 'browser.list_tabs') {
        return {
          tabs: [
            {
              id: 11,
              active: true,
            },
          ],
        }
      }

      return {
        ok: true,
      }
    })

    const executor = new ToolExecutor(
      new ToolRegistry(),
      sendCommand,
      new SessionStateStore(),
      new TabLeaseManager(),
      new JobOwnershipStore()
    )

    await expect(executor.invoke('browser_list_tabs', {}, 'session-a')).resolves.toMatchObject({
      tabs: [
        {
          id: 11,
          active: true,
        },
      ],
    })
    await expect(executor.invoke('browser_list_tabs', {}, 'session-b')).resolves.toMatchObject({
      tabs: [
        {
          id: 11,
          active: true,
        },
      ],
    })
  })

  it('treats an opened tab as the selected leased tab for the session', async () => {
    const sendCommand = vi.fn<
      [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
      Promise<JsonObject>
    >(async (commandName) => {
      if (commandName === 'browser.open_tab') {
        return {
          tab: {
            id: 21,
            active: true,
          },
        }
      }

      return {
        ok: true,
      }
    })

    const executor = new ToolExecutor(
      new ToolRegistry(),
      sendCommand,
      new SessionStateStore(),
      new TabLeaseManager(),
      new JobOwnershipStore()
    )

    await executor.invoke(
      'browser_open_tab',
      {
        url: 'https://example.com/list',
        openMode: 'create_new',
      },
      'session-a'
    )
    await executor.invoke('scrape_detect_tables', {}, 'session-a')

    await expect(executor.invoke('browser_use_tab', { tabId: 21 }, 'session-b')).rejects.toThrowError(
      expect.objectContaining({
        code: TAB_LEASE_CONFLICT_ERROR_CODE,
      })
    )

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      'browser.open_tab',
      {
        url: 'https://example.com/list',
        openMode: 'create_new',
      },
      expect.objectContaining({
        requestId: expect.any(String),
      })
    )
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      'scrape.detect_tables',
      expect.objectContaining({
        tabId: 21,
      }),
      expect.objectContaining({
        requestId: expect.any(String),
      })
    )
  })

  it('rejects when another session tries to claim the same tab', async () => {
    const sendCommand = vi.fn<
      [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
      Promise<JsonObject>
    >(async (_commandName, payload) => ({
      tab: {
        id: payload.tabId,
        active: true,
      },
    }))

    const executor = new ToolExecutor(
      new ToolRegistry(),
      sendCommand,
      new SessionStateStore(),
      new TabLeaseManager(),
      new JobOwnershipStore()
    )

    await executor.invoke('browser_use_tab', { tabId: 11 }, 'session-a')

    await expect(executor.invoke('browser_use_tab', { tabId: 11 }, 'session-b')).rejects.toThrowError(
      expect.objectContaining({
        code: TAB_LEASE_CONFLICT_ERROR_CODE,
      })
    )
  })

  it('rejects job operations from a different session', async () => {
    const sendCommand = vi.fn<
      [BridgeCommandName, JsonObject, { requestId?: string; jobId?: string; timeoutMs?: number }?],
      Promise<JsonObject>
    >(async (commandName) => {
      if (commandName === 'scrape.start') {
        return {
          jobId: 'job-1',
          status: 'running',
        }
      }

      return {
        jobId: 'job-1',
        status: 'running',
      }
    })

    const executor = new ToolExecutor(
      new ToolRegistry(),
      sendCommand,
      new SessionStateStore(),
      new TabLeaseManager(),
      new JobOwnershipStore()
    )

    await executor.invoke('scrape_start', { scraperConfig: {} }, 'session-a')

    await expect(executor.invoke('scrape_status', { jobId: 'job-1' }, 'session-b')).rejects.toThrowError(
      expect.objectContaining({
        code: JOB_OWNERSHIP_CONFLICT_ERROR_CODE,
      })
    )
  })
})
