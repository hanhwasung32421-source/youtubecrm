// V4 성장/성과 분석 — youtubeCRM_videos 행을 받아 순수 JS로 집계하는 함수 모음.
// API 라우트는 DB에서 필요한 컬럼만 가져온 뒤 여기 함수에 넘겨 결과를 그대로 응답한다.
// 모든 함수는 빈 배열에도 NaN 없이 동작해야 한다.

import { addDaysToYmd, getKstDayEndIso, getKstDayStartIso, getKstYmd, getYmdList } from '@/lib/attendance/time'

export const PERIOD_OPTIONS = [7, 30, 90] as const
export type PeriodDays = (typeof PERIOD_OPTIONS)[number]

export function parsePeriod(value: string | null | undefined): PeriodDays {
  const n = Number(value)
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? (n as PeriodDays) : 30
}

export type PeriodRange = {
  days: PeriodDays
  startYmd: string
  endYmd: string
  startIso: string
  endIso: string
  prevStartYmd: string
  prevEndYmd: string
  prevStartIso: string
  prevEndIso: string
}

export function getPeriodRange(days: PeriodDays, now = new Date()): PeriodRange {
  const endYmd = getKstYmd(now)
  const startYmd = addDaysToYmd(endYmd, -(days - 1))
  const prevEndYmd = addDaysToYmd(startYmd, -1)
  const prevStartYmd = addDaysToYmd(prevEndYmd, -(days - 1))
  return {
    days,
    startYmd,
    endYmd,
    startIso: getKstDayStartIso(startYmd),
    endIso: getKstDayEndIso(endYmd),
    prevStartYmd,
    prevEndYmd,
    prevStartIso: getKstDayStartIso(prevStartYmd),
    prevEndIso: getKstDayEndIso(prevEndYmd)
  }
}

export const VIDEO_COLUMNS =
  'id, youtube_video_id, title, title_override, stock_name, content_type, published_at, created_at, view_count, like_count, comment_count, youtube_url, thumbnail_url, primary_owner_user_id, last_synced_at'

// 화면별로 꼭 필요한 컬럼만 읽어 6,000행 이상도 가볍게 가져온다. (id, created_at 은 페이지 병합/기간 분할에 항상 필요)
export const KPI_COLUMNS = 'id, content_type, created_at, view_count, like_count, comment_count'
export const STOCK_COLUMNS = 'id, stock_name, published_at, created_at, view_count, primary_owner_user_id'
export const TIMING_COLUMNS = 'id, published_at, created_at, view_count'
export const STAFF_COLUMNS = 'id, primary_owner_user_id, content_type, created_at, view_count, like_count'
export const RANKING_COLUMNS =
  'id, youtube_video_id, title, title_override, stock_name, content_type, published_at, created_at, view_count, like_count, comment_count, youtube_url, primary_owner_user_id'

export type VideoRow = {
  id: string
  youtube_video_id: string | null
  title: string | null
  title_override: string | null
  stock_name: string | null
  content_type: string | null
  published_at: string | null
  created_at: string
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  youtube_url: string | null
  thumbnail_url: string | null
  primary_owner_user_id: string | null
  last_synced_at: string | null
}

export type UserLite = { id: string; name: string; role_type: string; employment_status: string | null }

export function videoTitle(video: VideoRow) {
  return (video.title || video.title_override || video.youtube_video_id || '(제목 없음)').trim()
}

export function videoUrl(video: VideoRow) {
  if (video.youtube_url) return video.youtube_url
  if (video.youtube_video_id) return `https://www.youtube.com/watch?v=${video.youtube_video_id}`
  return ''
}

export function stockKey(video: VideoRow) {
  return (video.stock_name || '').trim() || '(종목 미지정)'
}

export function num(value: number | string | null | undefined) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function safeDiv(a: number, b: number) {
  return b > 0 ? a / b : 0
}

// KST 기준 YYYY-MM-DD (created_at 기준 등록일)
export function kstYmdOf(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return getKstYmd(date)
}

// ---------------------------------------------------------------- KPI

export type Kpis = {
  totalViews: number
  totalLikes: number
  totalComments: number
  videoCount: number
  avgViews: number
  likeRate: number
  commentRate: number
  longformCount: number
  shortformCount: number
  longformShare: number
}

export function computeKpis(videos: VideoRow[]): Kpis {
  let totalViews = 0
  let totalLikes = 0
  let totalComments = 0
  let longformCount = 0
  let shortformCount = 0
  for (const v of videos) {
    totalViews += num(v.view_count)
    totalLikes += num(v.like_count)
    totalComments += num(v.comment_count)
    if (v.content_type === 'shortform') shortformCount += 1
    else longformCount += 1
  }
  const videoCount = videos.length
  return {
    totalViews,
    totalLikes,
    totalComments,
    videoCount,
    avgViews: Math.round(safeDiv(totalViews, videoCount)),
    likeRate: safeDiv(totalLikes, totalViews),
    commentRate: safeDiv(totalComments, totalViews),
    longformCount,
    shortformCount,
    longformShare: safeDiv(longformCount, videoCount)
  }
}

// ---------------------------------------------------------------- 일별 타임라인

export type DailyPoint = { ymd: string; uploads: number; views: number }

export function computeDailySeries(videos: VideoRow[], startYmd: string, endYmd: string): DailyPoint[] {
  const map = new Map<string, DailyPoint>()
  for (const ymd of getYmdList(startYmd, endYmd)) {
    map.set(ymd, { ymd, uploads: 0, views: 0 })
  }
  for (const v of videos) {
    const ymd = kstYmdOf(v.created_at)
    const point = map.get(ymd)
    if (!point) continue
    point.uploads += 1
    point.views += num(v.view_count)
  }
  return Array.from(map.values())
}

// ---------------------------------------------------------------- 랭킹

export type RankedVideo = {
  id: string
  title: string
  stockName: string
  ownerId: string | null
  ownerName: string
  contentType: string
  viewCount: number
  likeCount: number
  commentCount: number
  likeRate: number
  daysSincePublished: number
  velocity: number
  publishedAt: string | null
  createdAt: string
  thumbnailUrl: string | null
  youtubeUrl: string
}

export function rankVideos(videos: VideoRow[], users: Map<string, UserLite>, now = Date.now()): RankedVideo[] {
  return videos.map((v) => {
    const publishedIso = v.published_at || v.created_at
    const publishedMs = new Date(publishedIso).getTime()
    const elapsedDays = Number.isNaN(publishedMs) ? 0 : Math.max(0, (now - publishedMs) / 86400000)
    const views = num(v.view_count)
    return {
      id: v.id,
      title: videoTitle(v),
      stockName: stockKey(v),
      ownerId: v.primary_owner_user_id,
      ownerName: (v.primary_owner_user_id && users.get(v.primary_owner_user_id)?.name) || '미지정',
      contentType: v.content_type || 'longform',
      viewCount: views,
      likeCount: num(v.like_count),
      commentCount: num(v.comment_count),
      likeRate: safeDiv(num(v.like_count), views),
      daysSincePublished: Math.floor(elapsedDays),
      // 조회 속도 = 조회수 / 게시 후 경과일 (최소 1일로 나눠 당일 영상이 폭주하지 않게)
      velocity: Math.round(views / Math.max(elapsedDays, 1)),
      publishedAt: v.published_at,
      createdAt: v.created_at,
      thumbnailUrl: v.thumbnail_url,
      youtubeUrl: videoUrl(v)
    }
  })
}

// ---------------------------------------------------------------- 종목 집계

export type StockTrend = 'up' | 'down' | 'flat' | 'new'

export type StockAggregate = {
  stockName: string
  videoCount: number
  totalViews: number
  avgViews: number
  lastMentionedAt: string | null
  ownerCount: number
  prevViews: number
  prevVideoCount: number
  changeRatio: number
  trend: StockTrend
  sizeClass: 'xl' | 'lg' | 'md' | 'sm'
}

export function aggregateStocks(current: VideoRow[], previous: VideoRow[]): StockAggregate[] {
  type Acc = { videoCount: number; totalViews: number; last: string | null; owners: Set<string> }
  const cur = new Map<string, Acc>()
  for (const v of current) {
    const key = stockKey(v)
    const acc = cur.get(key) || { videoCount: 0, totalViews: 0, last: null, owners: new Set<string>() }
    acc.videoCount += 1
    acc.totalViews += num(v.view_count)
    const when = v.published_at || v.created_at
    if (!acc.last || when > acc.last) acc.last = when
    if (v.primary_owner_user_id) acc.owners.add(v.primary_owner_user_id)
    cur.set(key, acc)
  }
  const prev = new Map<string, { videoCount: number; totalViews: number }>()
  for (const v of previous) {
    const key = stockKey(v)
    const acc = prev.get(key) || { videoCount: 0, totalViews: 0 }
    acc.videoCount += 1
    acc.totalViews += num(v.view_count)
    prev.set(key, acc)
  }

  const rows = Array.from(cur.entries()).map(([stockName, acc]) => {
    const p = prev.get(stockName)
    const prevViews = p?.totalViews || 0
    const prevVideoCount = p?.videoCount || 0
    let trend: StockTrend = 'new'
    let changeRatio = 0
    if (p) {
      changeRatio = prevViews > 0 ? (acc.totalViews - prevViews) / prevViews : acc.totalViews > 0 ? 1 : 0
      trend = changeRatio > 0.05 ? 'up' : changeRatio < -0.05 ? 'down' : 'flat'
    }
    return {
      stockName,
      videoCount: acc.videoCount,
      totalViews: acc.totalViews,
      avgViews: Math.round(safeDiv(acc.totalViews, acc.videoCount)),
      lastMentionedAt: acc.last,
      ownerCount: acc.owners.size,
      prevViews,
      prevVideoCount,
      changeRatio,
      trend,
      sizeClass: 'sm' as const
    }
  })

  rows.sort((a, b) => b.totalViews - a.totalViews || b.videoCount - a.videoCount)
  // 타일 크기 = 총 조회수 분위. 상위 10% xl, 다음 20% lg, 다음 30% md, 나머지 sm.
  const n = rows.length
  return rows.map((row, index) => {
    const q = n > 0 ? index / n : 1
    const sizeClass = row.totalViews <= 0 ? 'sm' : q < 0.1 ? 'xl' : q < 0.3 ? 'lg' : q < 0.6 ? 'md' : 'sm'
    return { ...row, sizeClass }
  })
}

// ---------------------------------------------------------------- 업로드 타이밍 히트맵

export type HeatCell = { weekday: number; hour: number; count: number; totalViews: number; avgViews: number }

export function kstWeekdayHour(iso: string) {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return null
  const kst = new Date(ms + 9 * 60 * 60 * 1000)
  return { weekday: kst.getUTCDay(), hour: kst.getUTCHours() }
}

export function computeTimingHeatmap(videos: VideoRow[]) {
  const cells: HeatCell[] = []
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push({ weekday, hour, count: 0, totalViews: 0, avgViews: 0 })
    }
  }
  for (const v of videos) {
    const slot = kstWeekdayHour(v.published_at || v.created_at)
    if (!slot) continue
    const cell = cells[slot.weekday * 24 + slot.hour]
    cell.count += 1
    cell.totalViews += num(v.view_count)
  }
  for (const cell of cells) {
    cell.avgViews = Math.round(safeDiv(cell.totalViews, cell.count))
  }
  const recommendations = cells
    .filter((cell) => cell.count >= 2)
    .sort((a, b) => b.avgViews - a.avgViews || b.count - a.count)
    .slice(0, 3)
  const maxCount = cells.reduce((m, c) => Math.max(m, c.count), 0)
  const maxAvg = cells.reduce((m, c) => Math.max(m, c.avgViews), 0)
  return { cells, recommendations, maxCount, maxAvg }
}

// ---------------------------------------------------------------- 담당자 비교

export type StaffStat = {
  userId: string
  name: string
  videoCount: number
  totalViews: number
  avgViews: number
  longformCount: number
  shortformCount: number
  longformShare: number
  likeRate: number
  sparkline: number[]
  sparklineViews: number[]
  rank: number
}

export function computeStaffStats(videos: VideoRow[], staff: UserLite[], endYmd: string): StaffStat[] {
  const last7 = getYmdList(addDaysToYmd(endYmd, -6), endYmd)
  const byUser = new Map<string, StaffStat>()
  for (const user of staff) {
    byUser.set(user.id, {
      userId: user.id,
      name: user.name,
      videoCount: 0,
      totalViews: 0,
      avgViews: 0,
      longformCount: 0,
      shortformCount: 0,
      longformShare: 0,
      likeRate: 0,
      sparkline: last7.map(() => 0),
      sparklineViews: last7.map(() => 0),
      rank: 0
    })
  }
  const likes = new Map<string, number>()
  for (const v of videos) {
    const ownerId = v.primary_owner_user_id
    if (!ownerId) continue
    const stat = byUser.get(ownerId)
    if (!stat) continue
    stat.videoCount += 1
    stat.totalViews += num(v.view_count)
    likes.set(ownerId, (likes.get(ownerId) || 0) + num(v.like_count))
    if (v.content_type === 'shortform') stat.shortformCount += 1
    else stat.longformCount += 1
    const idx = last7.indexOf(kstYmdOf(v.created_at))
    if (idx >= 0) {
      stat.sparkline[idx] += 1
      stat.sparklineViews[idx] += num(v.view_count)
    }
  }
  const rows = Array.from(byUser.values()).map((stat) => ({
    ...stat,
    avgViews: Math.round(safeDiv(stat.totalViews, stat.videoCount)),
    longformShare: safeDiv(stat.longformCount, stat.videoCount),
    likeRate: safeDiv(likes.get(stat.userId) || 0, stat.totalViews)
  }))
  rows.sort((a, b) => b.totalViews - a.totalViews || b.videoCount - a.videoCount || a.name.localeCompare(b.name, 'ko'))
  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

// ---------------------------------------------------------------- 직원 판별

export function isActiveStaff(user: UserLite) {
  if (user.role_type === 'super_admin' || user.role_type === 'admin' || user.role_type === 'retired') return false
  return user.employment_status !== 'inactive'
}
