// 주간 회고 — 라우트가 공유하는 select 컬럼 + 검증 + 스냅샷 계산(서버 전용).

import { z } from 'zod'
import { getKstDayEndIso, getKstDayStartIso } from '@/lib/attendance/time'
import { addDays, isoWeekLabel, isoWeekLabelFromYmd, isoWeekRangeYmd } from '@/lib/v5/format'
import type { RetroActionItem, RetroKpiSnapshot, WeeklyRetro } from '@/lib/v5/types'
import { V5_TABLES } from '@/lib/v5/tables'
import { fetchAllPages, loadUserMap, optionalText, type Session } from '@/lib/v5/api'

export const RETRO_SELECT = 'id, week_label, went_well, to_improve, action_items, kpi_snapshot, created_by, created_at'

export type RetroRow = Omit<WeeklyRetro, 'author_name'>

const actionItemSchema = z.object({
  text: z.string().trim().min(1, '할 일을 적어 주세요.').max(300, '할 일은 300자 안으로 적어 주세요.'),
  done: z.boolean().optional().default(false)
})

export const retroCreateSchema = z.object({
  weekLabel: z.string().regex(/^\d{4}-W\d{2}$/, '주차 형식이 올바르지 않아요.').optional(),
  wentWell: optionalText,
  toImprove: optionalText,
  actionItems: z.array(actionItemSchema).max(20, '할 일은 20개까지 적을 수 있어요.').optional().default([])
})

export const retroPatchSchema = z.object({
  wentWell: optionalText,
  toImprove: optionalText,
  actionItems: z.array(actionItemSchema).max(20, '할 일은 20개까지 적을 수 있어요.').optional()
})

// jsonb 는 무엇이든 들어 있을 수 있으니 화면에 내려주기 전에 모양을 맞춘다.
export function normalizeActionItems(value: unknown): RetroActionItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (v && typeof v === 'object' ? { text: String((v as any).text ?? '').trim(), done: Boolean((v as any).done) } : null))
    .filter((v): v is RetroActionItem => Boolean(v && v.text))
}

export async function mapRetros(supabaseAdmin: Session['supabaseAdmin'], rows: RetroRow[]): Promise<WeeklyRetro[]> {
  if (rows.length === 0) return []
  const userMap = await loadUserMap(supabaseAdmin, rows.map((r) => r.created_by))
  return rows.map((r) => ({
    ...r,
    action_items: normalizeActionItems(r.action_items),
    kpi_snapshot: (r.kpi_snapshot && typeof r.kpi_snapshot === 'object' ? r.kpi_snapshot : {}) as RetroKpiSnapshot,
    author_name: r.created_by ? userMap.get(r.created_by) || null : null
  }))
}

// 쓸 수 있는 주: 이번 주와 지난주(월요일 아침에 지난주 회고를 쓰는 경우를 위해).
export function writableWeeks() {
  const thisWeek = isoWeekLabel()
  const range = isoWeekRangeYmd(thisWeek)
  const lastWeek = range ? isoWeekLabelFromYmd(addDays(range.start, -1)) : thisWeek
  return { thisWeek, lastWeek }
}

// 그 주(월~일, 한국 시간)에 등록된 영상 기준 스냅샷. 저장 시점에 굳어져서 이후 영상이
// 삭제/변경돼도 회고 히스토리가 흔들리지 않는다. 조회 실패는 0으로 굳히지 않고 오류로 올린다.
export async function pullKpiSnapshot(supabaseAdmin: Session['supabaseAdmin'], weekLabel: string): Promise<RetroKpiSnapshot> {
  const range = isoWeekRangeYmd(weekLabel)
  if (!range) throw new Error('주차 형식 오류')
  const startIso = getKstDayStartIso(range.start)
  const endIso = getKstDayEndIso(range.end)

  const { rows, total, truncated } = await fetchAllPages<{ view_count: number | null; like_count: number | null; comment_count: number | null; last_synced_at: string | null }>(
    (from, to, withCount) =>
      supabaseAdmin
        .from(V5_TABLES.videos)
        .select('view_count, like_count, comment_count, last_synced_at', withCount ? { count: 'exact' } : undefined)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as any,
    { maxPages: 10 }
  )

  let totalViews = 0
  let totalLikes = 0
  let totalComments = 0
  let unsynced = 0
  for (const r of rows) {
    totalViews += Number(r.view_count) || 0
    totalLikes += Number(r.like_count) || 0
    totalComments += Number(r.comment_count) || 0
    if (!r.last_synced_at) unsynced += 1
  }
  // 합계가 잘리지 않았다면 total === rows.length. 잘렸을 때만 실제 영상 수를 따로 남긴다.
  const totalVideos = Math.max(total, rows.length)
  return {
    totalViews,
    totalVideos,
    avgViewsPerVideo: rows.length > 0 ? Math.round(totalViews / rows.length) : 0,
    totalLikes,
    totalComments,
    weekStart: range.start,
    weekEnd: range.end,
    capturedAt: new Date().toISOString(),
    unsyncedVideos: unsynced,
    ...(truncated ? { truncated: true } : {})
  }
}
