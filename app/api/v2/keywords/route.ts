import { NextResponse } from 'next/server'
import { z } from 'zod'
import { V2_TABLES } from '@/lib/v2/tables'
import {
  authedContext,
  forbidden,
  handleDbError,
  handleRouteError,
  isMissingTableError,
  isUuid,
  loadRecentStocks,
  loadStaffMap,
  nowIso
} from '@/lib/v2/server'
import { sampleKeywordsPayload } from '@/lib/v2/sample-data'
import { KEYWORD_STATUSES, PRIORITIES, type KeywordRadarItem, type KeywordsPayload } from '@/lib/v2/types'

// 키워드·트렌드 레이더 — "지금 다뤄야 할 검색 키워드/이슈" 팀 공유 보드.
// 조회는 모두, 추가는 로그인한 누구나, 수정·삭제는 추가한 사람과 관리자만.

const READ_ERROR = '키워드 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const SAVE_ERROR = '키워드를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const DELETE_ERROR = '키워드를 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.'

function isHttpUrl(value: string) {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// 출처 주소는 http/https 만 허용한다 (javascript: 같은 주소가 링크로 저장되는 것을 막는다).
const sourceUrlSchema = z
  .string()
  .trim()
  .max(500, '참고 기사 주소는 500자까지 적을 수 있어요.')
  .refine((v) => v === '' || isHttpUrl(v), '참고 기사 주소는 https:// 로 시작해야 해요.')
  .optional()
  .nullable()

const createSchema = z.object({
  stockName: z.string().trim().min(1, '종목명을 입력해 주세요.').max(80, '종목명은 80자까지 적을 수 있어요.'),
  keyword: z.string().trim().min(1, '키워드를 입력해 주세요.').max(120, '키워드는 120자까지 적을 수 있어요.'),
  sourceUrl: sourceUrlSchema,
  priority: z.enum(PRIORITIES, '급한 정도를 골라 주세요.').default('normal')
})

const patchSchema = z.object({
  id: z.string().uuid('키워드 정보가 올바르지 않아요. 화면을 새로고침해 주세요.'),
  status: z.enum(KEYWORD_STATUSES, '진행 상태가 올바르지 않아요.').optional(),
  priority: z.enum(PRIORITIES, '급한 정도를 골라 주세요.').optional(),
  stockName: z.string().trim().min(1, '종목명을 입력해 주세요.').max(80, '종목명은 80자까지 적을 수 있어요.').optional(),
  keyword: z.string().trim().min(1, '키워드를 입력해 주세요.').max(120, '키워드는 120자까지 적을 수 있어요.').optional(),
  sourceUrl: sourceUrlSchema
})

const SELECT = 'id, stock_name, keyword, source_url, priority, status, created_by, created_at, updated_at'

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 }
const DONE_KEEP = 100 // 완료된 키워드는 최근 100개만 함께 내려준다(할 일이 완료 목록에 밀려 잘리지 않도록 분리 조회)

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await authedContext(request)

    const [openRes, doneRes, doneCountRes, recentStocks] = await Promise.all([
      supabaseAdmin.from(V2_TABLES.keywordRadar).select(SELECT).neq('status', 'done').order('created_at', { ascending: false }).limit(1000),
      supabaseAdmin.from(V2_TABLES.keywordRadar).select(SELECT).eq('status', 'done').order('updated_at', { ascending: false }).limit(DONE_KEEP),
      supabaseAdmin.from(V2_TABLES.keywordRadar).select('id', { count: 'exact', head: true }).eq('status', 'done'),
      loadRecentStocks(supabaseAdmin)
    ])

    const error = openRes.error || doneRes.error
    if (error) {
      if (isMissingTableError(error)) return NextResponse.json(sampleKeywordsPayload())
      return handleDbError(error, READ_ERROR)
    }

    const staffMap = await loadStaffMap(supabaseAdmin)
    type Row = Omit<KeywordRadarItem, 'created_by_name'>
    const items: KeywordRadarItem[] = [...((openRes.data || []) as Row[]), ...((doneRes.data || []) as Row[])]
      .map((row) => ({ ...row, created_by_name: row.created_by ? staffMap.get(row.created_by) || null : null }))
      .sort((a, b) => {
        const aDone = a.status === 'done' ? 1 : 0
        const bDone = b.status === 'done' ? 1 : 0
        return aDone - bDone || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.created_at < b.created_at ? 1 : -1)
      })

    const payload: KeywordsPayload = { items, recentStocks, doneTotal: doneCountRes.count ?? items.filter((i) => i.status === 'done').length }
    return NextResponse.json(payload)
  } catch (e) {
    return handleRouteError(e, READ_ERROR)
  }
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json())
    const { profile, supabaseAdmin } = await authedContext(request)

    const { data, error } = await supabaseAdmin
      .from(V2_TABLES.keywordRadar)
      .insert({
        stock_name: body.stockName,
        keyword: body.keyword,
        source_url: body.sourceUrl || null,
        priority: body.priority,
        status: 'waiting',
        created_by: profile.id
      })
      .select(SELECT)
      .single()
    if (error || !data) return handleDbError(error, SAVE_ERROR)
    return NextResponse.json({ ok: true, item: { ...data, created_by_name: profile.name || null } })
  } catch (e) {
    return handleRouteError(e, SAVE_ERROR)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = patchSchema.parse(await request.json())
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)

    const { data: existing, error: loadError } = await supabaseAdmin
      .from(V2_TABLES.keywordRadar)
      .select('id, created_by')
      .eq('id', body.id)
      .maybeSingle()
    if (loadError) return handleDbError(loadError, SAVE_ERROR)
    if (!existing) return NextResponse.json({ error: '이미 삭제된 키워드예요. 목록을 새로고침합니다.' }, { status: 404 })
    if (!isAdmin && existing.created_by !== profile.id) return forbidden('추가한 사람과 관리자만 바꿀 수 있어요.')

    const patch: Record<string, unknown> = {}
    if (body.status !== undefined) patch.status = body.status
    if (body.priority !== undefined) patch.priority = body.priority
    if (body.stockName !== undefined) patch.stock_name = body.stockName
    if (body.keyword !== undefined) patch.keyword = body.keyword
    if (body.sourceUrl !== undefined) patch.source_url = body.sourceUrl || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: '바꿀 내용이 없어요.' }, { status: 400 })
    patch.updated_at = nowIso()

    const { data, error } = await supabaseAdmin.from(V2_TABLES.keywordRadar).update(patch).eq('id', body.id).select(SELECT).maybeSingle()
    if (error) return handleDbError(error, SAVE_ERROR)
    if (!data) return NextResponse.json({ error: '이미 삭제된 키워드예요. 목록을 새로고침합니다.' }, { status: 404 })
    return NextResponse.json({ ok: true, item: data })
  } catch (e) {
    return handleRouteError(e, SAVE_ERROR)
  }
}

export async function DELETE(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)
    const id = new URL(request.url).searchParams.get('id') || ''
    if (!isUuid(id)) {
      return NextResponse.json({ error: '삭제할 키워드를 찾지 못했어요. 화면을 새로고침해 주세요.' }, { status: 400 })
    }
    const { data: existing, error: loadError } = await supabaseAdmin.from(V2_TABLES.keywordRadar).select('id, created_by').eq('id', id).maybeSingle()
    if (loadError) return handleDbError(loadError, DELETE_ERROR)
    if (!existing) return NextResponse.json({ ok: true })
    if (!isAdmin && existing.created_by !== profile.id) return forbidden('추가한 사람과 관리자만 삭제할 수 있어요.')

    const { error } = await supabaseAdmin.from(V2_TABLES.keywordRadar).delete().eq('id', id)
    if (error) return handleDbError(error, DELETE_ERROR)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, DELETE_ERROR)
  }
}
