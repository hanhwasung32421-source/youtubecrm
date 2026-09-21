// V3 "시청자 참여 · 커뮤니티 성장" 도메인의 순수 로직. 서버(API)와 클라이언트(페이지)가
// 같이 쓰므로 Supabase/Next 의존성을 두지 않는다.

export type ContentType = 'longform' | 'shortform'

export type VideoLite = {
  id: string
  youtube_video_id?: string | null
  title: string | null
  stock_name: string | null
  content_type: ContentType
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  published_at: string | null
  created_at: string
  youtube_url: string | null
  thumbnail_url?: string | null
  primary_owner_user_id: string
  channel_id?: string | null
  last_synced_at?: string | null
}

// ─────────────────────────────────────────────────────────────
// KST(UTC+9) 날짜 유틸
// ─────────────────────────────────────────────────────────────
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function nowKst(): Date {
  return new Date(Date.now() + KST_OFFSET_MS)
}

export function daysSince(dateIso: string | null | undefined, reference: Date = new Date()): number {
  if (!dateIso) return 0
  const start = new Date(dateIso).getTime()
  if (Number.isNaN(start)) return 0
  const diff = reference.getTime() - start
  return Math.max(diff / (1000 * 60 * 60 * 24), 0)
}

// created_at(UTC ISO)이 "오늘"(KST 기준)인지 판별. 등록 폼의 "오늘 등록한 영상" 목록에 사용.
export function isTodayKst(dateIso: string): boolean {
  const shifted = new Date(new Date(dateIso).getTime() + KST_OFFSET_MS)
  const now = nowKst()
  return (
    shifted.getUTCFullYear() === now.getUTCFullYear() &&
    shifted.getUTCMonth() === now.getUTCMonth() &&
    shifted.getUTCDate() === now.getUTCDate()
  )
}

export function isoDaysAgo(days: number, reference: Date = new Date()): string {
  return new Date(reference.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

// ─────────────────────────────────────────────────────────────
// 참여 지표
//   참여율(%)      = (좋아요 + 댓글) / 조회수 × 100
//   댓글 참여율(%) = 댓글 / 조회수 × 100   ("댓글이 유독 활발한 영상" 판별용)
//   좋아요 참여율(%) = 좋아요 / 조회수 × 100
//   조회 속도       = 조회수 ÷ max(게시 후 경과일, 1)
// ─────────────────────────────────────────────────────────────
export function engagementRatePct(video: Pick<VideoLite, 'view_count' | 'like_count' | 'comment_count'>): number | null {
  const views = Number(video.view_count || 0)
  if (views <= 0) return null
  const likes = Number(video.like_count || 0)
  const comments = Number(video.comment_count || 0)
  return ((likes + comments) / views) * 100
}

export function commentRatePct(video: Pick<VideoLite, 'view_count' | 'comment_count'>): number | null {
  const views = Number(video.view_count || 0)
  if (views <= 0) return null
  return (Number(video.comment_count || 0) / views) * 100
}

export function likeRatePct(video: Pick<VideoLite, 'view_count' | 'like_count'>): number | null {
  const views = Number(video.view_count || 0)
  if (views <= 0) return null
  return (Number(video.like_count || 0) / views) * 100
}

export function viewVelocity(video: Pick<VideoLite, 'view_count' | 'published_at' | 'created_at'>, reference: Date = new Date()): number {
  const views = Number(video.view_count || 0)
  const days = Math.max(daysSince(video.published_at || video.created_at, reference), 1)
  return views / days
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

// ─────────────────────────────────────────────────────────────
// 참여율 분포 버킷
// ─────────────────────────────────────────────────────────────
export const ENGAGEMENT_BUCKETS = [
  { key: '0-1', label: '0~1%', min: 0, max: 1 },
  { key: '1-2', label: '1~2%', min: 1, max: 2 },
  { key: '2-4', label: '2~4%', min: 2, max: 4 },
  { key: '4-8', label: '4~8%', min: 4, max: 8 },
  { key: '8+', label: '8%+', min: 8, max: Infinity }
] as const

export function bucketizeEngagement(rates: number[]) {
  return ENGAGEMENT_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: rates.filter((r) => r >= bucket.min && r < bucket.max).length
  }))
}

// ─────────────────────────────────────────────────────────────
// 형식(롱폼/숏폼) 효율 요약
// ─────────────────────────────────────────────────────────────
export type FormatStat = {
  contentType: ContentType
  count: number
  avgEngagementPct: number
  avgVelocity: number
  totalViews: number
}

export function summarizeByFormat(videos: VideoLite[], reference: Date = new Date()): Record<ContentType, FormatStat> {
  const build = (type: ContentType): FormatStat => {
    const rows = videos.filter((v) => v.content_type === type)
    const engagementRates = rows.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)
    const velocities = rows.map((v) => viewVelocity(v, reference))
    return {
      contentType: type,
      count: rows.length,
      avgEngagementPct: average(engagementRates),
      avgVelocity: average(velocities),
      totalViews: rows.reduce((sum, v) => sum + Number(v.view_count || 0), 0)
    }
  }
  return { longform: build('longform'), shortform: build('shortform') }
}

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = { longform: '롱폼', shortform: '숏폼' }
