// 표시용 포맷 도우미(클라이언트/서버 공용).

const krw = new Intl.NumberFormat('ko-KR')

export function formatKrw(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `₩${krw.format(Math.round(value))}`
}

// 대시보드 KPI처럼 자리가 좁은 곳에서 "1.2억", "3,500만"으로 줄여 쓴다.
export function formatKrwCompact(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const abs = Math.abs(value)
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(abs >= 1_000_000_000 ? 0 : 1).replace(/\.0$/, '')}억`
  if (abs >= 10_000) return `${krw.format(Math.round(value / 10_000))}만`
  return krw.format(Math.round(value))
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return krw.format(value)
}

export function toYmd(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayYmd() {
  return toYmd(new Date())
}

export function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toYmd(date)
}

// 두 날짜(YYYY-MM-DD) 사이 일수. b - a.
export function diffDays(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ta = Date.UTC(ay, am - 1, ad)
  const tb = Date.UTC(by, bm - 1, bd)
  return Math.round((tb - ta) / 86_400_000)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  // 날짜만(YYYY-MM-DD)인 경우 그대로, timestamptz면 로컬 날짜로
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return toYmd(date)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${toYmd(date)} ${hh}:${mm}`
}

export function formatShortDate(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}`
}

// ISO-8601 주차 라벨("2026-W38"). 주간 회고의 주차 자동 계산에 쓴다.
export function isoWeekLabel(date: Date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// "2026-W38" → "9월 14일 ~ 9월 20일" (월~일). 형식이 다르면 라벨 그대로 돌려준다.
export function isoWeekRangeText(label: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(label)
  if (!match) return label
  const year = Number(match[1])
  const week = Number(match[2])
  // 1월 4일은 항상 1주차. 그 주의 월요일을 구한 뒤 (week-1)주를 더한다.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const monday = new Date(jan4.getTime() + (1 - jan4Day) * 86_400_000 + (week - 1) * 7 * 86_400_000)
  const sunday = new Date(monday.getTime() + 6 * 86_400_000)
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
  return `${fmt(monday)} ~ ${fmt(sunday)}`
}

// 시작일로부터 오늘까지 며칠째인지(시작일 당일 = 1일째).
export function daysSince(ymd: string) {
  return Math.max(diffDays(ymd, todayYmd()) + 1, 1)
}

// datetime-local input 값(YYYY-MM-DDTHH:mm)으로 변환
export function toDateTimeLocal(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${toYmd(date)}T${hh}:${mm}`
}
