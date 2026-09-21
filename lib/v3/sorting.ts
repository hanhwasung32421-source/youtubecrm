// V3 목록 정렬/검색 순수 함수. 같은 값이면 원래 순서를 지켜서(안정 정렬) 화면이 흔들리지 않게 한다. (외부 import 없음)

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// 값이 없는(null/NaN) 항목은 정렬 방향과 상관없이 맨 뒤로 보낸다.
function byNumberDesc<T>(items: T[], pick: (item: T) => number | null | undefined): T[] {
  return items
    .map((item, index) => ({ item, index, v: pick(item) }))
    .sort((a, b) => {
      const av = isNum(a.v)
      const bv = isNum(b.v)
      if (av && bv) return (b.v as number) - (a.v as number) || a.index - b.index
      if (av) return -1
      if (bv) return 1
      return a.index - b.index
    })
    .map((x) => x.item)
}

export function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

// ── 급상승 영상 ──
export type ViralSort = 'ratio' | 'views' | 'recent'
export function sortViralItems<T extends { ratio: number; viewCount: number | null; publishedAt?: string | null }>(items: T[], sort: string): T[] {
  if (sort === 'views') return byNumberDesc(items, (i) => i.viewCount)
  if (sort === 'recent') return byNumberDesc(items, (i) => timeOf(i.publishedAt))
  return byNumberDesc(items, (i) => i.ratio)
}

// ── 참여 현황의 영상별 순위 ──
export type EngagementRow = {
  id: string
  title: string
  stockName: string | null
  contentType: string
  viewCount: number
  likeRatePct: number
  commentRatePct: number
  engagementPct: number
  publishedAt: string | null
  youtubeUrl: string | null
}
export function sortEngagementRows<T extends Pick<EngagementRow, 'viewCount' | 'commentRatePct' | 'engagementPct' | 'publishedAt'>>(rows: T[], sort: string): T[] {
  if (sort === 'engagement') return byNumberDesc(rows, (r) => r.engagementPct)
  if (sort === 'views') return byNumberDesc(rows, (r) => r.viewCount)
  if (sort === 'recent') return byNumberDesc(rows, (r) => timeOf(r.publishedAt))
  return byNumberDesc(rows, (r) => r.commentRatePct)
}

// ── 조회수 성장의 영상 고르기 목록 ──
export function sortLifecycleItems<T extends { viewCount: number | null; snapshotCount: number | null }>(items: T[], sort: string): T[] {
  if (sort === 'views') return byNumberDesc(items, (i) => i.viewCount)
  if (sort === 'records') return byNumberDesc(items, (i) => i.snapshotCount)
  return items.slice() // recent: 서버가 이미 최근 등록 순으로 준다
}

export function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => (f || '').toLowerCase().includes(needle))
}

// ── 시리즈 ──
export type SeriesForSort = { videoCount: number; avgEngagementPct: number; avgVelocity: number; baselineEngagementPct: number; baselineVelocity: number }

function change(current: number, previous: number): number | null {
  if (!isNum(current) || !isNum(previous) || previous === 0) return null
  const r = ((current - previous) / Math.abs(previous)) * 100
  return Number.isFinite(r) ? r : null
}

// 시리즈 밖 영상보다 얼마나 나은지(참여율·하루 조회수 변화율의 평균). 영상이 없거나 비교할 기준이 없으면 null
export function seriesEffectScore(s: SeriesForSort): number | null {
  if (s.videoCount === 0) return null
  const e = change(s.avgEngagementPct, s.baselineEngagementPct)
  const v = change(s.avgVelocity, s.baselineVelocity)
  if (e === null && v === null) return null
  return ((e ?? 0) + (v ?? 0)) / (e !== null && v !== null ? 2 : 1)
}

export function sortSeriesRows<T extends SeriesForSort>(rows: T[], sort: string): T[] {
  if (sort === 'effect') return byNumberDesc(rows, seriesEffectScore)
  if (sort === 'videos') return byNumberDesc(rows, (r) => r.videoCount)
  return rows.slice() // recent: 서버가 최근 만든 순으로 준다
}
