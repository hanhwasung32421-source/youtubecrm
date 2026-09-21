// V3 표를 CSV(엑셀에서 바로 열리는 파일)로 만드는 순수 함수 모음. (React/브라우저 의존성 없음)
//   - 맨 앞에 UTF-8 BOM 을 붙여서 엑셀에서 한글이 깨지지 않게 한다.
//   - 쉼표·따옴표·줄바꿈이 든 칸은 큰따옴표로 감싸고, 안의 큰따옴표는 두 번 쓴다.
//   - 엑셀 수식 주입 방지: 글자가 = + - @ (또는 탭/줄바꿈)으로 시작하면 앞에 ' 를 붙인다.
//     (숫자로 넘긴 값은 글자가 아니므로 그대로 쓴다. 음수 조회수 같은 숫자는 망가지지 않는다.)

export type CsvCell = string | number | boolean | null | undefined

export const CSV_BOM = '﻿'

const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTE = /[",\r\n]/

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? '예' : '아니요'
  let text = String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  if (NEEDS_QUOTE.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(',')
}

// 줄바꿈은 엑셀이 가장 잘 읽는 CRLF. 마지막 줄 뒤에도 줄바꿈을 하나 둔다.
export function buildCsv(headers: string[], rows: CsvCell[][], opts: { bom?: boolean } = {}): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)]
  return `${opts.bom === false ? '' : CSV_BOM}${lines.join('\r\n')}\r\n`
}

// 파일 이름에 쓸 수 없는 글자를 치우고 날짜를 붙인다. 예) "급상승 영상" -> "급상승_영상_2026-09-21.csv"
export function csvFilename(base: string, date: Date = new Date()): string {
  const safe = base.trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'table'
  return `${safe}_${kstDateString(date)}.csv`
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// 한국 시간 날짜 "2026-09-21"
export function kstDateString(date: Date): string {
  const t = new Date(date.getTime() + KST_OFFSET_MS)
  if (Number.isNaN(t.getTime())) return '0000-00-00'
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

// 한국 시간 "2026-09-21 14:30". 값이 없거나 잘못되면 빈 칸.
export function csvDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return ''
  const t = new Date(ms + KST_OFFSET_MS)
  return `${kstDateString(new Date(ms))} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`
}
