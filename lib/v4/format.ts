// 클라이언트/서버 공용 포맷 유틸 (React 의존 없음).

export function fmtNumber(value: number | null | undefined) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('ko-KR')
}

export function fmtCompact(value: number | null | undefined) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1)}억`
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}만`
  return Math.round(n).toLocaleString('ko-KR')
}

export function fmtPercent(ratio: number | null | undefined, digits = 2) {
  const n = Number(ratio || 0)
  if (!Number.isFinite(n)) return '0%'
  return `${(n * 100).toFixed(digits)}%`
}

export function fmtDateKst(iso: string | null | undefined) {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .replace(/\.\s?/g, '.')
    .replace(/\.$/, '')
}

export function fmtRelative(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '-'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '-'
  const diffSec = Math.max(0, Math.floor((now - t) / 1000))
  if (diffSec < 60) return '방금 전'
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}일 전`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}개월 전`
  return `${Math.floor(month / 12)}년 전`
}

export function shortYmd(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}`
}

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

// ---------------------------------------------------------------- 분석 화면용 쉬운 표기 (Round 1 추가)

// 1,234 / 1.2만 / 123만 / 1.2억 — 큰 숫자를 읽기 쉽게 줄인다. 정확한 값은 호출부에서 title 등으로 보조.
export function fmtShort(value: number | null | undefined) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  const trim = (x: number, digits: number) => x.toFixed(digits).replace(/\.0+$/, '')
  if (abs >= 100000000) return `${trim(n / 100000000, 1)}억`
  if (abs >= 1000000) return `${Math.round(n / 10000).toLocaleString('ko-KR')}만`
  if (abs >= 10000) return `${trim(n / 10000, 1)}만`
  return Math.round(n).toLocaleString('ko-KR')
}

// 0~23시 → 오전 7시 / 낮 12시 / 오후 7시 / 자정
export function fmtHourKo(hour: number) {
  const h = ((Math.round(hour) % 24) + 24) % 24
  if (h === 0) return '자정'
  if (h === 12) return '낮 12시'
  return h < 12 ? `오전 ${h}시` : `오후 ${h - 12}시`
}

// 19 → "오후 7시~8시", 11 → "오전 11시~낮 12시", 23 → "오후 11시~자정"
export function fmtHourRangeKo(hour: number) {
  const start = fmtHourKo(hour)
  const end = fmtHourKo(hour + 1)
  const prefix = (s: string) => (s.startsWith('오전') ? '오전' : s.startsWith('오후') ? '오후' : '')
  if (prefix(start) && prefix(start) === prefix(end)) return `${start}~${end.replace(`${prefix(end)} `, '')}`
  return `${start}~${end}`
}

// ---------------------------------------------------------------- Round 3: 안전한 표기 / 한국 시간 표기

// 숫자가 아니거나 무한대(NaN, Infinity, 0으로 나눈 값)면 "-" 로 보여준다. 0 은 정상 값이므로 "0" 으로 표시한다.
export function isFiniteNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function fmtNumberOr(value: number | null | undefined, fallback = '-') {
  return isFiniteNum(value) ? Math.round(value).toLocaleString('ko-KR') : fallback
}

export function fmtShortOr(value: number | null | undefined, fallback = '-') {
  return isFiniteNum(value) ? fmtShort(value) : fallback
}

export function fmtPercentOr(ratio: number | null | undefined, digits = 1, fallback = '-') {
  return isFiniteNum(ratio) ? `${(ratio * 100).toFixed(digits)}%` : fallback
}

// 나눗셈 도우미: 분모가 0/음수/비정상이면 null (화면에서는 "-")
export function ratioOf(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!isFiniteNum(numerator) || !isFiniteNum(denominator) || denominator <= 0) return null
  const r = numerator / denominator
  return Number.isFinite(r) ? r : null
}

// 평균 대비 차이를 "▲ 12%" / "▼ 8%" / "평균과 비슷" 으로 (색이 아니라 기호로도 방향이 보이게)
export function fmtDeltaVsMean(value: number | null | undefined, mean: number | null | undefined, tolerance = 0.05) {
  const ratio = ratioOf(value, mean)
  if (ratio === null) return '-'
  const diff = ratio - 1
  if (Math.abs(diff) <= tolerance) return '평균과 비슷'
  return `${diff > 0 ? '▲' : '▼'} ${Math.abs(Math.round(diff * 100))}%`
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const pad2 = (n: number) => String(n).padStart(2, '0')

function kstParts(iso: string | null | undefined) {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms + KST_OFFSET_MS)
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

// "9/21 (월) 14:30" (한국 시간)
export function fmtKstStamp(iso: string | null | undefined) {
  const p = kstParts(iso)
  if (!p) return '-'
  return `${p.month}/${p.day} (${WEEKDAY_LABELS[p.weekday]}) ${pad2(p.hour)}:${pad2(p.minute)}`
}

// "9/21 (월)"
export function fmtKstMonthDay(iso: string | null | undefined) {
  const p = kstParts(iso)
  if (!p) return '-'
  return `${p.month}/${p.day} (${WEEKDAY_LABELS[p.weekday]})`
}

// 'YYYY-MM-DD' 날짜(시각 없음) → "9/21 (월)". 시간대 영향이 없도록 UTC 정오로 계산한다.
export function fmtYmdKo(ymd: string | null | undefined) {
  if (!ymd) return '-'
  const parts = String(ymd).slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '-'
  const [y, m, d] = parts
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== m - 1) return '-'
  return `${m}/${d} (${WEEKDAY_LABELS[date.getUTCDay()]})`
}
