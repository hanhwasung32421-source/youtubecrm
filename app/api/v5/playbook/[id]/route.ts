import { mapPlaybook, PLAYBOOK_SELECT, playbookPatchSchema, type PlaybookRow } from '@/lib/v5/playbook'
import { V5_TABLES } from '@/lib/v5/tables'
import { badRequest, canEditRow, countMissingVideos, forbidden, getSession, handleRouteError, isMissingTableError, jsonNoStore, missingTableResponse, notFound, readJson, uuidSchema } from '@/lib/v5/api'

async function loadOwned(supabaseAdmin: Awaited<ReturnType<typeof getSession>>['supabaseAdmin'], id: string) {
  const { data, error } = await supabaseAdmin.from(V5_TABLES.playbookEntries).select('id, created_by').eq('id', id).maybeSingle()
  if (error) throw error
  return data as { id: string; created_by: string | null } | null
}

// 작성자 본인 또는 관리자만 고치거나 지울 수 있다. usage_count 는 여기서 바꿀 수 없다(/use 로만 늘어난다).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!uuidSchema.safeParse(id).success) return notFound('성공 공식을 찾을 수 없어요.')
    const session = await getSession(request)
    const { supabaseAdmin } = session

    const existing = await loadOwned(supabaseAdmin, id)
    if (!existing) return notFound('성공 공식을 찾을 수 없어요. 이미 지워졌을 수 있어요.')
    if (!canEditRow(session, existing.created_by)) return forbidden('본인이 만든 성공 공식만 고칠 수 있어요.')

    const input = playbookPatchSchema.parse(await readJson(request))

    if (input.exampleVideoId && (await countMissingVideos(supabaseAdmin, [input.exampleVideoId])) > 0) {
      return badRequest('고른 영상을 찾을 수 없어요. 목록을 새로 열어 다시 골라 주세요.')
    }

    const patch: Record<string, unknown> = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.whenToUse !== undefined) patch.when_to_use = input.whenToUse
    if (input.exampleVideoId !== undefined) patch.example_video_id = input.exampleVideoId || null
    if (input.tags !== undefined) patch.tags = input.tags
    if (input.effectNote !== undefined) patch.effect_note = input.effectNote || null
    if (Object.keys(patch).length === 0) return badRequest('바꿀 내용이 없어요.')

    const { data, error } = await supabaseAdmin.from(V5_TABLES.playbookEntries).update(patch).eq('id', id).select(PLAYBOOK_SELECT).maybeSingle()
    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }
    if (!data) return notFound('성공 공식을 찾을 수 없어요. 이미 지워졌을 수 있어요.')

    const [item] = await mapPlaybook(supabaseAdmin, [data as PlaybookRow], session)
    return jsonNoStore({ item })
  } catch (e) {
    return handleRouteError(e, '성공 공식을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!uuidSchema.safeParse(id).success) return notFound('성공 공식을 찾을 수 없어요.')
    const session = await getSession(request)
    const { supabaseAdmin } = session

    const existing = await loadOwned(supabaseAdmin, id)
    if (!existing) return jsonNoStore({ ok: true, alreadyGone: true })
    if (!canEditRow(session, existing.created_by)) return forbidden('본인이 만든 성공 공식만 지울 수 있어요.')

    const { error } = await supabaseAdmin.from(V5_TABLES.playbookEntries).delete().eq('id', id)
    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }
    return jsonNoStore({ ok: true })
  } catch (e) {
    return handleRouteError(e, '성공 공식을 지우지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
