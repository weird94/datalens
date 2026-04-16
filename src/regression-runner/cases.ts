import type { RegressionCaseRow } from './types'

export const REGRESSION_DEFAULT_BATCH_LIMIT = 5

export const REGRESSION_STATUS_VALUES = {
  P0_MAJOR: 'P0(Major)',
  P1_MINOR: 'P1(Minor)',
  P2_BACKLOG: 'P2(Backlog)',
} as const

export const REGRESSION_PRIORITY_VALUES = {
  P0: 'p0',
  P1: 'p1',
  P2: 'p2',
} as const

export type RegressionPriorityValue =
  (typeof REGRESSION_PRIORITY_VALUES)[keyof typeof REGRESSION_PRIORITY_VALUES]

const REGRESSION_PRIORITY_PREFIXES = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
} as const

const WEBSITE_CSV_COLUMN_INDEX = {
  ENVIRONMENT: 0,
  SITE: 1,
  PAGE: 2,
  CATEGORY: 3,
  URL: 4,
  SCRAPE_PROMPT: 5,
  LEVEL: 6,
} as const

const WEBSITE_CSV_HEADER_LABELS = {
  LEVEL: '保障级别',
  SCRAPE_PROMPT: 'scrape_prompt',
  PROMPT_REFERENCE: '提示词',
} as const

export interface ParsedWebsiteCsv {
  header: string[]
  rows: RegressionCaseRow[]
}

interface SelectBatchCasesInput {
  limit: number
  priorities?: RegressionPriorityValue[]
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentValue = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const nextCharacter = text[index + 1]

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (character === ',' && !inQuotes) {
      currentRow.push(currentValue)
      currentValue = ''
      continue
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1
      }
      currentRow.push(currentValue)
      rows.push(currentRow)
      currentRow = []
      currentValue = ''
      continue
    }

    currentValue += character
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue)
    rows.push(currentRow)
  }

  return rows
}

function sanitizeCell(value: string | undefined): string {
  return (value || '').replace(/^\uFEFF/, '').trim()
}

function findHeaderColumnIndex(
  header: string[],
  matcher: (cell: string) => boolean
): number | undefined {
  const matchedIndex = header.findIndex(cell => matcher(cell))
  return matchedIndex >= 0 ? matchedIndex : undefined
}

function resolveColumnIndex(
  header: string[],
  fallbackIndex: number,
  matcher: (cell: string) => boolean
): number {
  return findHeaderColumnIndex(header, matcher) ?? fallbackIndex
}

export function parseWebsiteCsv(csvText: string): ParsedWebsiteCsv {
  const parsedRows = parseCsv(csvText)
  const header = parsedRows[0]?.map(cell => sanitizeCell(cell)) || []
  const scrapePromptColumnIndex = resolveColumnIndex(
    header,
    WEBSITE_CSV_COLUMN_INDEX.SCRAPE_PROMPT,
    cell =>
      cell === WEBSITE_CSV_HEADER_LABELS.SCRAPE_PROMPT ||
      cell.includes(WEBSITE_CSV_HEADER_LABELS.PROMPT_REFERENCE)
  )
  const levelColumnIndex = resolveColumnIndex(
    header,
    WEBSITE_CSV_COLUMN_INDEX.LEVEL,
    cell => cell === WEBSITE_CSV_HEADER_LABELS.LEVEL
  )
  const rows: RegressionCaseRow[] = parsedRows.slice(1).map((cells, index) => ({
    rowIndex: index + 2,
    environment: sanitizeCell(cells[WEBSITE_CSV_COLUMN_INDEX.ENVIRONMENT]),
    site: sanitizeCell(cells[WEBSITE_CSV_COLUMN_INDEX.SITE]),
    page: sanitizeCell(cells[WEBSITE_CSV_COLUMN_INDEX.PAGE]),
    category: sanitizeCell(cells[WEBSITE_CSV_COLUMN_INDEX.CATEGORY]),
    url: sanitizeCell(cells[WEBSITE_CSV_COLUMN_INDEX.URL]),
    scrapePrompt: sanitizeCell(cells[scrapePromptColumnIndex]),
    level: sanitizeCell(cells[levelColumnIndex]),
  }))

  return {
    header,
    rows,
  }
}

function getCasePriority(level: string): RegressionPriorityValue | undefined {
  if (level.length === 0) {
    return REGRESSION_PRIORITY_VALUES.P2
  }

  if (level.startsWith(REGRESSION_PRIORITY_PREFIXES.P0)) {
    return REGRESSION_PRIORITY_VALUES.P0
  }

  if (level.startsWith(REGRESSION_PRIORITY_PREFIXES.P1)) {
    return REGRESSION_PRIORITY_VALUES.P1
  }

  if (level.startsWith(REGRESSION_PRIORITY_PREFIXES.P2)) {
    return REGRESSION_PRIORITY_VALUES.P2
  }

  return undefined
}

export function selectBatchCases(
  rows: RegressionCaseRow[],
  input: SelectBatchCasesInput
): RegressionCaseRow[] {
  const allowedPriorities = input.priorities || []

  return rows
    .filter(row => {
      if (!row.site || !row.page || !row.url) {
        return false
      }

      if (allowedPriorities.length === 0) {
        return true
      }

      const rowPriority = getCasePriority(row.level)
      if (!rowPriority) {
        return false
      }

      return allowedPriorities.includes(rowPriority)
    })
    .slice(0, input.limit)
}
