import { NextResponse } from 'next/server'
import { getKstYmd } from '@/lib/attendance/time'
import { firstIssueMessage } from '@/lib/v4/errors'
import {
  DEFAULT_METRIC,
  EXPERIMENT_SELECT,
  assertLinkableVideo,
  experimentCreateSchema,
  loadVideoOptions,
  mapExperiments,
  type ExperimentRow
} from '@/lib/v4/experiments'
import { getSampleExperiments } from '@/lib/v4/sample-data'
import { dbError, readJson, requireV4User, v4ErrorResponse } from '@/lib/v4/server'
import { MISSING_TABLE_MESSAGE, V4_TABLES, isMissingTableError } from '@/lib/v4/tables'

// 한 번에 내려주는 최대 실험 수 (Supabase 기본 1000행 제한을 코드에서 명시). 넘으면 truncated: true.
const LIST_LIMIT = 1000

export async function GET(request: Request) {
  try {
    const ctx = await requireV4User(request)
    let q = ctx.supabaseAdmin
      .from(V4_TABLES.contentExperiments)
      .select(EXPERIMENT_SELECT)
      .order('started_on', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_LIMIT)
    if (!ctx.isAdmin) q = q.eq('created_by', ctx.profile.id)

    const [{ data, error }, videoOptions] = await Promise.all([q, loadVideoOptions(ctx)])

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ sample: true, items: getSampleExperiments(), videoOptions, scope: ctx.isAdmin ? 'admin' : 'staff', truncated: false })
      }
      throw dbError(error)
    }

    const rows = (data || []) as ExperimentRow[]
    const items = await mapExperiments(ctx, rows)
    return NextResponse.json({ sample: false, items, videoOptions, scope: ctx.isAdmin ? 'admin' : 'staff', truncated: rows.length >= LIST_LIMIT })
  } catch (e) {
    return v4ErrorResponse(e, '실험 목록 조회 실패')
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireV4User(request)
    const parsed = experimentCreateSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssueMessage(parsed.error) }, { status: 400 })
    }
    const input = parsed.data

    // 결과(승자)를 함께 적었는데 종료일이 없으면 오늘(시작일이 더 늦으면 시작일)로 채운다.
    let endedOn = input.endedOn || null
    if (!endedOn && input.winner) {
      const today = getKstYmd()
      endedOn = today < input.startedOn ? input.startedOn : today
    }
    if (endedOn && endedOn < input.startedOn) {
      return NextResponse.json({ error: '종료일은 시작일보다 빠를 수 없어요.' }, { status: 400 })
    }
    await assertLinkableVideo(ctx, input.videoId)

    const { data, error } = await ctx.supabaseAdmin
      .from(V4_TABLES.contentExperiments)
      .insert({
        video_id: input.videoId || null,
        hypothesis: input.hypothesis,
        variant_a: input.variantA,
        variant_b: input.variantB,
        metric: input.metric || DEFAULT_METRIC,
        started_on: input.startedOn,
        ended_on: endedOn,
        winner: input.winner || null,
        learning: input.learning || null,
        created_by: ctx.profile.id
      })
      .select(EXPERIMENT_SELECT)
      .single()

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: MISSING_TABLE_MESSAGE }, { status: 409 })
      }
      throw dbError(error)
    }

    const [item] = await mapExperiments(ctx, [data as ExperimentRow])
    return NextResponse.json({ item })
  } catch (e) {
    return v4ErrorResponse(e, '실험 등록 실패')
  }
}
