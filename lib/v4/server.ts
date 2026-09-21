// V4 API 라우트 공통: 인증, 에러 응답, 영상/사용자 조회.
// 서버 전용 (Next route handler에서만 import).

import { NextResponse } from 'next/server'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { mapDbError } from '@/lib/v4/errors'
import { isAdminRole } from '@/lib/v4/menu'
import { V4_TABLES } from '@/lib/v4/tables'
import { VIDEO_COLUMNS, isActiveStaff, type UserLite, type VideoRow } from '@/lib/v4/analytics'

export class V4HttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type SupabaseAdmin = Awaited<ReturnType<typeof getProfileByAccessToken>>['supabaseAdmin']

export type V4Context = {
  profile: { id: string; name: string; email: string; role_type: string }
  supabaseAdmin: SupabaseAdmin
  isAdmin: boolean
}

export async function requireV4User(request: Request): Promise<V4Context> {
  const token = getBearerToken(request)
  if (!token) throw new V4HttpError('로그인이 필요합니다.', 401)
  let result: Awaited<ReturnType<typeof getProfileByAccessToken>>
  try {
    result = await getProfileByAccessToken(token)
  } catch (e: any) {
    // 인증 실패 사유(원문)는 노출하지 않는다.
    console.error('[v4] 인증 실패', e)
    throw new V4HttpError('로그인이 필요합니다.', 401)
  }
  const { profile, supabaseAdmin } = result
  return {
    profile: { id: profile.id, name: profile.name, email: profile.email, role_type: profile.role_type },
    supabaseAdmin,
    isAdmin: isAdminRole(profile.role_type)
  }
}

export async function requireV4Admin(request: Request): Promise<V4Context> {
  const ctx = await requireV4User(request)
  if (!ctx.isAdmin) throw new V4HttpError('관리자 권한이 필요합니다.', 403)
  return ctx
}

// DB 오류를 서버 로그에만 남기고, 화면에는 쉬운 한국어 한 문장만 내려주는 예외로 바꾼다.
// 사용: if (error) throw dbError(error)
export function dbError(error: unknown, fallbackMessage = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.') {
  console.error('[v4] DB 오류', error)
  const mapped = mapDbError(error)
  return new V4HttpError(mapped.message || fallbackMessage, mapped.status)
}

// 오류 응답은 브라우저/중간 서버가 저장하지 않게 한다.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export function v4ErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof V4HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE_HEADERS })
  }
  console.error('[v4]', fallbackMessage, error)
  const mapped = mapDbError(error)
  // Postgres/JSON 원문은 절대 내려주지 않는다. 문장 끝의 마침표는 겹치지 않게 다듬는다.
  const sentence = fallbackMessage.trim().replace(/[.。]+$/, '')
  return NextResponse.json({ error: mapped.message || `${sentence}. 잠시 후 다시 시도해 주세요.` }, { status: mapped.status, headers: NO_STORE_HEADERS })
}

// Supabase(PostgREST)는 한 번에 최대 1000행만 돌려준다. 그보다 많이 필요하면 range()로 나눠 끝까지 읽어야 한다.
const PAGE_SIZE = 1000
const PARALLEL_PAGES = 4
// 안전장치: 하루 90개 × 180일(선택 90일 + 직전 90일) ≈ 16,000행. 그 위로는 비정상이므로 여기서 멈춘다.
export const MAX_ROWS = 40000

// 기간(created_at) + 직원 범위로 영상을 가져온다. 필요한 컬럼만 select 하고, 1000행을 넘으면 페이지를 나눠 끝까지 읽는다.
// limit 을 주면 최신순으로 딱 그만큼만 읽는다.
export async function loadVideos(
  supabaseAdmin: SupabaseAdmin,
  options: { startIso?: string; endIso?: string; ownerId?: string | null; limit?: number; columns?: string }
): Promise<VideoRow[]> {
  const columns = options.columns || VIDEO_COLUMNS
  const build = (from: number, to: number) => {
    let query = supabaseAdmin
      .from(V4_TABLES.videos)
      .select(columns)
      // created_at 이 같은 행이 페이지 경계에서 빠지거나 겹치지 않도록 id 로 순서를 확정한다.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    if (options.startIso) query = query.gte('created_at', options.startIso)
    if (options.endIso) query = query.lte('created_at', options.endIso)
    if (options.ownerId) query = query.eq('primary_owner_user_id', options.ownerId)
    return query.range(from, to)
  }

  const cap = Math.min(options.limit && options.limit > 0 ? options.limit : MAX_ROWS, MAX_ROWS)
  const rows: VideoRow[] = []
  let from = 0
  while (from < cap) {
    // 한 번에 최대 PARALLEL_PAGES 페이지를 동시에 읽어 90일 화면도 빠르게 채운다.
    const ranges: Array<[number, number]> = []
    for (let i = 0; i < PARALLEL_PAGES && from + i * PAGE_SIZE < cap; i += 1) {
      const start = from + i * PAGE_SIZE
      ranges.push([start, Math.min(start + PAGE_SIZE, cap) - 1])
    }
    const results = await Promise.all(ranges.map(([a, b]) => build(a, b)))
    let done = false
    results.forEach(({ data, error }, i) => {
      // 마지막 페이지 너머를 요청하면 PostgREST 가 '범위 초과(PGRST103/416)'로 답할 수 있다 → 빈 페이지로 본다.
      if (error && error.code !== 'PGRST103' && !/range not satisfiable/i.test(error.message || '')) throw dbError(error)
      const page = (error ? [] : data || []) as unknown as VideoRow[]
      rows.push(...page)
      if (page.length < ranges[i][1] - ranges[i][0] + 1) done = true
    })
    if (done) break
    from += ranges.length * PAGE_SIZE
  }
  if (rows.length >= MAX_ROWS) console.warn('[v4] loadVideos: 최대 행 수에 도달했어요. 기간을 줄이거나 집계를 SQL로 옮겨야 합니다.')
  // 페이지를 읽는 사이 새 영상이 등록되면 경계 행이 한 번씩 겹칠 수 있어 id 로 중복 제거한다.
  const seen = new Set<string>()
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
}

// 한 번 읽은 rows 를 등록 시각(created_at) 기준으로 "경계 이후 / 경계 이전"으로 나눈다.
// 문자열 비교는 '+00:00' / 'Z' 표기 차이에 흔들리므로 시각(ms)으로 비교한다.
export function splitByIso<T extends { created_at: string }>(rows: T[], boundaryIso: string) {
  const boundary = new Date(boundaryIso).getTime()
  const current: T[] = []
  const before: T[] = []
  for (const row of rows) {
    const t = new Date(row.created_at).getTime()
    ;(t >= boundary ? current : before).push(row)
  }
  return { current, before }
}

export async function loadUsers(supabaseAdmin: SupabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from(V4_TABLES.crmUsers)
    .select('id, name, role_type, employment_status')
    .order('name', { ascending: true })
  if (error) throw dbError(error)
  const users = (data || []) as UserLite[]
  const map = new Map(users.map((u) => [u.id, u]))
  const staff = users.filter(isActiveStaff)
  return { users, map, staff }
}

export async function readJson<T = any>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return {} as T
  }
}
