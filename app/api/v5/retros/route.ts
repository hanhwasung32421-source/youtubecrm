import { NextResponse } from 'next/server'
import { z } from 'zod'
import { addDays, isoWeekLabel, todayYmd } from '@/lib/v5/format'
import type { RetroKpiSnapshot, WeeklyRetro } from '@/lib/v5/types'
import { SAMPLE_RETROS } from '@/lib/v5/sample-data'
import { V5_TABLES } from '@/lib/v5/tables'
import { forbidden, getSession, handleRouteError, isMissingTableError, loadUserMap, missingTableResponse, optionalText, readJson } from '@/lib/v5/api'

type RetroRow = Omit<WeeklyRetro, 'author_name'>

const RETRO_SELECT = 'id, week_label, went_well, to_improve, action_items, kpi_snapshot, created_by, created_at'

async function mapRetros(supabaseAdmin: Awaited<ReturnType<typeof getSession>>['supabaseAdmin'], rows: RetroRow[]): Promise<WeeklyRetro[]> {
  if (rows.length === 0) return []
  const userMap = await loadUserMap(supabaseAdmin, rows.map((r) => r.created_by))
  return rows.map((r) => ({ ...r, author_name: r.created_by ? userMap.get(r.created_by) || null : null }))
}

// 최근 7일(오늘 포함)간 등록된 영상 기준 스냅샷. 저장 시점에 굳어져서 이후 영상이
// 삭제/변경돼도 회고 히스토리가 흔들리지 않는다.
async function pullKpiSnapshot(supabaseAdmin: Awaited<ReturnType<typeof getSession>>['supabaseAdmin']): Promise<RetroKpiSnapshot> {
  const since = `${addDays(todayYmd(), -6)}T00:00:00+09:00`
  const { data } = await supabaseAdmin.from(V5_TABLES.videos).select('view_count').gte('created_at', since)
  const rows = (data || []) as Array<{ view_count: number | null }>
  const totalViews = rows.reduce((s, r) => s + (r.view_count || 0), 0)
  const totalVideos = rows.length
  return { totalViews, totalVideos, avgViewsPerVideo: totalVideos > 0 ? Math.round(totalViews / totalVideos) : 0 }
}

export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin } = session
    // 서버 기준 "이번 주" 라벨 — POST(중복 방지)와 같은 기준이라 화면이 "이미 작성함"을 정확히 판단할 수 있다.
    const thisWeekLabel = isoWeekLabel()

    const { data, error } = await supabaseAdmin.from(V5_TABLES.weeklyRetros).select(RETRO_SELECT).order('week_label', { ascending: false })
    if (error) {
      if (isMissingTableError(error)) return NextResponse.json({ sample: true, items: SAMPLE_RETROS, thisWeekLabel })
      throw error
    }

    const items = await mapRetros(supabaseAdmin, (data || []) as RetroRow[])
    return NextResponse.json({ sample: false, items, thisWeekLabel })
  } catch (e) {
    return handleRouteError(e, '성장 회고 목록 조회 실패')
  }
}

const retroInputSchema = z.object({
  wentWell: optionalText,
  toImprove: optionalText,
  actionItems: z
    .array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean().optional().default(false) }))
    .max(20)
    .optional()
    .default([])
})

export async function POST(request: Request) {
  try {
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin, profile } = session

    const input = retroInputSchema.parse(await readJson(request))
    const weekLabel = isoWeekLabel()
    const kpiSnapshot = await pullKpiSnapshot(supabaseAdmin)

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
        return NextResponse.json({ error: `이번 주(${weekLabel}) 회고는 이미 등록되어 있습니다.` }, { status: 409 })
      }
      throw error
    }

    const [item] = await mapRetros(supabaseAdmin, [data as RetroRow])
    return NextResponse.json({ item })
  } catch (e) {
    return handleRouteError(e, '성장 회고 등록 실패')
  }
}
