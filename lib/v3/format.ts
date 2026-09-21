// V3 화면 공통 표기 도우미. 값이 비었거나 NaN/Infinity 이면 늘 '—' 로 보여 준다.

const num = new Intl.NumberFormat('ko-KR')
export const DASH = '—'

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatNumber(value: number | null | undefined): string {
  if (!isNum(value)) return DASH
  return num.format(value)
}

// 소수 첫째 자리까지, 끝이 .0 이면 뗀다. 100 이상이면 정수로. (12.0 -> 12, 3.45 -> 3.5)
function unitValue(v: number): string {
  if (v >= 100) return num.format(Math.round(v))
  return v.toFixed(1).replace(/\.0$/, '')
}

// 좁은 공간용 축약 표기: 12,340 -> 1.2만, 340,000,000 -> 3.4억
export function formatCompactNumber(value: number | null | undefined): string {
  if (!isNum(value)) return DASH
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  // 반올림하면 다음 단위가 되는 경계(9,999.6 -> 1만, 9,999만 6천 -> 1억)도 올려 준다.
  if (Math.round(abs / 10_000) >= 10_000) return `${sign}${unitValue(abs / 100_000_000)}억`
  if (Math.round(abs) >= 10_000) return `${sign}${unitValue(abs / 10_000)}만`
  return `${sign}${num.format(Math.round(abs))}`
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (!isNum(value)) return DASH
  return `${value.toFixed(digits)}%`
}

// 사람이 읽는 "며칠/몇 시간" 표기
export function formatDays(days: number | null | undefined): string {
  if (!isNum(days)) return DASH
  if (days >= 1) return `${days.toFixed(1).replace(/\.0$/, '')}일`
  return `${Math.max(Math.round(days * 24), 1)}시간`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return DASH
  return value.slice(0, 10)
}

// ── 한국 시간(KST) 날짜 ──────────────────────────────────────────
function toMs(value: string | number | Date | null | undefined): number {
  if (value === null || value === undefined || value === '') return NaN
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

const kstParts = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

function kstFields(ms: number) {
  const map: Record<string, string> = {}
  for (const part of kstParts.formatToParts(new Date(ms))) map[part.type] = part.value
  return map
}

// "9/21 (월) 14:30" (올해가 아니면 앞에 연도: "2025/9/21 (일) 14:30")
export function formatKstDateTime(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return DASH
  const f = kstFields(ms)
  const year = kstFields(now).year
  const head = f.year === year ? '' : `${f.year}/`
  return `${head}${f.month}/${f.day} (${f.weekday}) ${f.hour}:${f.minute}`
}

// 예전 이름 그대로 쓰는 화면이 있어서 새 표기로 연결해 둔다.
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return DASH
  const out = formatKstDateTime(value)
  return out === DASH ? String(value) : out
}

// "방금 전" / "5분 전" / "3시간 전" / "3일 전" / "2개월 전" / "1년 전"
export function formatRelative(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  const ms = toMs(value)
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return DASH
  const diff = now - ms
  if (diff < 60_000) return '방금 전'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(diff / 86_400_000)
  if (days < 30) return `${days}일 전`
  if (days < 365) return `${Math.floor(days / 30)}개월 전`
  return `${Math.floor(days / 365)}년 전`
}
