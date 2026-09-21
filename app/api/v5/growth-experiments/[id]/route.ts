import { NextResponse } from 'next/server'
import { EXPERIMENT_SELECT, experimentPatchSchema, mapExperiments, type ExperimentRow } from '@/lib/v5/experiments'
import { V5_TABLES } from '@/lib/v5/tables'
import { todayYmd } from '@/lib/v5/format'
import { badRequest, canEditRow, countMissingVideos, forbidden, getSession, handleRouteError, isMissingTableError, missingTableResponse, notFound, readJson, uuidSchema } from '@/lib/v5/api'

// 캔버스 카드는 상태만 바꾸는 경우가 잦으므로 부분 수정을 허용한다.
// 작성자 본인 또는 관리자만 수정/삭제할 수 있다.
async function loadOwnedExperiment(supabaseAdmin: Awaited<ReturnType<typeof getSession>>['supabaseAdmin'], id: string) {
  const { data, error } = await supabaseAdmin
    .from(V5_TABLES.growthExperiments)
    .select('id, created_by, started_on, ended_on, status, updated_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; created_by: string | null; started_on: string; ended_on: string | null; status: string; updated_at: string } | null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!uuidSchema.safeParse(id).success) return notFound('실험 카드를 찾을 수 없어요.')
    const session = await getSession(request)
    const { supabaseAdmin } = session

    const existing = await loadOwnedExperiment(supabaseAdmin, id)
    if (!existing) return notFound('실험 카드를 찾을 수 없어요. 이미 지워졌을 수 있어요.')
    if (!canEditRow(session, existing.created_by)) return forbidden('본인이 만든 실험만 고칠 수 있어요.')

    const input = experimentPatchSchema.parse(await readJson(request))

    // 종료일 검증은 저장돼 있던 시작일까지 합쳐서 본다.
    const startedOn = input.startedOn ?? existing.started_on
    let endedOn: string | null | undefined = input.endedOn // undefined = 건드리지 않음
    if (input.status && endedOn === undefined) {
      if (input.status === 'won' || input.status === 'lost') {
        // 결과를 기록하는 순간이 곧 종료일. 이미 종료일이 있으면 그대로 둔다.
        if (!existing.ended_on) endedOn = todayYmd() < startedOn ? startedOn : todayYmd()
      } else if (input.status === 'running') {
        endedOn = null // 다시 진행하면 종료일을 비운다.
      }
    }
    const effectiveEnd = endedOn === undefined ? existing.ended_on : endedOn
    if (effectiveEnd && effectiveEnd < startedOn) return badRequest('종료일은 시작일보다 빠를 수 없어요.')

    if (input.videoIds) {
      const missing = await countMissingVideos(supabaseAdmin, input.videoIds)
      if (missing > 0) return badRequest('고른 영상 중 지워진 영상이 있어요. 목록을 새로 열어 다시 골라 주세요.')
    }

    const patch: Record<string, unknown> = {}
    if (input.dimensions) patch.dimensions = input.dimensions
    if (input.videoIds) patch.video_ids = input.videoIds
    if (input.hypothesis !== undefined) patch.hypothesis = input.hypothesis
    if (input.metricDefinition !== undefined) patch.metric_definition = input.metricDefinition
    if (input.startedOn) patch.started_on = input.startedOn
    if (endedOn !== undefined) patch.ended_on = endedOn
    if (input.status) patch.status = input.status
    if (input.effectSize !== undefined) patch.effect_size = input.effectSize
    if (input.nextAction !== undefined) patch.next_action = input.nextAction || null
    if (Object.keys(patch).length === 0) return badRequest('바꿀 내용이 없어요.')
    patch.updated_at = new Date().toISOString()

    const { data, error } = await supabaseAdmin.from(V5_TABLES.growthExperiments).update(patch).eq('id', id).select(EXPERIMENT_SELECT).maybeSingle()
    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }
    if (!data) return notFound('실험 카드를 찾을 수 없어요. 이미 지워졌을 수 있어요.')

    const [item] = await mapExperiments(supabaseAdmin, [data as ExperimentRow], session)
    return NextResponse.json({ item })
  } catch (e) {
    return handleRouteError(e, '실험을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!uuidSchema.safeParse(id).success) return notFound('실험 카드를 찾을 수 없어요.')
    const session = await getSession(request)
    const { supabaseAdmin } = session

    const existing = await loadOwnedExperiment(supabaseAdmin, id)
    if (!existing) return NextResponse.json({ ok: true, alreadyGone: true }) // 이미 지워졌다면 목적은 달성된 것
    if (!canEditRow(session, existing.created_by)) return forbidden('본인이 만든 실험만 지울 수 있어요.')

    const { error } = await supabaseAdmin.from(V5_TABLES.growthExperiments).delete().eq('id', id)
    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, '실험을 지우지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
