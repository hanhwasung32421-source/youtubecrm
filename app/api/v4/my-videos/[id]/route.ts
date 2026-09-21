import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, requireV4User, v4ErrorResponse, type V4Context } from '@/lib/v4/server'
import { V4_TABLES } from '@/lib/v4/tables'

type Params = { params: Promise<{ id: string }> }

const idSchema = z.uuid()

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
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '잘못된 영상 주소입니다.' }, { status: 400 })
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
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '잘못된 영상 주소입니다.' }, { status: 400 })

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
    return NextResponse.json({ ok: true, item: publicItem(data as OwnedRow) })
  } catch (e) {
    return v4ErrorResponse(e, '영상을 고치지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireV4User(request)
    const { id } = await params
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: '잘못된 영상 주소입니다.' }, { status: 400 })

    const owned = await loadOwned(ctx, id)
    if ('notFound' in owned) return NextResponse.json({ error: '영상을 찾을 수 없어요. 이미 지워졌을 수 있어요.' }, { status: 404 })
    if ('forbidden' in owned) return NextResponse.json({ error: '내가 등록한 영상만 지울 수 있어요.' }, { status: 403 })

    const { error } = await ctx.supabaseAdmin.from(V4_TABLES.videos).delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return v4ErrorResponse(e, '영상을 지우지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
