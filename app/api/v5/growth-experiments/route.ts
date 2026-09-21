import { NextResponse } from 'next/server'
import { EXPERIMENT_SELECT, experimentInputSchema, mapExperiments, type ExperimentRow } from '@/lib/v5/experiments'
import { SAMPLE_EXPERIMENTS } from '@/lib/v5/sample-data'
import { V5_TABLES } from '@/lib/v5/tables'
import { todayYmd } from '@/lib/v5/format'
import { badRequest, countMissingVideos, fetchAllPages, getSession, handleRouteError, isMissingTableError, missingTableResponse, readJson } from '@/lib/v5/api'

export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    const { supabaseAdmin, isAdmin, profile } = session

    let all: { rows: ExperimentRow[]; total: number; truncated: boolean }
    try {
      // 관리자는 팀 전체, 직원은 본인 것만. 1000개 넘어도 잘리지 않게 나눠 읽는다.
      all = await fetchAllPages<ExperimentRow>(
        (from, to, withCount) => {
          let q = supabaseAdmin
            .from(V5_TABLES.growthExperiments)
            .select(EXPERIMENT_SELECT, withCount ? { count: 'exact' } : undefined)
            .order('started_on', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
          if (!isAdmin) q = q.eq('created_by', profile.id)
          return q.range(from, to) as any
        },
        { maxPages: 5 }
      )
    } catch (error) {
      if (isMissingTableError(error)) {
        // 테이블이 없으면 소유권을 판단할 실데이터가 없으니 샘플을 그대로 보여준다.
        return NextResponse.json({ sample: true, items: SAMPLE_EXPERIMENTS })
      }
      throw error
    }

    const items = await mapExperiments(supabaseAdmin, all.rows, session)
    return NextResponse.json({ sample: false, items, truncated: all.truncated })
  } catch (e) {
    return handleRouteError(e, '성장 실험 목록을 불러오지 못했어요.')
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request)
    const { supabaseAdmin, profile } = session

    const input = experimentInputSchema.parse(await readJson(request))
    if (input.endedOn && input.endedOn < input.startedOn) {
      return badRequest('종료일은 시작일보다 빠를 수 없어요.')
    }

    // video_ids 는 배열 컬럼이라 DB 외래키가 없다. 없는 영상이 섞이지 않게 여기서 확인한다.
    const missing = await countMissingVideos(supabaseAdmin, input.videoIds)
    if (missing > 0) {
      return badRequest('고른 영상 중 지워진 영상이 있어요. 목록을 새로 열어 다시 골라 주세요.')
    }

    // 처음부터 성공/실패로 기록하는 경우에도 종료일이 비지 않게 한다.
    const finished = input.status === 'won' || input.status === 'lost'
    const endedOn = input.endedOn || (finished ? (todayYmd() < input.startedOn ? input.startedOn : todayYmd()) : null)

    const { data, error } = await supabaseAdmin
      .from(V5_TABLES.growthExperiments)
      .insert({
        dimensions: input.dimensions,
        video_ids: input.videoIds,
        hypothesis: input.hypothesis,
        metric_definition: input.metricDefinition,
        started_on: input.startedOn,
        ended_on: endedOn,
        status: input.status,
        effect_size: input.effectSize ?? null,
        next_action: input.nextAction || null,
        created_by: profile.id
      })
      .select(EXPERIMENT_SELECT)
      .single()

    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }

    const [item] = await mapExperiments(supabaseAdmin, [data as ExperimentRow], session)
    return NextResponse.json({ item })
  } catch (e) {
    return handleRouteError(e, '실험을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
