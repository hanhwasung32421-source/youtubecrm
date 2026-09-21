import { noStoreJson } from '@/lib/v4/http'
import { z } from 'zod'
import { getKstYmd } from '@/lib/attendance/time'
import { firstIssueMessage } from '@/lib/v4/errors'
import { EXPERIMENT_SELECT, assertLinkableVideo, experimentInputSchema, mapExperiments, type ExperimentRow } from '@/lib/v4/experiments'
import { dbError, readJson, requireV4User, v4ErrorResponse, type V4Context } from '@/lib/v4/server'
import { MISSING_TABLE_MESSAGE, V4_TABLES, isMissingTableError } from '@/lib/v4/tables'

type Params = { params: Promise<{ id: string }> }

const idSchema = z.uuid()

// 본인이 만든 실험이거나 관리자일 때만 수정/삭제 가능
async function loadOwned(ctx: V4Context, id: string) {
  const { data, error } = await ctx.supabaseAdmin.from(V4_TABLES.contentExperiments).select(EXPERIMENT_SELECT).eq('id', id).maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return { missing: true as const }
    throw dbError(error)
  }
  if (!data) return { notFound: true as const }
  const row = data as ExperimentRow
  if (!ctx.isAdmin && row.created_by !== ctx.profile.id) return { forbidden: true as const }
  return { row }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireV4User(request)
    const { id } = await params
    if (!idSchema.safeParse(id).success) {
      return noStoreJson({ error: '잘못된 실험입니다. 화면을 새로 열어 주세요.' }, { status: 400 })
    }
    const parsed = experimentInputSchema.partial().safeParse(await readJson(request))
    if (!parsed.success) {
      return noStoreJson({ error: firstIssueMessage(parsed.error) }, { status: 400 })
    }

    const owned = await loadOwned(ctx, id)
    if ('missing' in owned) return noStoreJson({ error: MISSING_TABLE_MESSAGE }, { status: 409 })
    if ('notFound' in owned) return noStoreJson({ error: '실험을 찾을 수 없어요. 이미 삭제됐을 수 있어요.' }, { status: 404 })
    if ('forbidden' in owned) return noStoreJson({ error: '본인이 등록한 실험만 수정할 수 있어요.' }, { status: 403 })

    const input = parsed.data
    const patch: Record<string, unknown> = {}
    if (input.videoId !== undefined) patch.video_id = input.videoId || null
    if (input.hypothesis !== undefined) patch.hypothesis = input.hypothesis
    if (input.variantA !== undefined) patch.variant_a = input.variantA
    if (input.variantB !== undefined) patch.variant_b = input.variantB
    if (input.metric !== undefined) patch.metric = input.metric
    if (input.startedOn !== undefined) patch.started_on = input.startedOn
    if (input.endedOn !== undefined) patch.ended_on = input.endedOn || null
    if (input.winner !== undefined) patch.winner = input.winner || null
    if (input.learning !== undefined) patch.learning = input.learning || null

    if (Object.keys(patch).length === 0) {
      return noStoreJson({ error: '바꿀 내용이 없어요.' }, { status: 400 })
    }

    const startedOn = (input.startedOn ?? owned.row.started_on) as string
    // 종료일을 null 로 비우는 요청(= 결과 취소)과 "보내지 않음"을 구분한다. (?? 는 null 도 이전 값으로 덮어써 버린다)
    let endedOn = input.endedOn !== undefined ? input.endedOn || null : owned.row.ended_on
    // 결과(승자)를 새로 기록하는데 종료일이 비어 있으면 오늘로 채운다.
    if (input.winner && !endedOn && input.endedOn === undefined) {
      const today = getKstYmd()
      endedOn = today < startedOn ? startedOn : today
      patch.ended_on = endedOn
    }
    if (endedOn && startedOn && endedOn < startedOn) {
      return noStoreJson({ error: '종료일은 시작일보다 빠를 수 없어요.' }, { status: 400 })
    }
    if (input.videoId && input.videoId !== owned.row.video_id) await assertLinkableVideo(ctx, input.videoId)

    patch.updated_at = new Date().toISOString()
    const { data, error } = await ctx.supabaseAdmin
      .from(V4_TABLES.contentExperiments)
      .update(patch)
      .eq('id', id)
      .select(EXPERIMENT_SELECT)
      .maybeSingle()
    if (error) throw dbError(error)
    if (!data) return noStoreJson({ error: '실험을 찾을 수 없어요. 이미 삭제됐을 수 있어요.' }, { status: 404 })

    const [item] = await mapExperiments(ctx, [data as ExperimentRow])
    return noStoreJson({ item })
  } catch (e) {
    return v4ErrorResponse(e, '실험 수정 실패')
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireV4User(request)
    const { id } = await params
    if (!idSchema.safeParse(id).success) {
      return noStoreJson({ error: '잘못된 실험입니다. 화면을 새로 열어 주세요.' }, { status: 400 })
    }
    const owned = await loadOwned(ctx, id)
    if ('missing' in owned) return noStoreJson({ error: MISSING_TABLE_MESSAGE }, { status: 409 })
    // 이미 지워졌다면 목적(없애기)은 달성된 것이므로 성공으로 본다.
    if ('notFound' in owned) return noStoreJson({ ok: true, alreadyDeleted: true })
    if ('forbidden' in owned) return noStoreJson({ error: '본인이 등록한 실험만 삭제할 수 있어요.' }, { status: 403 })

    const { error } = await ctx.supabaseAdmin.from(V4_TABLES.contentExperiments).delete().eq('id', id)
    if (error) throw dbError(error)
    return noStoreJson({ ok: true })
  } catch (e) {
    return v4ErrorResponse(e, '실험 삭제 실패')
  }
}
