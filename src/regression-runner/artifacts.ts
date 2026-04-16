import fs from 'node:fs/promises'
import path from 'node:path'
import type { RegressionCaseRow, RegressionJsonValue, RegressionManifest } from './types'

export const REGRESSION_ARTIFACT_FILE_NAMES = {
  CASE_JSON: 'case.json',
  DATA_JSON: 'data.json',
  DEBUG_LOG: 'debug.log',
  DETECT_TABLES_JSON: 'detect-tables.json',
  DOM_TREE_JSON: 'dom-tree.json',
  PRE_DETECT_SCREENSHOT_PNG: 'pre-detect.png',
  RUN_MANIFEST_JSON: 'run-manifest.json',
  SCRAPER_CONFIG_JSON: 'scraper-config.json',
  SELECTED_TABLE_JSON: 'selected-table.json',
} as const

const REGRESSION_CASE_NAME_SANITIZE_PATTERN = /[<>:"/\\|?*\u0000-\u001f]/g
const REGRESSION_CASE_NAME_SPACE_PATTERN = /\s+/g
const REGRESSION_CASE_NAME_EMPTY_FALLBACK = 'untitled'

function sanitizeCasePathSegment(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return REGRESSION_CASE_NAME_EMPTY_FALLBACK
  }

  return trimmed
    .replace(REGRESSION_CASE_NAME_SPACE_PATTERN, '-')
    .replace(REGRESSION_CASE_NAME_SANITIZE_PATTERN, '_')
}

export function buildCaseNumber(row: RegressionCaseRow): string {
  return String(Math.max(1, row.rowIndex - 1)).padStart(3, '0')
}

export function buildCaseDirName(row: RegressionCaseRow): string {
  return [
    buildCaseNumber(row),
    sanitizeCasePathSegment(row.site),
    sanitizeCasePathSegment(row.page),
  ].join('-')
}

export function buildDateOutputDir(outputRoot: string, dateKey: string): string {
  return path.join(outputRoot, dateKey)
}

export function buildManifestPath(outputRoot: string, dateKey: string): string {
  return path.join(
    buildDateOutputDir(outputRoot, dateKey),
    REGRESSION_ARTIFACT_FILE_NAMES.RUN_MANIFEST_JSON
  )
}

export function buildCaseDirPath(outputRoot: string, dateKey: string, row: RegressionCaseRow): string {
  return path.join(buildDateOutputDir(outputRoot, dateKey), buildCaseDirName(row))
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function writeJsonFile(filePath: string, value: RegressionJsonValue): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function writeManifestFile(
  outputRoot: string,
  dateKey: string,
  manifest: RegressionManifest
): Promise<void> {
  const manifestPath = buildManifestPath(outputRoot, dateKey)
  await ensureDirectory(path.dirname(manifestPath))
  await writeJsonFile(manifestPath, manifest)
}
