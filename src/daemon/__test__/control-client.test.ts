import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlClient } from '../control-client'
import {
  CONTROL_REQUEST_KIND_HEALTH,
  CONTROL_RESPONSE_STATUS_ERROR,
  CONTROL_RESPONSE_STATUS_OK,
} from '../control-protocol'

interface TestAddressInfo {
  port: number
}

async function startJsonLineServer(responseLine: string): Promise<{
  port: number
  stop: () => Promise<void>
}> {
  const server = createServer(socket => {
    socket.on('data', () => {
      socket.write(`${responseLine}\n`)
      socket.end()
    })
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Expected numeric address info'))
        return
      }

      resolve((address as TestAddressInfo).port)
    })
  })

  return {
    port,
    stop: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
  }
}

describe('ControlClient', () => {
  const stopCallbacks: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(stopCallbacks.splice(0).map(stop => stop()))
  })

  it('parses successful responses from the daemon', async () => {
    const startedServer = await startJsonLineServer(
      JSON.stringify({
        status: CONTROL_RESPONSE_STATUS_OK,
        kind: CONTROL_REQUEST_KIND_HEALTH,
        payload: {
          status: 'ok',
        },
      })
    )
    stopCallbacks.push(startedServer.stop)

    const client = new ControlClient({
      host: '127.0.0.1',
      port: startedServer.port,
    })

    await expect(client.health()).resolves.toEqual({
      status: 'ok',
    })
  })

  it('surfaces daemon error payloads as thrown errors', async () => {
    const startedServer = await startJsonLineServer(
      JSON.stringify({
        status: CONTROL_RESPONSE_STATUS_ERROR,
        error: {
          code: 'TAB_LEASE_CONFLICT',
          message: 'Tab is busy',
          retriable: false,
        },
      })
    )
    stopCallbacks.push(startedServer.stop)

    const client = new ControlClient({
      host: '127.0.0.1',
      port: startedServer.port,
    })

    await expect(client.health()).rejects.toThrow('Tab is busy')
  })
})
