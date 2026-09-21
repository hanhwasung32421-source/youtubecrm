import { getKstDayStartIso } from '@/lib/attendance/time'
import { computeDailySeries, computeKpis, getPeriodRange, num, parsePeriod, rankVideos } from '@/lib/v4/analytics'
import { cachedJson } from '@/lib/v4/http'
import { loadPeriodRows, loadUsersShared } from '@/lib/v4/period-rows'
import { getSampleGoal } from '@/lib/v4/sample-data'
import { dbError, loadVideos, requireV4User, splitByIso, v4ErrorResponse } from '@/lib/v4/server'
import { DAILY_TARGET } from '@/lib/v4/staff-today'
import { V4_TABLES, isMissingTableError } from '@/lib/v4/tables'

export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await requireV4User(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))
    const ownerId = isAdmin ? null : profile.id
    const month = range.endYmd.slice(0, 7)
    const monthStartIso = getKstDayStartIso(`${month}-01`)

    // 선택 기간 + 직전 같은 길이 기간 + 이번 달 을 한 번에(1000행씩 나눠 끝까지) 읽고 JS 에서 나눈다.
    // 90일 화면이면 약 12,000행이므로, 기본 1000행 제한에 걸려 합계가 줄어드는 일이 없어야 한다.
    const windowStartIso = new Date(range.prevStartIso) < new Date(monthStartIso) ? range.prevStartIso : monthStartIso
    const [windowRows, feedVideos, { map: userMap, staff }, syncRow, goalResult] = await Promise.all([
      // 랭킹·종목 등 다른 분석 화면과 같은 기간 읽기를 잠깐(5초) 함께 쓴다.
      loadPeriodRows(supabaseAdmin, { startIso: windowStartIso, endIso: range.endIso, ownerId }),
      loadVideos(supabaseAdmin, { ownerId, limit: 20 }),
      loadUsersShared(supabaseAdmin),
      (async () => {
        let q = supabaseAdmin
          .from(V4_TABLES.videos)
          .select('last_synced_at')
          .not('last_synced_at', 'is', null)
          .order('last_synced_at', { ascending: false })
          .limit(1)
        if (ownerId) q = q.eq('primary_owner_user_id', ownerId)
        const { data, error } = await q
        if (error) throw dbError(error)
        return (data?.[0]?.last_synced_at as string | undefined) || null
      })(),
      supabaseAdmin
        .from(V4_TABLES.growthGoals)
        .select('id, month, user_id, target_videos, target_views')
        .eq('month', month)
    ])

    const videos = splitByIso(windowRows, range.startIso).current
    const previousVideos = windowRows.filter((v) => {
      const t = new Date(v.created_at).getTime()
      return t >= new Date(range.prevStartIso).getTime() && t <= new Date(range.prevEndIso).getTime()
    })
    const monthVideos = splitByIso(windowRows, monthStartIso).current

    const staffCount = staff.length
    const kpis = computeKpis(videos)
    const previousKpis = computeKpis(previousVideos)
    const daily = computeDailySeries(videos, range.startYmd, range.endYmd)
    const feed = rankVideos(feedVideos, userMap).map((v) => ({
      id: v.id,
      title: v.title,
      stockName: v.stockName,
      ownerName: v.ownerName,
      contentType: v.contentType,
      viewCount: v.viewCount,
      createdAt: v.createdAt,
      thumbnailUrl: v.thumbnailUrl,
      youtubeUrl: v.youtubeUrl
    }))

    // 목표 대비: 팀 목표(user_id null) / 개인 목표 / 팀 목표를 인원수로 나눈 환산값
    let sample = false
    let goalRows: Array<{ user_id: string | null; target_videos: number; target_views: number }> = []
    if (goalResult.error) {
      if (!isMissingTableError(goalResult.error)) throw dbError(goalResult.error)
      sample = true
      const sampleGoal = getSampleGoal(month, staffCount)
      goalRows = [{ user_id: null, target_videos: sampleGoal.targetVideos, target_views: sampleGoal.targetViews }]
    } else {
      goalRows = (goalResult.data || []) as typeof goalRows
    }
    const teamGoal = goalRows.find((g) => g.user_id === null) || null
    const ownGoal = goalRows.find((g) => g.user_id === profile.id) || null
    let scope: 'team' | 'user' | 'derived' | 'none' = 'none'
    let targetVideos = 0
    let targetViews = 0
    if (isAdmin) {
      if (teamGoal) {
        scope = 'team'
        targetVideos = num(teamGoal.target_videos)
        targetViews = num(teamGoal.target_views)
      }
    } else if (ownGoal) {
      scope = 'user'
      targetVideos = num(ownGoal.target_videos)
      targetViews = num(ownGoal.target_views)
    } else if (teamGoal) {
      scope = 'derived'
      const divisor = Math.max(staffCount, 1)
      targetVideos = Math.round(num(teamGoal.target_videos) / divisor)
      targetViews = Math.round(num(teamGoal.target_views) / divisor)
    }
    const actualVideos = monthVideos.length
    const actualViews = monthVideos.reduce((sum, v) => sum + num(v.view_count), 0)

    // 통계 새로고침·목표 저장 직후 화면을 다시 불러오면 새 숫자가 바로 보여야 해서, 브라우저에는 저장하지 않는다.
    return cachedJson({
      scope: isAdmin ? 'admin' : 'staff',
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      previousRange: { start: range.prevStartYmd, end: range.prevEndYmd },
      staffCount,
      targetPerDay: (isAdmin ? Math.max(staffCount, 1) : 1) * DAILY_TARGET,
      kpis,
      previousKpis,
      daily,
      feed,
      lastSyncedAt: syncRow,
      goal: {
        month,
        scope,
        targetVideos,
        targetViews,
        actualVideos,
        actualViews,
        teamGoal: teamGoal ? { targetVideos: num(teamGoal.target_videos), targetViews: num(teamGoal.target_views) } : null,
        sample
      }
    })
  } catch (e) {
    return v4ErrorResponse(e, '성장 현황을 불러오지 못했어요')
  }
}
