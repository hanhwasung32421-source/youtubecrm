import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, requireV4User, v4ErrorResponse, type V4Context } from '@/lib/v4/server'
import { V4_TABLES } from '@/lib/v4/tables'
import { TABLES } from '@/lib/supabase/tables'
import { invalidatePeriodRows } from '@/lib/v4/period-rows'

type Params = { params: Promise<{ id: string }> }

const idSchema = z.uuid()

// "되돌리기"(방금 등록 취소)로 지울 때는 ?onlyNew=1 을 붙인다.
// 공유 등록 API 는 이미 있던 영상도 같은 주소면 덮어쓰기(upsert) 하므로, 다음 두 경우에는 지우지 않는다.
//  - 만든 지 5분이 지난 영상
//  - 등록 기록(video_registered)이 2번 이상 있는 영상 = 내가 등록하기 전에 이미 누군가(다른 화면·다른 사람) 등록해 둔 영상
const UNDO_FRESH_MS = 5 * 60 * 1000
const NOT_NEW_MESSAGE = '예전에 등록해 둔 영상이라 자동으로 지우지 않았어요. 잘못 올렸다면 아래 목록에서 직접 삭제해 주세요.'

async function isBrandNewRegistration(ctx: V4Context, id: string): Promise<boolean> {
  const { data, error } = await ctx.supabaseAdmin.from(V4_TABLES.videos).select('created_at').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  const createdAt = data?.created_at ? new Date(String(data.created_at)).getTime() : NaN
  if (Number.isNaN(createdAt) || Date.now() - createdAt > UNDO_FRESH_MS) return false
  const { count, error: countError } = await ctx.supabaseAdmin
    .from(TABLES.workActivityEvents)
    .select('id', { count: 'exact', head: true })
    .eq('related_video_id', id)
    .eq('activity_type', 'video_registered')
  if (countError) throw new Error(countError.message)
  return (count || 0) <= 1
}

const COLUMNS = 'id, stock_name, content_type, content_category, primary_owner_user_id'

type OwnedRow = {
  id: string
  stock_name: string | null
  content_type: string | null
  content_category: string | null
  primary_owner_user_id: string | null
}

// 본인이 등록한 영상이거나 관리자일 때만 고치거나 지울 수 있다.
async function loadOwned(ctx: V4Context, id: string) {
  const { data, error } = await ctx.supabaseAdmin.from(V4_TABLES.videos).select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { notFound: true as const }
  const row = data as OwnedRow
  if (!ctx.isAdmin && row.primary_owner_user_id !== ctx.profile.id) return { forbidden: true as const }
  return { row }
}

const patchSchema = z.object({
  stock_name: z.string().optional(),
  content_type: z.enum(['longform', 'shortform']).optional(),
  content_category: z.string().nullable().optional()
})

function publicItem(row: OwnedRow) {
  return { id: row.id, stock_name: row.stock_name, content_type: row.content_type, content_category: row.content_category }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireV4User(request)
    const { id } = await params
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '영상을 찾을 수 없어요. 화면을 새로고침해 주세요.' }, { status: 400 })
    const owned = await loadOwned(ctx, id)
    if ('notFound' in owned) return NextResponse.json({ error: '영상을 찾을 수 없어요. 이미 지워졌을 수 있어요.' }, { status: 404 })
    if ('forbidden' in owned) return NextResponse.json({ error: '내가 등록한 영상만 볼 수 있어요.' }, { status: 403 })
    return NextResponse.json({ item: publicItem(owned.row) })
  } catch (e) {
    return v4ErrorResponse(e, '영상 정보를 불러오지 못했어요.')
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireV4User(request)
    const { id } = await params
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '영상을 찾을 수 없어요. 화면을 새로고침해 주세요.' }, { status: 400 })

    const parsed = patchSchema.safeParse(await readJson(request))
    if (!parsed.success) return NextResponse.json({ error: '입력한 내용을 확인해 주세요.' }, { status: 400 })

    const patch: Record<string, unknown> = {}
    if (parsed.data.stock_name !== undefined) {
      const stock = parsed.data.stock_name.replace(/\s+/g, ' ').trim()
      if (!stock) return NextResponse.json({ error: '종목명을 적어 주세요.' }, { status: 400 })
      if (stock.length > 100) return NextResponse.json({ error: '종목명이 너무 길어요.' }, { status: 400 })
      patch.stock_name = stock
    }
    if (parsed.data.content_type !== undefined) patch.content_type = parsed.data.content_type
    if (parsed.data.content_category !== undefined) {
      const memo = (parsed.data.content_category || '').trim()
      if (memo.length > 200) return NextResponse.json({ error: '메모는 200자까지 적을 수 있어요.' }, { status: 400 })
      patch.content_category = memo || null
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: '바꿀 내용이 없어요.' }, { status: 400 })

    const owned = await loadOwned(ctx, id)
    if ('notFound' in owned) return NextResponse.json({ error: '영상을 찾을 수 없어요. 이미 지워졌을 수 있어요.' }, { status: 404 })
    if ('forbidden' in owned) return NextResponse.json({ error: '내가 등록한 영상만 고칠 수 있어요.' }, { status: 403 })

    const { data, error } = await ctx.supabaseAdmin.from(V4_TABLES.videos).update(patch).eq('id', id).select(COLUMNS).single()
    if (error) throw new Error(error.message)
    invalidatePeriodRows()
    return NextResponse.json({ ok: true, item: publicItem(data as OwnedRow) })
  } catch (e) {
    return v4ErrorResponse(e, '영상을 고치지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireV4User(request)
    const { id } = await params
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '영상을 찾을 수 없어요. 화면을 새로고침해 주세요.' }, { status: 400 })

    const owned = await loadOwned(ctx, id)
    if ('notFound' in owned) return NextResponse.json({ error: '영상을 찾을 수 없어요. 이미 지워졌을 수 있어요.' }, { status: 404 })
    if ('forbidden' in owned) return NextResponse.json({ error: '내가 등록한 영상만 지울 수 있어요.' }, { status: 403 })

    if (new URL(request.url).searchParams.get('onlyNew') === '1' && !(await isBrandNewRegistration(ctx, id))) {
      return NextResponse.json({ error: NOT_NEW_MESSAGE }, { status: 409 })
    }

    const { error } = await ctx.supabaseAdmin.from(V4_TABLES.videos).delete().eq('id', id)
    if (error) throw new Error(error.message)
    invalidatePeriodRows()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return v4ErrorResponse(e, '영상을 지우지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
