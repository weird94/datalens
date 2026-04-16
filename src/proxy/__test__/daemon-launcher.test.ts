import { describe, expect, it, vi } from 'vitest'
import { DaemonLauncher } from '../daemon-launcher'

function createUnavailableError(): Error & { code: string } {
  const error = new Error('connect ECONNREFUSED 127.0.0.1')
  return Object.assign(error, {
    code: 'ECONNREFUSED',
  })
}

describe('DaemonLauncher', () => {
  it('does not spawn when the daemon is already healthy', async () => {
    const spawnDaemon = vi.fn()
    const launcher = new DaemonLauncher(
      {
        health: async () => ({ status: 'ok' }),
      },
      spawnDaemon
    )

    await launcher.ensureStarted()

    expect(spawnDaemon).not.toHaveBeenCalled()
  })

  it('spawns and waits until the daemon becomes healthy', async () => {
    const spawnDaemon = vi.fn(() => ({
      unref: () => {},
    }))
    const health = vi
      .fn<[], Promise<{ status: 'ok' }>>()
      .mockRejectedValueOnce(createUnavailableError())
      .mockRejectedValueOnce(createUnavailableError())
      .mockResolvedValue({ status: 'ok' })

    const launcher = new DaemonLauncher(
      {
        health,
      },
      spawnDaemon,
      {
        pollIntervalMs: 1,
        startupTimeoutMs: 100,
      }
    )

    await launcher.ensureStarted()

    expect(spawnDaemon).toHaveBeenCalledTimes(1)
    expect(health).toHaveBeenCalledTimes(3)
  })

  it('fails fast when the control port is occupied by a non-daemon process', async () => {
    const spawnDaemon = vi.fn()
    const launcher = new DaemonLauncher(
      {
        health: async () => {
          throw new Error('Unexpected token < in JSON')
        },
      },
      spawnDaemon
    )

    await expect(launcher.ensureStarted()).rejects.toThrow('Unexpected token < in JSON')
    expect(spawnDaemon).not.toHaveBeenCalled()
  })
})
