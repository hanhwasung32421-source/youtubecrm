// V2 API 라우트 공용 서버 헬퍼. 클라이언트 컴포넌트에서 import 금지.
import { NextResponse } from 'next/server'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { errorResponse } from '@/lib/api/error-response'
import { TABLES } from '@/lib/supabase/tables'
import { V2_MISSING_TABLE_MESSAGE, V2_TABLES } from './tables'
import { addDays, kstDayStart, kstHourOfIso, kstWeekdayOfIso, kstYmd, daysSince } from './dates'
import {
  checklistDoneCount,
  emptyChecklist,
  LIKE_RATE_TARGET,
  VIEW_VELOCITY_TARGET_PER_DAY,
  type ContentType,
  type DiscoverabilityRow,
  type RecentStock,
  type SeoChecklist,
  type StaffLite,
  type ThumbnailReview,
  type TimingHint,
  type VideoLite
} from './types'

// 테이블이 아직 없을 때(사용자가 SQL을 실행하기 전) PostgREST/Postgres가 내는 오류 패턴
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  if (e.code === '42P01') return true
  return /does not exist|Could not find the table|schema cache/i.test(String(e.message || ''))
}

export function missingTableResponse() {
  return NextResponse.json({ error: V2_MISSING_TABLE_MESSAGE }, { status: 409 })
}

export function isAdminRole(roleType: string) {
  return roleType === 'super_admin' || roleType === 'admin'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseAdmin = any

export type AuthedContext = {
  profile: { id: string; name: string; email: string; role_type: string; employment_status: string }
  supabaseAdmin: SupabaseAdmin
  isAdmin: boolean
}

export async function authedContext(request: Request): Promise<AuthedContext> {
  const { profile, supabaseAdmin } = await getProfileByAccessToken(getBearerToken(request))
  return { profile, supabaseAdmin, isAdmin: isAdminRole(profile.role_type) }
}

export async function requireV2Admin(request: Request): Promise<AuthedContext> {
  const ctx = await authedContext(request)
  if (!ctx.isAdmin) throw new Error('관리자 권한이 필요합니다.')
  return ctx
}

export function forbidden(message = '관리자 권한이 필요합니다.') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function unauthorizedResponse(e: unknown) {
  const message = e instanceof Error ? e.message : '로그인이 필요합니다.'
  return NextResponse.json({ error: message }, { status: 401 })
}

// zod 검증 실패는 400, 권한 오류는 401/403, 나머지는 공통 errorResponse
export function handleRouteError(e: unknown, fallback: string) {
  const issues = (e as { issues?: { message?: string }[] })?.issues
  if (issues?.[0]?.message) {
    return NextResponse.json({ error: issues[0].message }, { status: 400 })
  }
  if (e instanceof Error && /관리자 권한이 필요/.test(e.message)) {
    return forbidden(e.message)
  }
  if (e instanceof Error && /로그인이 필요|프로필을 찾을 수 없/.test(e.message)) {
    return unauthorizedResponse(e)
  }
  return errorResponse(e, fallback)
}

export function handleDbError(error: unknown, fallback: string) {
  if (isMissingTableError(error)) return missingTableResponse()
  return errorResponse(error, fallback)
}

const VIDEO_SELECT =
  'id, title, description, stock_name, content_type, youtube_url, thumbnail_url, published_at, duration_seconds, view_count, like_count, comment_count, primary_owner_user_id, created_at, last_synced_at'

// 활성 직원 목록(퇴사 제외). 담당자 선택/플래너 기준.
export async function loadStaff(supabaseAdmin: SupabaseAdmin): Promise<StaffLite[]> {
  const { data } = await supabaseAdmin
    .from(TABLES.crmUsers)
    .select('id, name, role_type, employment_status')
    .neq('role_type', 'retired')
    .eq('employment_status', 'active')
    .order('name', { ascending: true })

  const rows = (data || []) as { id: string; name: string; role_type: string }[]
  // 직원(유튜버)을 앞에, 관리자를 뒤에
  rows.sort((a, b) => Number(isAdminRole(a.role_type)) - Number(isAdminRole(b.role_type)) || a.name.localeCompare(b.name, 'ko'))
  return rows.map((row) => ({ id: row.id, name: row.name, roleType: row.role_type }))
}

export async function loadStaffMap(supabaseAdmin: SupabaseAdmin): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from(TABLES.crmUsers).select('id, name')
  const map = new Map<string, string>()
  for (const row of (data || []) as { id: string; name: string }[]) map.set(row.id, row.name)
  return map
}

// 최근 N일 등록 영상의 종목명 집계 — 키워드 레이더 중복 소재 경고에 사용
export async function loadRecentStocks(supabaseAdmin: SupabaseAdmin, days = 7): Promise<RecentStock[]> {
  const start = kstDayStart(addDays(kstYmd(), -(days - 1))).toISOString()
  const { data, error } = await supabaseAdmin
    .from(TABLES.videos)
    .select('stock_name, created_at')
    .gte('created_at', start)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) return []
  const map = new Map<string, RecentStock>()
  for (const row of (data || []) as { stock_name: string; created_at: string }[]) {
    const name = String(row.stock_name || '').trim()
    if (!name) continue
    const bucket = map.get(name)
    if (bucket) {
      bucket.count += 1
      if (row.created_at > bucket.last_at) bucket.last_at = row.created_at
    } else {
      map.set(name, { stock_name: name, count: 1, last_at: row.created_at })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.last_at < b.last_at ? 1 : -1))
}

// 조회 범위(관리자=전체, 직원=본인)에 맞는 최근 영상 목록
export async function loadVideos(
  supabaseAdmin: SupabaseAdmin,
  scope: { userId: string; isAdmin: boolean },
  limit = 200
): Promise<VideoLite[]> {
  let query = supabaseAdmin.from(TABLES.videos).select(VIDEO_SELECT).order('created_at', { ascending: false }).limit(limit)
  if (!scope.isAdmin) query = query.eq('primary_owner_user_id', scope.userId)
  const { data, error } = await query
  if (error) throw error
  return ((data || []) as any[]).map((row) => ({ ...row, content_type: row.content_type as ContentType }))
}

// .in() 에 아이디가 수백 개 들어가면 URL이 너무 길어지므로 나눠서 조회한다.
function chunkIds(ids: string[], size = 100): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  return chunks
}

export async function loadChecklistMap(supabaseAdmin: SupabaseAdmin, videoIds: string[]): Promise<Map<string, SeoChecklist>> {
  const map = new Map<string, SeoChecklist>()
  for (const ids of chunkIds(videoIds)) {
    const { data, error } = await supabaseAdmin.from(V2_TABLES.seoChecklists).select('*').in('video_id', ids)
    if (error) throw error
    for (const row of (data || []) as SeoChecklist[]) map.set(row.video_id, row)
  }
  return map
}

// 영상별 최신 썸네일 리뷰(자가평가) — created_at 내림차순 첫 건
export async function loadLatestReviewMap(supabaseAdmin: SupabaseAdmin, videoIds: string[]): Promise<Map<string, ThumbnailReview>> {
  const map = new Map<string, ThumbnailReview>()
  for (const ids of chunkIds(videoIds)) {
    const { data, error } = await supabaseAdmin
      .from(V2_TABLES.thumbnailReviews)
      .select('id, video_id, rating, note, reviewed_by, created_at')
      .in('video_id', ids)
      .order('created_at', { ascending: false })
    if (error) throw error
    for (const row of (data || []) as ThumbnailReview[]) {
      if (!map.has(row.video_id)) map.set(row.video_id, row)
    }
  }
  return map
}

export function checklistFor(videoId: string, map: Map<string, SeoChecklist>): SeoChecklist {
  return map.get(videoId) || emptyChecklist(videoId)
}

// ---- 발견성 점수(Discoverability Score) ----
// 가중치/기준값은 lib/v2/types.ts 에 정의(클라이언트에서도 import 가능하도록).
export function computeDiscoverability(video: VideoLite, checklist: SeoChecklist | null | undefined): Omit<DiscoverabilityRow, 'video' | 'ownerName'> {
  const views = video.view_count || 0
  const likes = video.like_count || 0
  const days = daysSince(video.published_at || video.created_at)
  const viewsPerDay = views / days
  const viewVelocityScore = Math.min(100, Math.round((viewsPerDay / VIEW_VELOCITY_TARGET_PER_DAY) * 100))
  const likeRate = views > 0 ? likes / views : 0
  const likeRateScore = Math.min(100, Math.round((likeRate / LIKE_RATE_TARGET) * 100))
  const done = checklistDoneCount(checklist)
  const checklistScore = Math.round((done / 4) * 100)
  const score = Math.round(0.4 * viewVelocityScore + 0.3 * likeRateScore + 0.3 * checklistScore)
  return { viewsPerDay, viewVelocityScore, likeRateScore, checklistScore, score, checklistDone: done }
}

// ---- 최적 발행 요일/시간 힌트 ----
// 실 youtubeCRM_videos.published_at(KST) + view_count 를 요일×시간대로 묶어 평균 조회수가 가장 높은 조합을 찾는다.
export function computeTimingHint(videos: { published_at: string | null; view_count: number | null }[]): TimingHint {
  const buckets = new Map<string, { sum: number; count: number; weekday: number; hour: number }>()
  for (const v of videos) {
    if (!v.published_at) continue
    const weekday = kstWeekdayOfIso(v.published_at)
    const hour = kstHourOfIso(v.published_at)
    if (weekday === null || hour === null) continue
    const key = `${weekday}-${hour}`
    const bucket = buckets.get(key) || { sum: 0, count: 0, weekday, hour }
    bucket.sum += v.view_count || 0
    bucket.count += 1
    buckets.set(key, bucket)
  }
  let best: { weekday: number; hour: number; avg: number; count: number } | null = null
  for (const b of buckets.values()) {
    if (b.count < 2) continue // 표본 2건 미만은 신뢰하지 않는다
    const avg = b.sum / b.count
    if (!best || avg > best.avg) best = { weekday: b.weekday, hour: b.hour, avg, count: b.count }
  }
  if (!best) return { weekday: null, hour: null, avgViews: 0, sampleSize: 0 }
  return { weekday: best.weekday, hour: best.hour, avgViews: Math.round(best.avg), sampleSize: best.count }
}

export function nowIso() {
  return new Date().toISOString()
}
