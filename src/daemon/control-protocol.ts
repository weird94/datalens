import * as z from 'zod'
import type { JsonObject } from '../bridge/protocol'
import { TOOL_EXECUTION_RESULT_KIND_TEXT } from '../core/tool-registry'

export const CONTROL_REQUEST_KIND_HEALTH = 'health'
export const CONTROL_REQUEST_KIND_INVOKE_TOOL = 'invokeTool'
export const CONTROL_REQUEST_KIND_CLOSE_SESSION = 'closeSession'
export const CONTROL_RESPONSE_STATUS_OK = 'ok'
export const CONTROL_RESPONSE_STATUS_ERROR = 'error'
export const CONTROL_ERROR_CODE_INVALID_REQUEST = 'INVALID_REQUEST'
export const CONTROL_ERROR_CODE_INTERNAL_ERROR = 'INTERNAL_ERROR'
export const CONTROL_ERROR_NAME = 'ControlError'

const JsonObjectSchema = z.record(z.string(), z.unknown())

const HealthRequestSchema = z.object({
  kind: z.literal(CONTROL_REQUEST_KIND_HEALTH),
})

const InvokeToolRequestSchema = z.object({
  kind: z.literal(CONTROL_REQUEST_KIND_INVOKE_TOOL),
  sessionId: z.string(),
  toolName: z.string(),
  args: JsonObjectSchema,
})

const CloseSessionRequestSchema = z.object({
  kind: z.literal(CONTROL_REQUEST_KIND_CLOSE_SESSION),
  sessionId: z.string(),
})

const ControlRequestSchema = z.union([
  HealthRequestSchema,
  InvokeToolRequestSchema,
  CloseSessionRequestSchema,
])

const ControlResponseSchema = z.union([
  z.object({
    status: z.literal(CONTROL_RESPONSE_STATUS_OK),
    kind: z.literal(CONTROL_REQUEST_KIND_HEALTH),
    payload: z.object({
      status: z.literal('ok'),
    }),
  }),
  z.object({
    status: z.literal(CONTROL_RESPONSE_STATUS_OK),
    kind: z.literal(CONTROL_REQUEST_KIND_INVOKE_TOOL),
      payload: JsonObjectSchema.or(
        z.object({
          kind: z.literal(TOOL_EXECUTION_RESULT_KIND_TEXT),
          text: z.string(),
        })
      ),
  }),
  z.object({
    status: z.literal(CONTROL_RESPONSE_STATUS_OK),
    kind: z.literal(CONTROL_REQUEST_KIND_CLOSE_SESSION),
    payload: z.object({
      closed: z.literal(true),
    }),
  }),
  z.object({
    status: z.literal(CONTROL_RESPONSE_STATUS_ERROR),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retriable: z.boolean(),
    }),
  }),
])

export type ControlRequest = z.infer<typeof ControlRequestSchema>
export type ControlResponse = z.infer<typeof ControlResponseSchema>

export class ControlError extends Error {
  readonly code: string
  readonly retriable: boolean

  constructor(code: string, message: string, retriable: boolean) {
    super(message)
    this.name = CONTROL_ERROR_NAME
    this.code = code
    this.retriable = retriable
  }
}

export function parseControlRequest(raw: string): ControlRequest {
  return ControlRequestSchema.parse(JSON.parse(raw))
}

export function parseControlResponse(raw: string): ControlResponse {
  return ControlResponseSchema.parse(JSON.parse(raw))
}

export function createHealthResponse(): ControlResponse {
  return {
    status: CONTROL_RESPONSE_STATUS_OK,
    kind: CONTROL_REQUEST_KIND_HEALTH,
    payload: {
      status: 'ok',
    },
  }
}

export function createInvokeToolResponse(
  payload:
    | JsonObject
    | {
        kind: typeof TOOL_EXECUTION_RESULT_KIND_TEXT
        text: string
      }
): ControlResponse {
  return {
    status: CONTROL_RESPONSE_STATUS_OK,
    kind: CONTROL_REQUEST_KIND_INVOKE_TOOL,
    payload,
  }
}

export function createCloseSessionResponse(): ControlResponse {
  return {
    status: CONTROL_RESPONSE_STATUS_OK,
    kind: CONTROL_REQUEST_KIND_CLOSE_SESSION,
    payload: {
      closed: true,
    },
  }
}

export function createErrorResponse(error: {
  code: string
  message: string
  retriable: boolean
}): ControlResponse {
  return {
    status: CONTROL_RESPONSE_STATUS_ERROR,
    error,
  }
}
