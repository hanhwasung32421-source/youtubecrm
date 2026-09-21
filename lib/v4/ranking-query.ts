// 콘텐츠 성과 랭킹의 서버 쪽 정렬·필터·페이지 나누기 (순수 함수, React/DB 의존 없음).
// 라우트(app/api/v4/ranking)가 한 번만 읽은 영상 목록을 여기 함수로 걸러 "요청한 만큼만" 내려준다.

export const RANK_SORT_KEYS = ['viewCount', 'likeCount', 'commentCount', 'daysSincePublished', 'velocity', 'likeRate'] as const
export type RankSortKey = (typeof RANK_SORT_KEYS)[number]
export type RankDir = 'asc' | 'desc'
export type RankFormat = '' | 'longform' | 'shortform'

// 새 파라미터 없이 부르던 예전 화면이 받던 응답을 너무 크지 않게 자르는 상한
export const RANK_LEGACY_MAX = 500
export const RANK_DEFAULT_LIMIT = 10
// 내려받기(CSV)가 200개씩 이어 받을 수 있도록 200 까지 허용한다.
export const RANK_MAX_LIMIT = 200
const MAX_OFFSET = 100000
const MAX_QUERY_LENGTH = 60

export type RankQuery = {
  sort: RankSortKey
  dir: RankDir
  limit: number
  offset: number
  staffId: string
  format: RankFormat
  q: string
  // 올린 요일(0=일~6=토)·시각(0~23), 한국 시간. 없으면 null
  dow: number | null
  hour: number | null
  // 새 파라미터(sort/dir/limit/offset/staffId/format/q/dow/hour)가 하나도 없으면 true → 예전 응답 모양 유지
  legacy: boolean
}

type ParamReader = { get(name: string): string | null }

const NEW_PARAMS = ['sort', 'dir', 'limit', 'offset', 'staffId', 'format', 'q', 'dow', 'hour'] as const

// 범위 안의 정수만 받는다. 비었거나 이상하면 null (= 그 필터를 쓰지 않음).
function toOptionalInt(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

function toInt(raw: string | null, fallback: number, min: number, max: number) {
  if (raw === null || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

export function parseRankQuery(params: ParamReader): RankQuery {
  const legacy = NEW_PARAMS.every((name) => params.get(name) === null)
  const sortRaw = params.get('sort') || ''
  const sort = (RANK_SORT_KEYS as readonly string[]).includes(sortRaw) ? (sortRaw as RankSortKey) : 'viewCount'
  const formatRaw = params.get('format') || ''
  const format: RankFormat = formatRaw === 'longform' || formatRaw === 'shortform' ? formatRaw : ''
  return {
    sort,
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
    // limit=0 은 "표는 필요 없고 요약만" 이라는 뜻으로 허용한다.
    limit: legacy ? RANK_LEGACY_MAX : toInt(params.get('limit'), RANK_DEFAULT_LIMIT, 0, RANK_MAX_LIMIT),
    offset: toInt(params.get('offset'), 0, 0, MAX_OFFSET),
    staffId: (params.get('staffId') || '').trim().slice(0, 64),
    format,
    q: (params.get('q') || '').trim().slice(0, MAX_QUERY_LENGTH),
    dow: toOptionalInt(params.get('dow'), 0, 6),
    hour: toOptionalInt(params.get('hour'), 0, 23),
    legacy
  }
}

export type RankLike = {
  id: string
  title: string
  stockName: string
  ownerId: string | null
  contentType: string
  viewCount: number
  likeCount: number
  commentCount: number
  daysSincePublished: number
  velocity: number
  likeRate: number
  createdAt: string
  // 타이밍 화면과 같은 기준(게시 시각, 없으면 등록 시각)으로 요일·시각을 계산하려고 필요하다.
  publishedAt?: string | null
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// 한국 시간 기준 요일(0=일)·시각. 이상한 값이면 null. (analytics 의 kstWeekdayHour 와 같은 계산)
export function kstSlotOf(iso: string | null | undefined): { weekday: number; hour: number } | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  const kst = new Date(ms + KST_OFFSET_MS)
  return { weekday: kst.getUTCDay(), hour: kst.getUTCHours() }
}

export function filterRanked<T extends RankLike>(items: T[], filter: { staffId?: string; format?: RankFormat; q?: string; dow?: number | null; hour?: number | null }): T[] {
  const staffId = filter.staffId || ''
  const format = filter.format || ''
  const q = (filter.q || '').trim().toLowerCase()
  const dow = typeof filter.dow === 'number' ? filter.dow : null
  const hour = typeof filter.hour === 'number' ? filter.hour : null
  if (!staffId && !format && !q && dow === null && hour === null) return items
  return items.filter((v) => {
    if (staffId && v.ownerId !== staffId) return false
    if (format && v.contentType !== format) return false
    if (q && !v.stockName.toLowerCase().includes(q) && !v.title.toLowerCase().includes(q)) return false
    if (dow !== null || hour !== null) {
      const slot = kstSlotOf(v.publishedAt || v.createdAt)
      if (!slot) return false
      if (dow !== null && slot.weekday !== dow) return false
      if (hour !== null && slot.hour !== hour) return false
    }
    return true
  })
}

const metric = (v: RankLike, key: RankSortKey) => {
  const n = v[key]
  return Number.isFinite(n) ? n : 0
}

// 같은 값이 여러 개여도 "더 보기" 로 이어 받을 때 순서가 바뀌지 않도록 조회수 → 최신 등록 → id 순으로 끝까지 순서를 확정한다.
export function sortRanked<T extends RankLike>(items: T[], sort: RankSortKey, dir: RankDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const primary = (metric(a, sort) - metric(b, sort)) * sign
    if (primary !== 0) return primary
    if (sort !== 'viewCount') {
      const byViews = metric(b, 'viewCount') - metric(a, 'viewCount')
      if (byViews !== 0) return byViews
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

export function pageOf<T>(items: T[], offset: number, limit: number): T[] {
  if (limit <= 0) return []
  return items.slice(Math.max(0, offset), Math.max(0, offset) + limit)
}

export type RankSummary<T> = {
  videoCount: number
  totalViews: number
  avgViews: number
  top: T | null
  rising: T | null
}

// 한 번 훑으면서 합계 / 1위 / "최근 7일 안에 올렸고 조회 속도가 가장 빠른 영상" 을 함께 구한다.
export function summarizeRanked<T extends RankLike>(items: T[]): RankSummary<T> {
  let totalViews = 0
  let top: T | null = null
  for (const v of items) {
    const views = metric(v, 'viewCount')
    totalViews += views
    if (views > 0 && (!top || views > top.viewCount)) top = v
  }
  let rising: T | null = null
  for (const v of items) {
    if (v.daysSincePublished > 7 || v.viewCount <= 0 || (top && v.id === top.id)) continue
    if (!rising || v.velocity > rising.velocity) rising = v
  }
  const videoCount = items.length
  return { videoCount, totalViews, avgViews: videoCount > 0 ? Math.round(totalViews / videoCount) : 0, top, rising }
}
