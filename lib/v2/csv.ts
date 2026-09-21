// 표를 CSV 파일로 저장하기 위한 순수 계산 모듈 (브라우저·서버 없이 단독으로 시험할 수 있다).
//  - 엑셀에서 한글이 깨지지 않도록 맨 앞에 UTF-8 BOM 을 붙인다.
//  - 따옴표·쉼표·줄바꿈이 들어간 칸은 큰따옴표로 감싸고, 안의 큰따옴표는 두 번 쓴다.
//  - 엑셀이 수식으로 읽지 않도록 = + - @ (그리고 탭·줄바꿈)으로 시작하는 글자 앞에 ' 를 붙인다.
//    (숫자 칸은 음수여도 그대로 둔다. 글자로 들어온 값만 막는다.)

export const CSV_BOM = String.fromCharCode(0xfeff)
export const CSV_EOL = '\r\n'

export type CsvValue = string | number | boolean | null | undefined

const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  let text: string
  if (typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : ''
  } else if (typeof value === 'boolean') {
    text = value ? '예' : '아니요'
  } else {
    text = String(value)
    // '-' 한 글자는 "값 없음" 표시일 뿐 수식이 될 수 없으므로 그대로 둔다.
    if (text !== '-' && FORMULA_START.test(text)) text = `'${text}`
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(',')
}

// 제목줄 + 본문 줄들을 하나의 CSV 글자로. 마지막에도 줄바꿈을 둔다.
export function buildCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[], options: { bom?: boolean } = {}): string {
  const bom = options.bom === false ? '' : CSV_BOM
  const lines = [csvRow(headers), ...rows.map(csvRow)]
  return bom + lines.join(CSV_EOL) + CSV_EOL
}

// 파일 이름에 쓸 수 없는 글자를 밑줄로 바꾼다. 예: csvFileName('성과 요약', '2026-09-21') → 성과_요약_2026-09-21.csv
export function csvFileName(base: string, ymd: string): string {
  const safe = base.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'table'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : ''
  return day ? `${safe}_${day}.csv` : `${safe}.csv`
}
