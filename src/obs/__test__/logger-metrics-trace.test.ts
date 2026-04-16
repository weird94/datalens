import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../logger-metrics-trace'

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps operational logs off stdout in stdio mode', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    logger.info('startup complete')
    logger.warn('bridge reconnecting')

    expect(consoleInfoSpy).not.toHaveBeenCalled()
    expect(consoleWarnSpy).not.toHaveBeenCalled()
    expect(stderrSpy).toHaveBeenCalled()
  })
})
