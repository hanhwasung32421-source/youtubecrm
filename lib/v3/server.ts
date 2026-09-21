// V3 API 라우트 공통 서버 헬퍼. (클라이언트 컴포넌트에서 import 금지)

import { NextResponse } from 'next/server'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { SHARED_TABLES, V3_SQL_FILE } from '@/lib/v3/tables'
import { isAdminRole } from '@/lib/v3/menu'
import type { VideoLite } from '@/lib/v3/engagement'

export type SupabaseAdmin = Awaited<ReturnType<typeof getProfileByAccessToken>>['supabaseAdmin']
export type Profile = Awaited<ReturnType<typeof getProfileByAccessToken>>['profile']

// 사용자에게는 SQL 파일 이름 대신 "누구에게 무엇을 부탁하면 되는지"만 보여 준다. (파일 이름은 서버 로그에 남는다)
export const MISSING_TABLE_MESSAGE = '이 기능의 준비가 아직 끝나지 않았어요. 관리자에게 알려 주세요.'

// PostgREST가 돌려주는 "테이블 없음" 에러 판별
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string }
  if (err.code === '42P01') return true
  return /does not exist|Could not find the table|schema cache/i.test(err.message || '')
}

export function missingTableResponse() {
  console.error(`V3 테이블이 없어요. ${V3_SQL_FILE} 을 실행해야 해요.`)
  return NextResponse.json({ error: MISSING_TABLE_MESSAGE }, { status: 409 })
}

// ─────────────────────────────────────────────────────────────
// 에러 처리: 사용자에게는 "무엇을 하면 되는지" 한 문장만 보여 주고,
// 원본(Postgres/PostgREST 문구)은 서버 로그에만 남긴다.
// ─────────────────────────────────────────────────────────────
export class ApiFail extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const HANGUL = /[가-힣]/

export function apiError(e: unknown, fallback: string, opts: { duplicate?: string; reference?: string } = {}) {
  if (e instanceof ApiFail) return NextResponse.json({ error: e.message }, { status: e.status })

  const code = (e as { code?: string } | null)?.code
  console.error(fallback, e)

  switch (code) {
    case '23505':
      return NextResponse.json({ error: opts.duplicate || '이미 있어요. 화면을 새로 고쳐 확인해 주세요.' }, { status: 409 })
    case '23503':
      return NextResponse.json({ error: opts.reference || '연결된 영상이나 시리즈를 찾을 수 없어요. 화면을 새로 고친 뒤 다시 시도해 주세요.' }, { status: 409 })
    case '22P02':
      return NextResponse.json({ error: '요청한 값이 올바르지 않아요. 화면을 새로 고친 뒤 다시 시도해 주세요.' }, { status: 400 })
    case '23502':
    case '23514':
    case '22001':
      return NextResponse.json({ error: '입력한 내용을 다시 확인해 주세요.' }, { status: 400 })
    case '42P01':
      return missingTableResponse()
    default: {
      const safe = HANGUL.test(fallback) ? fallback : '처리하지 못했어요.'
      return NextResponse.json({ error: /다시|확인/.test(safe) ? safe : `${safe} 잠시 뒤 다시 시도해 주세요.` }, { status: 500 })
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 인증
// ─────────────────────────────────────────────────────────────
type AuthOk = { ok: true; profile: Profile; supabaseAdmin: SupabaseAdmin; isAdmin: boolean }
type AuthFail = { ok: false; response: NextResponse }

export async function authenticate(request: Request): Promise<AuthOk | AuthFail> {
  const token = getBearerToken(request)
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.' }, { status: 401 }) }
  }
  try {
    const { profile, supabaseAdmin } = await getProfileByAccessToken(token)
    return { ok: true, profile, supabaseAdmin, isAdmin: isAdminRole(profile.role_type) }
  } catch (e: any) {
    const message = typeof e?.message === 'string' && HANGUL.test(e.message) ? e.message : '로그인이 만료됐어요. 다시 로그인해 주세요.'
    return { ok: false, response: NextResponse.json({ error: message }, { status: 401 }) }
  }
}

export async function authenticateAdmin(request: Request): Promise<AuthOk | AuthFail> {
  const auth = await authenticate(request)
  if (!auth.ok) return auth
  if (!auth.isAdmin) {
    return { ok: false, response: NextResponse.json({ error: '관리자만 할 수 있어요.' }, { status: 403 }) }
  }
  return auth
}

export async function readJson<T = any>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// 입력 검증(한글 메시지)
// ─────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function requireUuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw new ApiFail(400, `${label}을(를) 다시 골라 주세요.`)
  return value
}

// 화면에서 보내는 문자열 → 앞뒤 공백 제거. 비어 있으면 null.
export function cleanText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ApiFail(400, `${label}을(를) 다시 입력해 주세요.`)
  const text = value.trim()
  if (!text) return null
  if (text.length > max) throw new ApiFail(400, `${label}은(는) ${max}자 이하로 적어 주세요.`)
  return text
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ─────────────────────────────────────────────────────────────
// 공용 로더
// ─────────────────────────────────────────────────────────────
export type StaffUser = { id: string; name: string; role_type: string; employment_status: string }

export async function loadStaffUsers(supabaseAdmin: SupabaseAdmin): Promise<StaffUser[]> {
  const { data, error } = await supabaseAdmin
    .from(SHARED_TABLES.crmUsers)
    .select('id, name, role_type, employment_status')
    .order('name', { ascending: true })
  if (error) throw error
  return ((data || []) as StaffUser[]).filter(
    (user) => !isAdminRole(user.role_type) && user.role_type !== 'retired' && user.employment_status === 'active'
  )
}

export async function loadUserNames(supabaseAdmin: SupabaseAdmin): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from(SHARED_TABLES.crmUsers).select('id, name')
  return new Map(((data || []) as { id: string; name: string }[]).map((row) => [row.id, row.name]))
}

// 전체 열(등록/새로고침/확인 화면용)
const VIDEO_FIELDS =
  'id, youtube_video_id, title, stock_name, content_type, view_count, like_count, comment_count, published_at, created_at, youtube_url, thumbnail_url, primary_owner_user_id, channel_id, last_synced_at'

// 분석 화면용으로 필요한 열만. 영상 수천 개를 통째로 받아 계산하는 화면이라 행 하나가 작을수록 빠르다.
//   LIST  : 조회수 속도(viewVelocity)·목록 표시에 필요한 열
//   RATES : LIST + 좋아요/댓글 수(참여율 계산용)
export const VIDEO_FIELDS_LIST = 'id, title, stock_name, content_type, view_count, published_at, created_at, youtube_url, primary_owner_user_id'
export const VIDEO_FIELDS_RATES = `${VIDEO_FIELDS_LIST}, like_count, comment_count`

const PAGE_SIZE = 1000

// PostgREST는 한 번에 돌려주는 행 수에 상한(보통 1000)이 있어서, limit이 그보다 크면 조용히 잘린다.
// 첫 쪽을 받아 보고 꽉 찼을 때만 나머지 쪽을 동시에 요청한다. (영상이 적을 때는 요청 1번으로 끝난다)
async function fetchVideoPages(supabaseAdmin: SupabaseAdmin, apply: (query: any) => any, limit: number, fields: string): Promise<VideoLite[]> {
  const fetchRange = async (from: number, to: number): Promise<VideoLite[]> => {
    const base = apply(supabaseAdmin.from(SHARED_TABLES.videos).select(fields))
    const { data, error } = await base
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    if (error) throw error
    return (data || []) as VideoLite[]
  }
  const first = await fetchRange(0, Math.min(PAGE_SIZE, limit) - 1)
  if (first.length < PAGE_SIZE || limit <= PAGE_SIZE) return first
  const ranges: { from: number; to: number }[] = []
  for (let from = PAGE_SIZE; from < limit; from += PAGE_SIZE) ranges.push({ from, to: Math.min(from + PAGE_SIZE, limit) - 1 })
  const rest = await Promise.all(ranges.map(({ from, to }) => fetchRange(from, to)))
  return [...first, ...rest.flat()]
}

// 역할에 따라 범위를 좁힌 영상 목록. 관리자는 staffId로 특정 직원만 볼 수도 있다.
export async function loadScopedVideos(
  supabaseAdmin: SupabaseAdmin,
  opts: { isAdmin: boolean; selfUserId: string; staffId?: string | null; limit?: number; sinceIso?: string; fields?: string }
): Promise<VideoLite[]> {
  return fetchVideoPages(
    supabaseAdmin,
    (query) => {
      let q = query
      if (opts.sinceIso) q = q.gte('created_at', opts.sinceIso)
      if (!opts.isAdmin) q = q.eq('primary_owner_user_id', opts.selfUserId)
      else if (opts.staffId && isUuid(opts.staffId)) q = q.eq('primary_owner_user_id', opts.staffId)
      return q
    },
    opts.limit || 2000,
    opts.fields || VIDEO_FIELDS
  )
}

// 팀 전체 영상(중앙값 등 팀 기준값 계산용) — 역할과 무관하게 항상 전체를 본다.
export async function loadTeamVideos(
  supabaseAdmin: SupabaseAdmin,
  opts: { limit?: number; sinceIso?: string; fields?: string } = {}
): Promise<VideoLite[]> {
  return fetchVideoPages(supabaseAdmin, (query) => (opts.sinceIso ? query.gte('created_at', opts.sinceIso) : query), opts.limit || 3000, opts.fields || VIDEO_FIELDS)
}

// id 목록이 길면 요청 주소가 너무 길어지므로 80개씩 나눠서 가져온다.
export async function loadVideosByIds(supabaseAdmin: SupabaseAdmin, ids: string[]): Promise<VideoLite[]> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return []
  const parts = await Promise.all(
    chunk(unique, 80).map(async (part) => {
      const { data, error } = await supabaseAdmin.from(SHARED_TABLES.videos).select(VIDEO_FIELDS).in('id', part)
      if (error) throw error
      return (data || []) as VideoLite[]
    })
  )
  return parts.flat()
}

// 영상별 조회수 기록(스냅샷) 개수. 40개 영상씩 묶어 1000행 상한을 넘지 않게 이어 받는다.
export async function loadSnapshotCounts(supabaseAdmin: SupabaseAdmin, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  await Promise.all(
    chunk(ids, 40).map(async (part) => {
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabaseAdmin
          .from(SHARED_TABLES.videoSnapshots)
          .select('video_id')
          .in('video_id', part)
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        const rows = (data || []) as { video_id: string }[]
        for (const row of rows) counts.set(row.video_id, (counts.get(row.video_id) || 0) + 1)
        if (rows.length < PAGE_SIZE) break
      }
    })
  )
  return counts
}

// 영상 1개의 조회수 기록(스냅샷). 오래된 것부터 정렬해 돌려주고, 너무 많으면 가장 최근 max개만 가져온다.
// total 은 실제 전체 개수(그래프에는 일부만 쓰더라도 "기록 N번"은 정확히 보여 주기 위함).
export type SnapshotRow = { snapshot_at: string; view_count: number | null; like_count: number | null; comment_count: number | null }

export async function loadVideoSnapshots(supabaseAdmin: SupabaseAdmin, videoId: string, max = 400): Promise<{ rows: SnapshotRow[]; total: number }> {
  const { data, error, count } = await supabaseAdmin
    .from(SHARED_TABLES.videoSnapshots)
    .select('snapshot_at, view_count, like_count, comment_count', { count: 'exact' })
    .eq('video_id', videoId)
    .order('snapshot_at', { ascending: false })
    .limit(max)
  if (error) throw error
  const rows = ((data || []) as SnapshotRow[]).reverse()
  return { rows, total: typeof count === 'number' ? count : rows.length }
}

// ─────────────────────────────────────────────────────────────
// 응답 캐시 헤더
//   읽기 전용 분석 GET  : 브라우저 저장본은 쓰지 않고 늘 서버에 확인한다. ("먼저 보여 주기"는 화면 안 메모리 저장소(use-v3-data)가
//                         맡는다. 브라우저까지 옛 값을 들고 있으면 방금 등록한 영상이 한동안 안 보인다.)
//                         (Vary: Authorization — 같은 브라우저에서 다른 사람이 로그인해도 남의 화면이 보이지 않게)
//   저장/수정/삭제 응답 : 절대 캐시하지 않는다.
// ─────────────────────────────────────────────────────────────
export const ANALYTICS_CACHE_CONTROL = 'private, max-age=0, must-revalidate'

export function cachedJson(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200
  const headers: Record<string, string> = status === 200 ? { 'Cache-Control': ANALYTICS_CACHE_CONTROL, Vary: 'Authorization' } : { 'Cache-Control': 'no-store' }
  return NextResponse.json(body, { status, headers })
}

export function noStoreJson(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { 'Cache-Control': 'no-store' } })
}

// 현재 활성화된(api_active=true) 유튜브 계정의 API 키를 가져온다. 통계 새로고침용.
export async function loadActiveYoutubeApiKey(supabaseAdmin: SupabaseAdmin): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from(SHARED_TABLES.youtubeAccounts)
    .select('api_key, api_active')
    .eq('api_active', true)
    .limit(1)
    .maybeSingle()
  const key = String((data as any)?.api_key || '').trim()
  return key || null
}
