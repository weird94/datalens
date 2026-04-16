import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionConnectionManager } from '../../bridge/extension-connection-manager'
import { BridgeAuthService } from '../../security/authn-authz'
import { WsBridgeServer } from '../ws-bridge-server'

vi.mock('../../obs/logger-metrics-trace', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}))

describe('WsBridgeServer', () => {
  const socketsToClose: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(socketsToClose.splice(0).map(close => close()))
    vi.restoreAllMocks()
  })

  it('fails startup when the fixed bridge port is already occupied', async () => {
    const occupiedSocket = createServer()

    await new Promise<void>((resolve, reject) => {
      occupiedSocket.once('error', reject)
      occupiedSocket.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })

    socketsToClose.push(
      async () =>
        await new Promise<void>((resolve, reject) => {
          occupiedSocket.close(error => {
            if (error) {
              reject(error)
              return
            }

            resolve()
          })
        })
    )

    const address = occupiedSocket.address()
    if (typeof address === 'string' || address === null) {
      throw new Error('Expected AddressInfo from occupied socket')
    }

    const occupiedPort = address.port
    const server = new WsBridgeServer(
      {
        host: '127.0.0.1',
        port: occupiedPort,
        path: '/bridge',
      },
      new BridgeAuthService(),
      new ExtensionConnectionManager()
    )

    await expect(Promise.resolve(server.start())).rejects.toThrow(/EADDRINUSE/)
  })
})
