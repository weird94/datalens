import type { BridgeHelloPayload } from '../bridge/protocol'

function parseList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export class BridgeAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeAuthError'
  }
}

export class BridgeAuthService {
  private readonly expectedToken: string | undefined
  private readonly allowedExtensionIds: string[]

  constructor() {
    const token = process.env.MCP_BRIDGE_TOKEN
    this.expectedToken = token && token.trim().length > 0 ? token : undefined
    this.allowedExtensionIds = parseList(process.env.MCP_ALLOWED_EXTENSION_IDS)
  }

  validateHello(payload: BridgeHelloPayload): void {
    if (this.expectedToken && payload.token !== this.expectedToken) {
      throw new BridgeAuthError('Invalid bridge token')
    }

    if (
      this.allowedExtensionIds.length > 0 &&
      !this.allowedExtensionIds.includes(payload.extensionId)
    ) {
      throw new BridgeAuthError(`Extension is not allowed: ${payload.extensionId}`)
    }
  }
}
