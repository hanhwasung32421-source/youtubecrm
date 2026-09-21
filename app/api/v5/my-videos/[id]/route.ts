import { NextResponse } from 'next/server'
import { z } from 'zod'
import { V5_TABLES } from '@/lib/v5/tables'
import { badRequest, forbidden, getSession, handleRouteError, notFound, readJson } from '@/lib/v5/api'

// 잘못 등록한 영상을 고치거나 지울 때 쓴다. 본인이 등록한 영상만(관리자는 전부) 가능하다.
// 수정 가능한 항목은 종목명 · 형식 · 메모(분류) 세 가지뿐이다.
// 삭제에 ?createdWithinSec=N 을 붙이면 "N초 안에 새로 만들어진 영상"일 때만 지운다(등록 되돌리기용 안전장치:
// 같은 영상을 다시 등록한 경우 원래 있던 영상을 실수로 지우지 않게 한다).
const patchSchema = z.object({
  stock_name: z.string().trim().min(1, '종목명을 적어 주세요.').max(100, '종목명이 너무 길어요.').optional(),
  content_type: z.enum(['longform', 'shortform'], { message: '형식은 롱폼 또는 숏폼이어야 해요.' }).optional(),
  content_category: z
    .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(200, '메모가 너무 길어요.').nullable())
    .optional()
})

type Admin = Awaited<ReturnType<typeof getSession>>['supabaseAdmin']

async function loadOwner(supabaseAdmin: Admin, id: string) {
  const { data, error } = await supabaseAdmin.from(V5_TABLES.videos).select('id, primary_owner_user_id, created_at').eq('id', id).maybeSingle()
  if (error) throw error
  return data as { id: string; primary_owner_user_id: string | null; created_at: string | null } | null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabaseAdmin, profile, isAdmin } = await getSession(request)

    const existing = await loadOwner(supabaseAdmin, id)
    if (!existing) return notFound('영상을 찾을 수 없어요. 이미 지워졌을 수 있어요.')
    if (!isAdmin && existing.primary_owner_user_id !== profile.id) return forbidden('본인이 등록한 영상만 수정할 수 있어요.')

    const input = patchSchema.parse(await readJson(request))
    const patch: Record<string, unknown> = {}
    if (input.stock_name !== undefined) patch.stock_name = input.stock_name
    if (input.content_type !== undefined) patch.content_type = input.content_type
    if (input.content_category !== undefined) patch.content_category = input.content_category
    if (Object.keys(patch).length === 0) return badRequest('바꿀 내용이 없어요.')

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
    if (!existing) return notFound('영상을 찾을 수 없어요. 이미 지워졌을 수 있어요.')
    if (!isAdmin && existing.primary_owner_user_id !== profile.id) return forbidden('본인이 등록한 영상만 삭제할 수 있어요.')

    const guardRaw = new URL(request.url).searchParams.get('createdWithinSec')
    if (guardRaw !== null) {
      const guardSec = Number(guardRaw)
      const createdMs = existing.created_at ? new Date(existing.created_at).getTime() : NaN
      // 값이 이상하거나 만든 시각을 알 수 없으면 안전하게 지우지 않는다.
      if (!Number.isFinite(guardSec) || guardSec <= 0 || !Number.isFinite(createdMs) || Date.now() - createdMs > guardSec * 1000) {
        return NextResponse.json({ error: '방금 등록한 영상이 아니라서 지우지 않았어요. 아래 목록에서 직접 삭제해 주세요.' }, { status: 409 })
      }
    }

    const { error } = await supabaseAdmin.from(V5_TABLES.videos).delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, '영상 삭제 실패')
  }
}
