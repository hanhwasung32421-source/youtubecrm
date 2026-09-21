// CSV 만들기 (순수 함수, React/브라우저/DB 의존 없음).
// - 엑셀에서 한글이 깨지지 않도록 맨 앞에 UTF-8 BOM 을 붙인다.
// - 쉼표·따옴표·줄바꿈이 들어 있는 칸은 큰따옴표로 감싸고, 안의 큰따옴표는 두 번 쓴다.
// - 엑셀 수식 주입 방지: 글자 칸이 = + - @ (또는 탭/줄바꿈)으로 시작하면 앞에 ' 를 붙여 수식으로 실행되지 않게 한다.
//   (숫자 값은 글자가 아니라 숫자이므로 그대로 쓴다. -5 같은 음수도 안전하다.)

export const CSV_BOM = '﻿'
export const CSV_EOL = '\r\n'

export type CsvValue = string | number | boolean | null | undefined

const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTE = /[",\r\n]/

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let text = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  if (NEEDS_QUOTE.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',')
}

export function buildCsv(headers: string[], rows: CsvValue[][], options: { bom?: boolean } = {}): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)]
  return `${options.bom === false ? '' : CSV_BOM}${lines.join(CSV_EOL)}${CSV_EOL}`
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// "2026-09-21 14:30" (한국 시간). 값이 없거나 이상하면 빈 칸.
export function csvKstDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

// 파일 이름에 못 쓰는 글자(\ / : * ? " < > |)는 _ 로 바꾼다. 예: "영상순위_2026-09-21.csv"
export function csvFilename(base: string, now = Date.now()): string {
  const safe = base.replace(/[\/:*?"<>|\r\n\t]/g, '_').trim() || 'export'
  const ymd = new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10)
  return `${safe}_${ymd}.csv`
}
