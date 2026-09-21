// V2 API 라우트 공용 서버 헬퍼. 클라이언트 컴포넌트에서 import 금지.
import { NextResponse } from 'next/server'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
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

// ---- 응답 캐시 ----
// 조회(GET) 분석 응답은 15초 동안 브라우저가 그대로 쓰고, 그 뒤 45초는 옛 값을 먼저 쓰며 뒤에서 새로 받는다.
// 로그인한 사람마다 내용이 다르므로 private + Vary: Authorization 으로 다른 사람의 응답이 섞이지 않게 한다.
export const ANALYTICS_CACHE_CONTROL = 'private, max-age=15, stale-while-revalidate=45'

export function cachedJson<T>(body: T, init?: ResponseInit) {
  const res = NextResponse.json(body, init)
  res.headers.set('Cache-Control', ANALYTICS_CACHE_CONTROL)
  res.headers.set('Vary', 'Authorization')
  return res
}

// 저장·삭제 응답은 절대 캐시하지 않는다.
export function noStoreJson<T>(body: T, init?: ResponseInit) {
  const res = NextResponse.json(body, init)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

const HANGUL = /[가-힣]/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

// 실제 원인은 서버 로그에만 남기고, 사용자에게는 "무엇을 하면 되는지" 한 문장만 내려준다.
export function serverError(error: unknown, fallback: string, status = 500) {
  console.error('[v2]', fallback, error)
  return NextResponse.json({ error: fallback }, { status })
}

// 사용자가 볼 수 있는 한글 문장인지 (영문 시스템 메시지 차단)
function userFacingText(message: string | undefined, fallback: string) {
  return message && HANGUL.test(message) ? message : fallback
}

// zod 검증 실패는 400, 권한 오류는 401/403, 나머지는 한글 안내 문장만 내려준다(원본 오류는 서버 로그에만).
export function handleRouteError(e: unknown, fallback: string) {
  const issues = (e as { issues?: { message?: string }[] })?.issues
  if (issues?.length) {
    return NextResponse.json({ error: userFacingText(issues[0]?.message, '입력한 내용을 다시 확인해 주세요.') }, { status: 400 })
  }
  if (e instanceof SyntaxError) {
    return NextResponse.json({ error: '입력한 내용을 다시 확인해 주세요.' }, { status: 400 })
  }
  if (e instanceof Error && /관리자 권한이 필요/.test(e.message)) {
    return forbidden(e.message)
  }
  if (e instanceof Error && /로그인이 필요|프로필을 찾을 수 없/.test(e.message)) {
    return unauthorizedResponse(e)
  }
  return serverError(e, fallback)
}

// Postgres 오류 코드를 쉬운 말로 바꾼다. 23505=중복, 23503=연결된 정보 없음, 23514/23502/22xxx=입력값 문제.
export function handleDbError(error: unknown, fallback: string, duplicateMessage = '이미 같은 내용이 있어요.') {
  if (isMissingTableError(error)) return missingTableResponse()
  const code = (error as { code?: string } | null)?.code
  if (code === '23505') return NextResponse.json({ error: duplicateMessage }, { status: 409 })
  if (code === '23503') {
    return NextResponse.json({ error: '연결된 정보를 찾을 수 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.' }, { status: 400 })
  }
  if (code && /^(23514|23502|22P02|22007|22008|22001)$/.test(code)) {
    return NextResponse.json({ error: '입력한 내용을 다시 확인해 주세요.' }, { status: 400 })
  }
  return serverError(error, fallback)
}

// PostgREST 는 한 번에 최대 1000행까지만 돌려준다. 그 이상이 필요할 때 나눠서 모두 가져온다.
export async function selectAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = 5000,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
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
  type Row = { stock_name: string; created_at: string }
  let data: Row[] = []
  try {
    data = await selectAllPages<Row>(
      (from, to) => supabaseAdmin.from(TABLES.videos).select('stock_name, created_at').gte('created_at', start).order('created_at', { ascending: false }).range(from, to),
      3000
    )
  } catch {
    return []
  }
  const map = new Map<string, RecentStock>()
  for (const row of data) {
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
  limit = 200,
  columns: string = VIDEO_SELECT
): Promise<VideoLite[]> {
  let query = supabaseAdmin.from(TABLES.videos).select(columns).order('created_at', { ascending: false }).limit(limit)
  if (!scope.isAdmin) query = query.eq('primary_owner_user_id', scope.userId)
  const { data, error } = await query
  if (error) throw error
  return ((data || []) as any[]).map((row) => ({ ...row, content_type: row.content_type as ContentType }))
}

// 화면이 쓰지 않는 긴 글(설명 등)과 잘 안 쓰는 칸은 비워서 응답을 작게 만든다. (칸 이름은 그대로라 옛 화면도 그대로 동작)
export function slimVideo(v: Partial<VideoLite> & { id: string }, extra: Partial<VideoLite> = {}): VideoLite {
  return {
    id: v.id,
    title: v.title ?? null,
    description: null,
    stock_name: v.stock_name ?? '',
    content_type: (v.content_type as ContentType) ?? 'longform',
    youtube_url: v.youtube_url ?? null,
    thumbnail_url: null,
    published_at: v.published_at ?? null,
    duration_seconds: null,
    view_count: v.view_count ?? null,
    like_count: v.like_count ?? null,
    comment_count: null,
    primary_owner_user_id: v.primary_owner_user_id ?? '',
    created_at: v.created_at ?? '',
    last_synced_at: null,
    ...extra
  }
}

// .in() 에 아이디가 수백 개 들어가면 URL이 너무 길어지므로 나눠서 조회한다.
function chunkIds(ids: string[], size = 100): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  return chunks
}

const CHECKLIST_SELECT = 'video_id, title_has_stock, thumbnail_text_checked, description_timestamps, tags_5plus, updated_at'

export async function loadChecklistMap(supabaseAdmin: SupabaseAdmin, videoIds: string[]): Promise<Map<string, SeoChecklist>> {
  const map = new Map<string, SeoChecklist>()
  const results = await Promise.all(
    chunkIds(videoIds).map(async (ids) => {
      const { data, error } = await supabaseAdmin.from(V2_TABLES.seoChecklists).select(CHECKLIST_SELECT).in('video_id', ids)
      if (error) throw error
      return (data || []) as SeoChecklist[]
    })
  )
  for (const rows of results) for (const row of rows) map.set(row.video_id, row)
  return map
}

// 영상별 최신 썸네일 리뷰(자가평가) — created_at 내림차순 첫 건
export async function loadLatestReviewMap(supabaseAdmin: SupabaseAdmin, videoIds: string[]): Promise<Map<string, ThumbnailReview>> {
  const map = new Map<string, ThumbnailReview>()
  const results = await Promise.all(
    chunkIds(videoIds).map((ids) =>
      selectAllPages<ThumbnailReview>(
        (from, to) =>
          supabaseAdmin
            .from(V2_TABLES.thumbnailReviews)
            .select('id, video_id, rating, note, reviewed_by, created_at')
            .in('video_id', ids)
            .order('created_at', { ascending: false })
            .range(from, to),
        5000
      )
    )
  )
  for (const rows of results) {
    for (const row of rows) {
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
