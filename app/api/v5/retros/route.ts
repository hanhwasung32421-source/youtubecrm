import { NextResponse } from 'next/server'
import { SAMPLE_RETROS } from '@/lib/v5/sample-data'
import { V5_TABLES } from '@/lib/v5/tables'
import { isoWeekRangeText } from '@/lib/v5/format'
import { mapRetros, pullKpiSnapshot, RETRO_SELECT, retroCreateSchema, writableWeeks, type RetroRow } from '@/lib/v5/retros'
import { badRequest, fetchAllPages, forbidden, getSession, handleRouteError, isMissingTableError, jsonNoStore, missingTableResponse, readJson } from '@/lib/v5/api'

export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin } = session
    // 서버 기준(한국 시간) "이번 주/지난주" 라벨 — POST(중복 방지)와 같은 기준이라 화면이 "이미 작성함"을 정확히 판단한다.
    const { thisWeek, lastWeek } = writableWeeks()

    let all: { rows: RetroRow[]; total: number; truncated: boolean }
    try {
      all = await fetchAllPages<RetroRow>(
        (from, to, withCount) =>
          supabaseAdmin
            .from(V5_TABLES.weeklyRetros)
            .select(RETRO_SELECT, withCount ? { count: 'exact' } : undefined)
            .order('week_label', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as any,
        { maxPages: 3 }
      )
    } catch (error) {
      if (isMissingTableError(error)) return NextResponse.json({ sample: true, items: SAMPLE_RETROS, thisWeekLabel: thisWeek, lastWeekLabel: lastWeek })
      throw error
    }

    const items = await mapRetros(supabaseAdmin, all.rows)
    return NextResponse.json({ sample: false, items, thisWeekLabel: thisWeek, lastWeekLabel: lastWeek })
  } catch (e) {
    return handleRouteError(e, '주간 회고를 불러오지 못했어요.')
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin, profile } = session

    const input = retroCreateSchema.parse(await readJson(request))
    const { thisWeek, lastWeek } = writableWeeks()
    const weekLabel = input.weekLabel || thisWeek
    if (weekLabel !== thisWeek && weekLabel !== lastWeek) {
      return badRequest('이번 주나 지난주 회고만 새로 쓸 수 있어요.')
    }
    if (!input.wentWell && !input.toImprove && input.actionItems.length === 0) {
      return badRequest('한 줄이라도 적어 주세요.')
    }

    // 같은 주 회고가 이미 있으면 새로 만들지 않고 알려 준다(고쳐 쓰기로 안내).
    const { data: existing, error: existingError } = await supabaseAdmin.from(V5_TABLES.weeklyRetros).select('id').eq('week_label', weekLabel).maybeSingle()
    if (existingError) {
      if (isMissingTableError(existingError)) return missingTableResponse()
      throw existingError
    }
    const exists = (id: string) =>
      NextResponse.json({ error: `이미 ${weekLabel === thisWeek ? '이번 주' : '지난주'} 회고가 있어요. 그 회고를 고쳐 쓸 수 있어요.`, code: 'exists', existingId: id }, { status: 409 })
    if (existing) return exists(existing.id)

    const kpiSnapshot = await pullKpiSnapshot(supabaseAdmin, weekLabel)

    const { data, error } = await supabaseAdmin
      .from(V5_TABLES.weeklyRetros)
      .insert({
        week_label: weekLabel,
        went_well: input.wentWell || null,
        to_improve: input.toImprove || null,
        action_items: input.actionItems,
        kpi_snapshot: kpiSnapshot,
        created_by: profile.id
      })
      .select(RETRO_SELECT)
      .single()

    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      if ((error as { code?: string }).code === '23505') {
        // 동시에 두 번 저장한 경우(UNIQUE week_label)
        const { data: winner } = await supabaseAdmin.from(V5_TABLES.weeklyRetros).select('id').eq('week_label', weekLabel).maybeSingle()
        return exists(winner?.id || '')
      }
      throw error
    }

    const [item] = await mapRetros(supabaseAdmin, [data as RetroRow])
    return jsonNoStore({ item, weekText: isoWeekRangeText(weekLabel) })
  } catch (e) {
    return handleRouteError(e, '주간 회고를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
