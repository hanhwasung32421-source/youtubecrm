import { NextResponse } from 'next/server'
import { z } from 'zod'
import { V5_TABLES } from '@/lib/v5/tables'
import { badRequest, forbidden, getSession, handleRouteError, notFound, readJson } from '@/lib/v5/api'

// 잘못 등록한 영상을 고치거나 지울 때 쓴다. 본인이 등록한 영상만(관리자는 전부) 가능하다.
// 수정 가능한 항목은 종목명 · 형식 · 메모(분류) 세 가지뿐이다.
const patchSchema = z.object({
  stock_name: z.string().trim().min(1, '종목명을 적어 주세요.').max(100, '종목명이 너무 깁니다.').optional(),
  content_type: z.enum(['longform', 'shortform'], { message: '형식은 롱폼 또는 숏폼이어야 합니다.' }).optional(),
  content_category: z
    .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(200, '메모가 너무 깁니다.').nullable())
    .optional()
})

type Admin = Awaited<ReturnType<typeof getSession>>['supabaseAdmin']

async function loadOwner(supabaseAdmin: Admin, id: string) {
  const { data, error } = await supabaseAdmin.from(V5_TABLES.videos).select('id, primary_owner_user_id').eq('id', id).maybeSingle()
  if (error) throw error
  return data as { id: string; primary_owner_user_id: string | null } | null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabaseAdmin, profile, isAdmin } = await getSession(request)

    const existing = await loadOwner(supabaseAdmin, id)
    if (!existing) return notFound('영상을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
    if (!isAdmin && existing.primary_owner_user_id !== profile.id) return forbidden('본인이 등록한 영상만 수정할 수 있습니다.')

    const input = patchSchema.parse(await readJson(request))
    const patch: Record<string, unknown> = {}
    if (input.stock_name !== undefined) patch.stock_name = input.stock_name
    if (input.content_type !== undefined) patch.content_type = input.content_type
    if (input.content_category !== undefined) patch.content_category = input.content_category
    if (Object.keys(patch).length === 0) return badRequest('바꿀 내용이 없습니다.')

    const { data, error } = await supabaseAdmin
      .from(V5_TABLES.videos)
      .update(patch)
      .eq('id', id)
      .select('id, stock_name, content_type, content_category')
      .single()
    if (error) throw error

    return NextResponse.json({ ok: true, item: data })
  } catch (e) {
    return handleRouteError(e, '영상 수정 실패')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabaseAdmin, profile, isAdmin } = await getSession(request)

    const existing = await loadOwner(supabaseAdmin, id)
    if (!existing) return notFound('영상을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
    if (!isAdmin && existing.primary_owner_user_id !== profile.id) return forbidden('본인이 등록한 영상만 삭제할 수 있습니다.')

    const { error } = await supabaseAdmin.from(V5_TABLES.videos).delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, '영상 삭제 실패')
  }
}
