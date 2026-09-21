import { NextResponse } from 'next/server'
import { V5_TABLES } from '@/lib/v5/tables'
import { mapRetros, RETRO_SELECT, retroPatchSchema, type RetroRow } from '@/lib/v5/retros'
import { badRequest, forbidden, getSession, handleRouteError, isMissingTableError, missingTableResponse, notFound, readJson, uuidSchema } from '@/lib/v5/api'

// 회고 내용을 다듬거나, 액션 아이템 체크박스를 토글할 때 쓴다. 관리자 전용.
// week_label 과 kpi_snapshot 은 저장 시점 기록이라 여기서 바꾸지 않는다.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!uuidSchema.safeParse(id).success) return notFound('회고를 찾을 수 없어요.')
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin } = session

    const input = retroPatchSchema.parse(await readJson(request))
    const patch: Record<string, unknown> = {}
    if (input.wentWell !== undefined) patch.went_well = input.wentWell || null
    if (input.toImprove !== undefined) patch.to_improve = input.toImprove || null
    if (input.actionItems !== undefined) patch.action_items = input.actionItems
    if (Object.keys(patch).length === 0) return badRequest('바꿀 내용이 없어요.')

    const { data, error } = await supabaseAdmin.from(V5_TABLES.weeklyRetros).update(patch).eq('id', id).select(RETRO_SELECT).maybeSingle()
    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }
    if (!data) return notFound('회고를 찾을 수 없어요. 이미 지워졌을 수 있어요.')

    const [item] = await mapRetros(supabaseAdmin, [data as RetroRow])
    return NextResponse.json({ item })
  } catch (e) {
    return handleRouteError(e, '회고를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!uuidSchema.safeParse(id).success) return notFound('회고를 찾을 수 없어요.')
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin } = session

    const { error } = await supabaseAdmin.from(V5_TABLES.weeklyRetros).delete().eq('id', id)
    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, '회고를 지우지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
