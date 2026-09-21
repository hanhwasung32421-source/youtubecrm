// 숫자를 비전공자가 바로 읽을 수 있게 줄여 쓰는 도우미 (조/억/만).
// 정확한 값이 필요한 표에서는 toLocaleString('ko-KR')을, 요약·카드에서는 formatCount를 쓴다.

export function formatNumber(value: number | null | undefined): string {
  return Math.round(Number.isFinite(value as number) ? (value as number) : 0).toLocaleString('ko-KR')
}

function trim(n: number): string {
  // 12.0 -> 12, 1.24 -> 1.2
  const fixed = n >= 100 ? Math.round(n).toString() : n.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

export function formatCount(value: number | null | undefined): string {
  const n = Math.round(Number.isFinite(value as number) ? (value as number) : 0)
  const abs = Math.abs(n)
  if (abs >= 999_950_000_000) return `${trim(n / 1_000_000_000_000)}조`
  if (abs >= 99_995_000) return `${trim(n / 100_000_000)}억`
  if (abs >= 10_000) return `${trim(n / 10_000)}만`
  return n.toLocaleString('ko-KR')
}

// 긴 제목을 한 줄 요약에 넣을 때
export function shortText(text: string | null | undefined, max = 28): string {
  const value = (text || '').trim()
  if (!value) return '(제목 수집 대기)'
  return value.length > max ? `${value.slice(0, max)}…` : value
}

// ---- 안전한 숫자 표시 (라운드 3) ----
// NaN / Infinity / 값 없음은 0이 아니라 '-' 로 보여준다. (0 과 "모름"을 구분하기 위해)

export function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// 29,000 / 1.2만 / 3.4억. 값이 없으면 '-'
export function formatCountOrDash(value: number | null | undefined): string {
  return isNum(value) ? formatCount(value) : '-'
}

// 12,345 (정확한 값). 값이 없으면 '-'
export function formatExact(value: number | null | undefined): string {
  return isNum(value) ? Math.round(value).toLocaleString('ko-KR') : '-'
}

// 이미 % 단위인 값(3.456)을 '3.5%' 로. 값이 없으면 '-'
export function formatPercent(value: number | null | undefined, digits = 1): string {
  return isNum(value) ? `${value.toFixed(digits)}%` : '-'
}

// 나눗셈: 분모가 0/비정상이면 null
export function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null
  const r = numerator / denominator
  return Number.isFinite(r) ? r : null
}

// 평균: 빈 목록이면 null
export function safeAverage(values: readonly (number | null | undefined)[]): number | null {
  const nums = values.filter(isNum)
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// 0~100 으로 자른 점수 (NaN 은 0)
export function clampScore(value: number | null | undefined): number {
  return isNum(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0
}
