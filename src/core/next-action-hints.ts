import type { JsonObject } from '../bridge/protocol'

type StepByStepToolName =
  | 'scrape_detect_tables'
  | 'scrape_get_table_tree'
  | 'scrape_click_expand_and_redetect'
  | 'scrape_analyze_columns'

const STEP_BY_STEP_TOOL_NAMES: StepByStepToolName[] = [
  'scrape_detect_tables',
  'scrape_get_table_tree',
  'scrape_click_expand_and_redetect',
  'scrape_analyze_columns',
]

const STEP_BY_STEP_TOOL_SET = new Set<string>(STEP_BY_STEP_TOOL_NAMES)

function formatNextAction(primary: string, alternatives: string[]): string {
  return `Primary: ${primary}\nAlternatives:\n${alternatives.map(item => `- ${item}`).join('\n')}`
}

function hasNonEmptyTables(payload: JsonObject): boolean {
  const tables = payload.tables
  return Array.isArray(tables) && tables.length > 0
}

function hasEmptyTables(payload: JsonObject): boolean {
  const tables = payload.tables
  return Array.isArray(tables) && tables.length === 0
}

function buildSuccessNextAction(toolName: StepByStepToolName, payload: JsonObject): string {
  if (toolName === 'scrape_detect_tables') {
    if (hasEmptyTables(payload)) {
      return formatNextAction(
        'Call `browser_list_tabs`, then `browser_use_tab`, and re-run `scrape_detect_tables`.',
        [
          'Re-run `scrape_detect_tables` with a more specific `prompt`.',
          'Confirm the target table is visible in the active tab, then retry `scrape_detect_tables`.',
        ]
      )
    }

    if (hasNonEmptyTables(payload)) {
      return formatNextAction(
        'Select one table and call `scrape_get_table_tree` with `rootSelector`, `itemSelector`, and `documentInfoPath`.',
        [
          'Call `scrape_analyze_columns` directly using the selected table `rootSelector`, `itemSelector`, and `documentInfoPath`.',
          'Re-run `scrape_detect_tables` with a more specific `prompt` to refine table selection.',
        ]
      )
    }
  }

  if (toolName === 'scrape_get_table_tree') {
    return formatNextAction(
      'Inspect `tree` for button UIDs, then call `scrape_click_expand_and_redetect` with `rootSelector`, `itemSelector`, `documentInfoPath`, and `expandButtonUids`.',
      [
        'If expansion is not needed, call `scrape_analyze_columns` with `rootSelector`, `itemSelector`, and `documentInfoPath`.',
        'Re-run `scrape_detect_tables` to pick a different table when current tree is not the target.',
      ]
    )
  }

  if (toolName === 'scrape_click_expand_and_redetect') {
    return formatNextAction(
      'Call `scrape_analyze_columns` with latest `rootSelector`, `itemSelector`, and original `documentInfoPath`; include `expandButtons` when needed.',
      [
        'Call `scrape_get_table_tree` again to adjust UID selection before another expansion attempt.',
        'Skip expansion and analyze current selectors directly via `scrape_analyze_columns`.',
      ]
    )
  }

  return formatNextAction(
    'Use returned `jobId` to call `scrape_start` (optionally pass `maxRecords`).',
    [
      'Poll `scrape_status` until terminal state (`COMPLETED`, `ERROR`, or `CANCELED`).',
      'After completion, use `scrape_result` or export via `scrape_export` / `scrape_export_to_file`.',
    ]
  )
}

function hasExistingNextAction(payload: JsonObject): boolean {
  const nextAction = payload.next_action
  return typeof nextAction === 'string' && nextAction.trim().length > 0
}

export function isStepByStepTool(toolName: string): toolName is StepByStepToolName {
  return STEP_BY_STEP_TOOL_SET.has(toolName)
}

export function attachSuccessNextAction(toolName: string, payload: JsonObject): JsonObject {
  if (!isStepByStepTool(toolName) || hasExistingNextAction(payload)) {
    return payload
  }

  return {
    ...payload,
    next_action: buildSuccessNextAction(toolName, payload),
  }
}
