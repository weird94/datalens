import { describe, expect, it } from 'vitest'
import { attachSuccessNextAction, isStepByStepTool } from '../next-action-hints'

describe('next-action-hints', () => {
  it('adds success next_action for scrape_detect_tables when tables are found', () => {
    const result = attachSuccessNextAction('scrape_detect_tables', {
      tables: [{ index: 0 }],
      tabId: 10,
    })

    expect(typeof result.next_action).toBe('string')
    expect(result.next_action).toContain('Primary:')
    expect(result.next_action).toContain('Alternatives:')
    expect(result.next_action).toContain('scrape_get_table_tree')
    expect(result.next_action).toContain('rootSelector')
    expect(result.next_action).toContain('itemSelector')
    expect(result.next_action).toContain('documentInfoPath')
  })

  it('adds empty-table next_action for scrape_detect_tables when no tables are found', () => {
    const result = attachSuccessNextAction('scrape_detect_tables', {
      tables: [],
      tabId: 10,
    })

    expect(result.next_action).toContain('browser_list_tabs')
    expect(result.next_action).toContain('browser_use_tab')
    expect(result.next_action).toContain('scrape_detect_tables')
    expect(result.next_action).toContain('prompt')
  })

  it('adds success next_action for scrape_get_table_tree', () => {
    const result = attachSuccessNextAction('scrape_get_table_tree', {
      tree: { _uid: '1' },
      rootSelector: '.root',
      itemSelector: '.item',
    })

    expect(result.next_action).toContain('scrape_click_expand_and_redetect')
    expect(result.next_action).toContain('expandButtonUids')
    expect(result.next_action).toContain('scrape_analyze_columns')
  })

  it('keeps non-step tools unchanged', () => {
    const successResult = attachSuccessNextAction('scrape_status', {
      jobId: 'job_1',
    })

    expect(successResult).toEqual({
      jobId: 'job_1',
    })
    expect(isStepByStepTool('scrape_status')).toBe(false)
  })
})
