// 날짜는 전부 한국 시간(KST, UTC+9) 기준 달력 날짜('YYYY-MM-DD')로 다룬다.
// 서버(Vercel, UTC)와 브라우저(KST)가 같은 "오늘"을 보게 하려는 목적.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const
// 월요일 시작 주간 그리드용 순서
export const WEEKDAY_LABELS_MON_FIRST = ['월', '화', '수', '목', '금', '토', '일'] as const

export function kstYmd(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export function kstDayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`)
}

export function kstDayEnd(ymd: string): Date {
  return new Date(kstDayStart(ymd).getTime() + DAY_MS)
}

export function addDays(ymd: string, days: number): string {
  return kstYmd(new Date(kstDayStart(ymd).getTime() + days * DAY_MS))
}

// 달력 날짜의 요일(0=일 ... 6=토). 타임존과 무관하게 날짜 자체의 요일을 구한다.
export function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay()
}

export function weekStartMonday(ymd: string): string {
  const diff = (weekdayOf(ymd) + 6) % 7
  return addDays(ymd, -diff)
}

export function formatKstTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
}

// 'MM/DD HH:mm' (KST)
export function formatKstDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const ymd = kstYmd(d)
  return `${ymd.slice(5, 7)}/${ymd.slice(8, 10)} ${formatKstTime(iso)}`
}

export function formatKstDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return kstYmd(d)
}

// 'M월 D일 (요일)'
export function formatYmdLabel(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}월 ${d}일 (${WEEKDAY_LABELS[weekdayOf(ymd)]})`
}

// 오늘(또는 endYmd)까지 최근 n일의 달력 날짜 목록 (오름차순)
export function lastNDays(n: number, endYmd: string = kstYmd()): string[] {
  const days: string[] = []
  for (let i = n - 1; i >= 0; i -= 1) days.push(addDays(endYmd, -i))
  return days
}

// ISO 타임스탬프의 KST 기준 시(0~23). published_at 등 "발행 시각" 분석에 사용.
export function kstHourOfIso(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() + KST_OFFSET_MS).getUTCHours()
}

// ISO 타임스탬프의 KST 기준 요일(0=일 ... 6=토)
export function kstWeekdayOfIso(iso: string | null | undefined): number | null {
  if (!iso) return null
  return weekdayOf(kstYmd(new Date(iso)))
}

// 특정 날짜(YYYY-MM-DD)의 특정 시각을 KST ISO로 반환
export function kstIsoAt(ymd: string, hour: number, minute = 0): string {
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`).toISOString()
}

// 발행 이후 경과 일수(최소 1일 — 0으로 나누는 것을 방지)
export function daysSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 1
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 1
  const diff = (now - d.getTime()) / DAY_MS
  return Math.max(diff, 1 / 24)
}

// '2026-02-30' 같은 존재하지 않는 날짜를 걸러낸다. (형식은 정확히 YYYY-MM-DD)
export function isRealYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// ---- 화면 표시용 (라운드 3) ----
// Intl 의 hour12:false 는 자정을 "24:05"로 내는 브라우저가 있어, 오프셋 계산으로 직접 만든다.

function kstParts(iso: string | null | undefined): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const k = new Date(t + KST_OFFSET_MS)
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(), hh: k.getUTCHours(), mm: k.getUTCMinutes(), weekday: k.getUTCDay() }
}

// '9/21 (월) 14:30' (KST). 값이 없거나 잘못되면 '-'
export function formatKstStamp(iso: string | null | undefined): string {
  const p = kstParts(iso)
  if (!p) return '-'
  return `${p.m}/${p.d} (${WEEKDAY_LABELS[p.weekday]}) ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`
}

// '9/21 (월)' (KST 날짜만)
export function formatKstMonthDay(iso: string | null | undefined): string {
  const p = kstParts(iso)
  if (!p) return '-'
  return `${p.m}/${p.d} (${WEEKDAY_LABELS[p.weekday]})`
}

// '방금 전' / '5분 전' / '3시간 전' / '3일 전' / '2개월 전'. 값이 없거나 잘못되면 '-'.
// 시계가 어긋나 미래로 보이는 값은 1분 안이면 '방금 전', 그보다 멀면 '곧'.
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '-'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t) || !Number.isFinite(now)) return '-'
  const diff = now - t
  if (diff < 0) return diff > -60_000 ? '방금 전' : '곧'
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}일 전`
  if (day < 365) return `${Math.floor(day / 30)}개월 전`
  return `${Math.floor(day / 365)}년 전`
}
