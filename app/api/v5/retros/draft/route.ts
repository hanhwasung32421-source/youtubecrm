import { getKstDayEndIso, getKstDayStartIso } from '@/lib/attendance/time'
import { isoWeekRangeYmd } from '@/lib/v5/format'
import { prevWeekLabel, weekStatsFromVideos, type DraftVideo, type RetroDraftData } from '@/lib/v5/retro-draft'
import { V5_TABLES } from '@/lib/v5/tables'
import { badRequest, fetchAllPages, forbidden, getSession, handleRouteError, jsonNoStore, loadUserMap } from '@/lib/v5/api'

// 주간 회고 "자동 초안"의 재료: 그 주와 바로 앞 주에 등록한 영상 수·조회수 합계·가장 잘 나간 영상.
// GET /api/v5/retros/draft?week=2026-W38 (관리자 전용, 저장하지 않는 읽기 전용)
export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin } = session

    const week = new URL(request.url).searchParams.get('week') || ''
    const range = isoWeekRangeYmd(week)
    const previousWeek = prevWeekLabel(week)
    const prevRange = previousWeek ? isoWeekRangeYmd(previousWeek) : null
    if (!range || !prevRange || !previousWeek) return badRequest('주차 형식이 올바르지 않아요.')

    // 앞 주 월요일 0시 ~ 그 주 일요일 24시(한국 시간)를 한 번에 읽고 나눈다.
    const startIso = getKstDayStartIso(prevRange.start)
    const endIso = getKstDayEndIso(range.end)
    const { rows, truncated } = await fetchAllPages<Omit<DraftVideo, 'owner_name'> & { primary_owner_user_id: string | null }>(
      (from, to, withCount) =>
        supabaseAdmin
          .from(V5_TABLES.videos)
          .select('id, title, stock_name, view_count, created_at, last_synced_at, primary_owner_user_id', withCount ? { count: 'exact' } : undefined)
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as any,
      { maxPages: 10 }
    )

    const current = weekStatsFromVideos(rows, range.start, range.end)
    const previous = weekStatsFromVideos(rows, prevRange.start, prevRange.end)
    // 가장 잘 나간 영상의 담당자 이름만 붙인다.
    if (current.best) {
      const bestRow = rows.find((r) => r.id === current.best!.id)
      const names = await loadUserMap(supabaseAdmin, [bestRow?.primary_owner_user_id])
      current.best.owner_name = bestRow?.primary_owner_user_id ? names.get(bestRow.primary_owner_user_id) || null : null
    }

    const draft: RetroDraftData = { week, weekStart: range.start, weekEnd: range.end, previousWeek, current, previous, ...(truncated ? { truncated: true } : {}) }
    return jsonNoStore({ draft })
  } catch (e) {
    return handleRouteError(e, '이번 주 숫자를 모으지 못했어요.')
  }
}
