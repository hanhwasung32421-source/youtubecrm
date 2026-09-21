// 표시용 포맷 도우미(클라이언트/서버 공용).
// 날짜 계산은 서버(UTC)와 브라우저(KST)가 달라지지 않도록 모두 한국 시간(KST) 기준이다.
// 숫자가 아닌 값(NaN/Infinity/빈 값)은 항상 "-" 로 보여 준다.

import { getKstYmd } from '@/lib/attendance/time'

const krw = new Intl.NumberFormat('ko-KR')
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function formatKrw(value: number | null | undefined) {
  if (!isNum(value)) return '-'
  return `₩${krw.format(Math.round(value))}`
}

// 대시보드 KPI처럼 자리가 좁은 곳에서 "1.2억", "3,500만"으로 줄여 쓴다.
export function formatKrwCompact(value: number | null | undefined) {
  if (!isNum(value)) return '-'
  const abs = Math.abs(value)
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(abs >= 1_000_000_000 ? 0 : 1).replace(/\.0$/, '')}억`
  if (abs >= 10_000) return `${krw.format(Math.round(value / 10_000))}만`
  return krw.format(Math.round(value))
}

export function formatNumber(value: number | null | undefined) {
  if (!isNum(value)) return '-'
  return krw.format(value)
}

// 조회수처럼 큰 숫자를 좁은 칸에 "1.2만", "3,500만", "1.2억" 으로. 1만 미만은 그대로(1,234).
export function formatCount(value: number | null | undefined) {
  if (!isNum(value)) return '-'
  const abs = Math.abs(value)
  if (abs < 10_000) return krw.format(Math.round(value))
  if (abs < 100_000_000) {
    // 1만 ~ 9,999만: 10만 미만은 소수 한 자리(1.2만), 이상은 정수(123만)
    const man = value / 10_000
    const text = Math.abs(man) < 10 ? man.toFixed(1).replace(/\.0$/, '') : krw.format(Math.round(man))
    // 반올림하면 1억(10,000만)이 되는 경계
    if (text === '10,000') return '1억'
    return `${text}만`
  }
  const eok = value / 100_000_000
  return `${Math.abs(eok) < 10 ? eok.toFixed(1).replace(/\.0$/, '') : krw.format(Math.round(eok))}억`
}

// 비율(0~1)을 퍼센트로. 분모가 0이거나 숫자가 아니면 "-".
export function formatPercent(ratio: number | null | undefined, digits = 1) {
  if (!isNum(ratio)) return '-'
  const text = (ratio * 100).toFixed(digits)
  return `${text.replace(/\.0+$/, '')}%`
}

// 나눗셈: 분모가 0/NaN/Infinity 이면 null.
export function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null
  const result = numerator / denominator
  return Number.isFinite(result) ? result : null
}

// 변화율 표시: "+32%", "-8%", 0 은 "0%". 숫자가 아니면 "-".
export function formatSignedPercent(value: number | null | undefined) {
  if (!isNum(value)) return '-'
  const rounded = Math.round(value * 100) / 100
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

export function toYmd(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 오늘 날짜(KST, YYYY-MM-DD). 서버가 UTC로 돌아도 같은 값이 나온다.
export function todayYmd() {
  return getKstYmd(new Date())
}

export function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toYmd(date)
}

// 두 날짜(YYYY-MM-DD) 사이 일수. b - a. 형식이 틀리면 0.
export function diffDays(a: string, b: string) {
  if (!YMD_RE.test(a) || !YMD_RE.test(b)) return 0
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ta = Date.UTC(ay, am - 1, ad)
  const tb = Date.UTC(by, bm - 1, bd)
  return Math.round((tb - ta) / 86_400_000)
}

// ---------------------------------------------------------------------------
// 한국 시간(KST) 날짜/시각 표시. 브라우저 시간대와 상관없이 같은 글자가 나온다.
// ---------------------------------------------------------------------------

type KstParts = { y: number; m: number; d: number; hh: number; mm: number; weekday: string }

function kstParts(value: string | number | Date | null | undefined): KstParts | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()
  if (!Number.isFinite(ms)) return null
  const k = new Date(ms + KST_OFFSET_MS)
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(), hh: k.getUTCHours(), mm: k.getUTCMinutes(), weekday: WEEKDAYS[k.getUTCDay()] }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// 날짜만(YYYY-MM-DD)의 요일. 잘못된 날짜면 ''.
export function weekdayOfYmd(ymd: string) {
  if (!YMD_RE.test(ymd)) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ''
  return WEEKDAYS[date.getUTCDay()]
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  // 날짜만(YYYY-MM-DD)인 경우 그대로, timestamptz면 한국 날짜로
  if (YMD_RE.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return getKstYmd(date)
}

// "9/21 (월)" — 날짜(YYYY-MM-DD)나 시각(ISO) 모두 받는다.
export function formatDayShort(value: string | null | undefined) {
  if (!value) return '-'
  if (YMD_RE.test(value)) {
    const wd = weekdayOfYmd(value)
    if (!wd) return value
    const [, m, d] = value.split('-').map(Number)
    return `${m}/${d} (${wd})`
  }
  const p = kstParts(value)
  return p ? `${p.m}/${p.d} (${p.weekday})` : '-'
}

// "9/21 (월) 14:30" (한국 시간). 값이 없거나 잘못되면 "-".
export function formatKstShort(value: string | number | Date | null | undefined) {
  const p = kstParts(value)
  return p ? `${p.m}/${p.d} (${p.weekday}) ${pad2(p.hh)}:${pad2(p.mm)}` : '-'
}

// "2026-09-21 14:30" (한국 시간) — title(마우스를 올리면 뜨는 정확한 시각)에 쓴다.
export function formatKstFull(value: string | number | Date | null | undefined) {
  const p = kstParts(value)
  return p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)} ${pad2(p.hh)}:${pad2(p.mm)} (한국 시간)` : ''
}

// 예전 이름 유지: 이제 한국 시간 "9/21 (월) 14:30" 형식.
export function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const p = kstParts(value)
  return p ? formatKstShort(value) : value
}

// "방금 전 / 5분 전 / 3시간 전 / 어제 / 4일 전 / 9/21 (월)". 미래 시각이나 잘못된 값은 절대 시각으로.
export function formatRelative(value: string | number | Date | null | undefined, now: number = Date.now()) {
  const p = kstParts(value)
  if (!p) return '-'
  const ms = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime()
  const diff = now - ms
  if (!Number.isFinite(diff) || diff < -60_000) return formatKstShort(value)
  const min = Math.floor(Math.max(diff, 0) / 60_000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 전`
  // 날짜 차이는 한국 날짜 기준(밤 11시에 올린 글이 다음 날 아침에 "어제")
  const today = kstParts(now)
  if (!today) return formatKstShort(value)
  const dayDiff = Math.round((Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86_400_000)
  if (dayDiff <= 1) return '어제'
  if (dayDiff < 7) return `${dayDiff}일 전`
  return `${p.m}/${p.d} (${p.weekday})`
}

export function formatShortDate(ymd: string) {
  if (!YMD_RE.test(ymd)) return '-'
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}`
}

// ---------------------------------------------------------------------------
// ISO-8601 주차(월~일). 모두 UTC 날짜 계산이라 서버/브라우저 시간대와 무관하다.
// ---------------------------------------------------------------------------

// 날짜(YYYY-MM-DD)가 속한 ISO-8601 주차 라벨("2026-W38"). 형식이 틀리면 ''.
export function isoWeekLabelFromYmd(ymd: string) {
  if (!YMD_RE.test(ymd)) return ''
  const [y, m, day] = ymd.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, day))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// 주간 회고의 주차 라벨. 한국 시간 기준이라 월요일 새벽에도 서버/브라우저가 같은 주를 가리킨다.
export function isoWeekLabel(date: Date = new Date()) {
  return isoWeekLabelFromYmd(getKstYmd(date))
}

// "2026-W38" → { start: '2026-09-14', end: '2026-09-20' } (월~일). 형식이 다르거나 없는 주차(예: 2027-W53)면 null.
export function isoWeekRangeYmd(label: string): { start: string; end: string } | null {
  const match = ISO_WEEK_RE.exec(label)
  if (!match) return null
  const year = Number(match[1])
  const week = Number(match[2])
  if (week < 1 || week > 53) return null
  // 1월 4일은 항상 1주차. 그 주의 월요일을 구한 뒤 (week-1)주를 더한다.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const monday = new Date(jan4.getTime() + (1 - jan4Day) * 86_400_000 + (week - 1) * 7 * 86_400_000)
  const sunday = new Date(monday.getTime() + 6 * 86_400_000)
  const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const range = { start: iso(monday), end: iso(sunday) }
  // 그 해에 없는 주차(53주가 없는 해의 W53)는 다음 해 1주로 넘어가므로 걸러 낸다.
  if (isoWeekLabelFromYmd(range.start) !== label) return null
  return range
}

// "2026-W38" → "9월 14일 ~ 9월 20일" (월~일). 형식이 다르면 라벨 그대로 돌려준다.
export function isoWeekRangeText(label: string) {
  const range = isoWeekRangeYmd(label)
  if (!range) return label
  const fmt = (ymd: string) => {
    const [, m, d] = ymd.split('-').map(Number)
    return `${m}월 ${d}일`
  }
  return `${fmt(range.start)} ~ ${fmt(range.end)}`
}

// 시작일로부터 오늘까지 며칠째인지(시작일 당일 = 1일째).
export function daysSince(ymd: string) {
  return Math.max(diffDays(ymd, todayYmd()) + 1, 1)
}

// 실험 진행 일수(D+N): 시작일 당일이 D+0. 시작일이 미래거나 형식이 틀리면 0.
export function daysRunningFrom(startedOn: string, today: string = todayYmd()) {
  return Math.max(diffDays(startedOn, today), 0)
}

// datetime-local input 값(YYYY-MM-DDTHH:mm)으로 변환
export function toDateTimeLocal(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${toYmd(date)}T${hh}:${mm}`
}
