import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api/error-response'
import { authenticate, readJson, type SupabaseAdmin } from '@/lib/v3/server'
import { SHARED_TABLES } from '@/lib/v3/tables'

// 내가 등록한 영상 하나를 고치거나(종목·형식·메모) 지운다. 본인 영상 또는 관리자만 가능.

const idSchema = z.string().uuid()

const patchSchema = z
  .object({
    stock_name: z.string().trim().min(1, '종목명을 입력해 주세요.').max(60, '종목명은 60자 이내로 입력해 주세요.').optional(),
    content_type: z.enum(['longform', 'shortform'], { message: '형식은 롱폼 또는 숏폼으로 골라 주세요.' }).optional(),
    content_category: z.string().trim().max(100, '메모는 100자 이내로 입력해 주세요.').nullable().optional()
  })
  .strict()

const COLUMNS = 'id, stock_name, content_type, content_category, primary_owner_user_id, created_at'

// 등록 직후 되돌리기(?undo=1)로 지울 수 있는 시간. 이보다 오래된 영상은 "전에 있던 영상"이라 지우지 않는다.
const UNDO_DELETE_MAX_AGE_MS = 2 * 60 * 1000

type Row = {
  id: string
  stock_name: string | null
  content_type: 'longform' | 'shortform'
  content_category: string | null
  primary_owner_user_id: string | null
  created_at: string | null
}

function notFound() {
  return NextResponse.json({ error: '영상을 찾지 못했어요. 이미 삭제됐을 수 있어요.' }, { status: 404 })
}

function forbidden() {
  return NextResponse.json({ error: '내가 등록한 영상만 고치거나 지울 수 있어요.' }, { status: 403 })
}

async function loadRow(supabaseAdmin: SupabaseAdmin, id: string): Promise<Row | null> {
  const { data, error } = await supabaseAdmin.from(SHARED_TABLES.videos).select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Row | null) || null
}

function publicRow(row: Row) {
  return {
    id: row.id,
    stock_name: row.stock_name,
    content_type: row.content_type,
    content_category: row.content_category
  }
}

type Ctx = { params: Promise<{ id: string }> }

// 수정 창을 열 때 현재 메모를 불러오는 용도(목록 API에는 메모가 없다).
export async function GET(request: Request, context: Ctx) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const { id } = await context.params
    if (!idSchema.safeParse(id).success) return notFound()
    const row = await loadRow(supabaseAdmin, id)
    if (!row) return notFound()
    if (!isAdmin && row.primary_owner_user_id !== profile.id) return forbidden()
    return NextResponse.json({ video: publicRow(row) })
  } catch (e: any) {
    return errorResponse(e, '영상 정보를 불러오지 못했어요.')
  }
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const { id } = await context.params
    if (!idSchema.safeParse(id).success) return notFound()

    const parsed = patchSchema.safeParse((await readJson(request)) || {})
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력한 내용을 확인해 주세요.' }, { status: 400 })
    }

    const update: Record<string, string | null> = {}
    if (parsed.data.stock_name !== undefined) update.stock_name = parsed.data.stock_name.replace(/\s+/g, ' ')
    if (parsed.data.content_type !== undefined) update.content_type = parsed.data.content_type
    if (parsed.data.content_category !== undefined) update.content_category = parsed.data.content_category?.trim() || null
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: '바꿀 내용이 없어요.' }, { status: 400 })
    }

    const row = await loadRow(supabaseAdmin, id)
    if (!row) return notFound()
    if (!isAdmin && row.primary_owner_user_id !== profile.id) return forbidden()

    const { data, error } = await supabaseAdmin
      .from(SHARED_TABLES.videos)
      .update(update)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return notFound()

    return NextResponse.json({ ok: true, video: publicRow(data as Row) })
  } catch (e: any) {
    return errorResponse(e, '영상 정보를 고치지 못했어요.')
  }
}

export async function DELETE(request: Request, context: Ctx) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const { id } = await context.params
    if (!idSchema.safeParse(id).success) return notFound()

    const row = await loadRow(supabaseAdmin, id)
    if (!row) return notFound()
    if (!isAdmin && row.primary_owner_user_id !== profile.id) return forbidden()

    // 방금 등록을 되돌리는 요청이면, 정말 방금 새로 만들어진 영상일 때만 지운다(전에 있던 영상을 실수로 지우지 않도록).
    if (new URL(request.url).searchParams.get('undo') === '1') {
      const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN
      if (!Number.isFinite(createdMs) || Date.now() - createdMs > UNDO_DELETE_MAX_AGE_MS) {
        return NextResponse.json({ error: '이 영상은 방금 새로 등록한 것이 아니라서 지우지 않았어요.' }, { status: 409 })
      }
    }

    const { error } = await supabaseAdmin.from(SHARED_TABLES.videos).delete().eq('id', id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return errorResponse(e, '영상을 삭제하지 못했어요.')
  }
}
