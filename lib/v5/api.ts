// V5 API 라우트 공용 도우미(서버 전용).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { errorResponse } from '@/lib/api/error-response'
import { V5_MISSING_TABLE_MESSAGE, V5_TABLES } from '@/lib/v5/tables'
import { isAdminRoleType } from '@/lib/v5/menu'
import type { StaffUser } from '@/lib/v5/types'

// V5 테이블이 없을 때 PostgREST가 내는 오류.
export function isMissingTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  if (e.code === '42P01') return true
  return /does not exist|Could not find the table|schema cache/i.test(e.message || '')
}

export function missingTableResponse() {
  return NextResponse.json({ error: V5_MISSING_TABLE_MESSAGE }, { status: 409 })
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function forbidden(message = '관리자 권한이 필요해요.') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function notFound(message = '항목을 찾을 수 없어요. 이미 지워졌을 수 있어요.') {
  return NextResponse.json({ error: message }, { status: 404 })
}

const HANGUL = /[가-힣]/

// 서버가 사용자에게 내려주는 오류는 항상 짧은 한국어 한 문장이다.
// zod/Postgres 원문(영문)은 절대 그대로 내보내지 않는다.
export function handleRouteError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    const first = error.issues[0]
    const message = first?.message || ''
    return NextResponse.json({ error: HANGUL.test(message) ? message : '입력한 내용을 다시 확인해 주세요.' }, { status: 400 })
  }
  if (error instanceof Error && /로그인이 필요|프로필을 찾을 수 없/.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }
  if (error && typeof error === 'object') {
    const e = error as { code?: string; message?: string }
    if (e.code === '23503') {
      return NextResponse.json({ error: '연결된 영상이나 담당자를 찾을 수 없어요. 화면을 새로 고치고 다시 해 주세요.' }, { status: 400 })
    }
    if (e.code === '23505') {
      return NextResponse.json({ error: '이미 같은 내용이 저장되어 있어요.' }, { status: 409 })
    }
    if (e.code && /^(23502|23514|22P02|22007|22003|22001)$/.test(e.code)) {
      return NextResponse.json({ error: '입력한 내용을 다시 확인해 주세요.' }, { status: 400 })
    }
    if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(e.message || '')) {
      return NextResponse.json({ error: '데이터 저장소에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, { status: 503 })
    }
  }
  return errorResponse(error, fallback)
}

export type Session = Awaited<ReturnType<typeof getProfileByAccessToken>> & { isAdmin: boolean }

export async function getSession(request: Request): Promise<Session> {
  const token = getBearerToken(request)
  if (!token) throw new Error('로그인이 필요합니다.')
  const session = await getProfileByAccessToken(token)
  return { ...session, isAdmin: isAdminRoleType(session.profile.role_type) }
}

// 요청 바디를 안전하게 JSON 파싱(빈 바디 허용).
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// 조회 도우미
// ---------------------------------------------------------------------------

// PostgREST URL 길이 제한 때문에 .in() 목록은 나눠서 조회한다(uuid 100개 ≈ 3.7KB).
export const IN_CHUNK = 100

export function chunk<T>(list: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

type PageResult<T> = { data: T[] | null; error: unknown; count: number | null }

// Supabase 기본 응답은 1000행에서 조용히 잘린다. 1000행씩 .range()로 나눠 끝까지 읽는다.
// build(from, to, withCount): 같은 정렬(동률 없는 키까지 포함)로 range(from, to)를 건 쿼리를 돌려준다.
//   첫 페이지에서만 withCount=true 이므로 select(..., { count: 'exact' })를 그때만 쓰면 된다.
// maxPages를 넘으면 잘라내고 truncated=true 로 알려 준다(합계가 조용히 줄어드는 일이 없게).
export async function fetchAllPages<T>(
  build: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxPages?: number; parallel?: number } = {}
): Promise<{ rows: T[]; total: number; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 1000
  const maxPages = opts.maxPages ?? 10
  const parallel = opts.parallel ?? 4

  const first = await build(0, pageSize - 1, true)
  if (first.error) throw first.error
  const rows: T[] = [...(first.data || [])]
  const step = rows.length
  if (step === 0) return { rows, total: 0, truncated: false }

  const total = first.count ?? null
  if (total !== null && rows.length >= total) return { rows, total: rows.length, truncated: false }

  if (total !== null) {
    const pages = Math.min(Math.ceil(total / step), maxPages)
    const starts: number[] = []
    for (let p = 1; p < pages; p += 1) starts.push(p * step)
    for (let i = 0; i < starts.length; i += parallel) {
      const results = await Promise.all(starts.slice(i, i + parallel).map((from) => build(from, from + step - 1, false)))
      for (const r of results) {
        if (r.error) throw r.error
        rows.push(...(r.data || []))
      }
    }
    return { rows, total: Math.max(total, rows.length), truncated: rows.length < total }
  }

  // count 를 못 받았을 때: 짧은 페이지가 나올 때까지 순서대로 읽는다.
  let page = 1
  let lastLen = step
  while (lastLen >= step && page < maxPages) {
    const r = await build(page * step, page * step + step - 1, false)
    if (r.error) throw r.error
    const got = r.data || []
    rows.push(...got)
    lastLen = got.length
    page += 1
  }
  return { rows, total: rows.length, truncated: lastLen >= step }
}

// 이름 매핑용 crm_users 조회. 실패해도 빈 맵을 돌려주고 화면은 계속 그린다.
export async function loadUserMap(supabaseAdmin: Session['supabaseAdmin'], ids?: Iterable<string | null | undefined>) {
  const wanted = ids ? Array.from(new Set(Array.from(ids).filter((v): v is string => Boolean(v)))) : null
  if (wanted && wanted.length === 0) return new Map<string, string>()
  const map = new Map<string, string>()
  const groups: Array<string[] | null> = wanted ? chunk(wanted) : [null]
  for (const group of groups) {
    let query = supabaseAdmin.from(V5_TABLES.crmUsers).select('id, name')
    if (group) query = query.in('id', group)
    const { data } = await query
    for (const row of (data || []) as Array<{ id: string; name: string }>) map.set(row.id, row.name)
  }
  return map
}

export async function loadStaffUsers(supabaseAdmin: Session['supabaseAdmin']): Promise<StaffUser[]> {
  const { data } = await supabaseAdmin.from(V5_TABLES.crmUsers).select('id, name, role_type, employment_status').order('name', { ascending: true })
  return ((data || []) as Array<{ id: string; name: string; role_type: string; employment_status: string | null }>)
    .filter((u) => u.role_type !== 'retired' && u.employment_status !== 'retired')
    .map((u) => ({ id: u.id, name: u.name, role_type: u.role_type }))
}

// id 목록으로 영상을 조회(100개씩 나눠서). 없는 id는 결과에서 빠진다.
export async function loadVideosByIds<T extends { id: string }>(supabaseAdmin: Session['supabaseAdmin'], ids: string[], columns: string): Promise<T[]> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return []
  const results = await Promise.all(
    chunk(unique).map(async (group) => {
      const { data, error } = await supabaseAdmin.from(V5_TABLES.videos).select(columns).in('id', group)
      if (error) throw error
      return (data || []) as unknown as T[]
    })
  )
  return results.flat()
}

// 실험/플레이북에 붙일 영상 id가 실제로 있는지 확인(배열 컬럼이라 DB 외래키가 없다). 없는 id 개수를 돌려준다.
export async function countMissingVideos(supabaseAdmin: Session['supabaseAdmin'], ids: string[]) {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return 0
  const found = await loadVideosByIds<{ id: string }>(supabaseAdmin, unique, 'id')
  return unique.length - found.length
}

export type VideoOptionRow = {
  id: string
  title: string | null
  stock_name: string
  content_type: string
  published_at: string | null
  view_count: number | null
  primary_owner_user_id: string | null
  created_at: string
}

// 실험/플레이북 폼의 "영상 고르기"용. q(종목명·제목 검색)가 있으면 서버에서 찾고,
// 없으면 최근 등록순. 하루 60~90편씩 쌓이므로 목록 전체를 내려보내지 않는다.
export async function loadVideoOptions(supabaseAdmin: Session['supabaseAdmin'], opts: { q?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 100)
  // or() 필터 문법을 깨는 문자는 빼고 검색한다.
  const q = (opts.q || '').replace(/[,()%*\\_"']/g, ' ').trim().slice(0, 40)
  let query = supabaseAdmin
    .from(V5_TABLES.videos)
    .select('id, title, stock_name, content_type, published_at, view_count, primary_owner_user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (q) query = query.or(`stock_name.ilike.%${q}%,title.ilike.%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []) as VideoOptionRow[]
}

// ---------------------------------------------------------------------------
// 입력 검증(zod) 공용 조각
// ---------------------------------------------------------------------------

export function isRealYmd(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export const ymdSchema = z
  .string()
  .refine(isRealYmd, '날짜 형식이 올바르지 않아요.')
  .refine((v) => v >= '2000-01-01' && v <= '2100-12-31', '날짜 범위가 올바르지 않아요.')
export const optionalYmd = z.preprocess((v) => (v === '' ? null : v), ymdSchema.nullable().optional())
export const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(2000, '내용이 너무 길어요. 2000자 안으로 줄여 주세요.').nullable().optional()
)
export const amountSchema = z.coerce.number().int().min(0).max(1_000_000_000_000)
export const uuidSchema = z.string().uuid('올바른 값이 아니에요.')

// 작성자 본인 또는 관리자만 고치거나 지울 수 있다.
export function canEditRow(session: Pick<Session, 'isAdmin' | 'profile'>, createdBy: string | null) {
  return session.isAdmin || (createdBy !== null && createdBy === session.profile.id)
}
