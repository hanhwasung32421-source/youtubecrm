import { computeKpis, computeStaffStats, getPeriodRange, parsePeriod } from '@/lib/v4/analytics'
import { cachedJson } from '@/lib/v4/http'
import { loadPeriodRows, loadUsersShared } from '@/lib/v4/period-rows'
import { requireV4Admin, v4ErrorResponse } from '@/lib/v4/server'
import { DAILY_TARGET, countByOwnerOnDay } from '@/lib/v4/staff-today'

// GET /api/v4/staff?period=
// rows[] 의 각 담당자에게 오늘(한국 시간) 등록한 영상 수 todayCount 와 하루 목표 dailyTarget 을 함께 준다. (모두 추가 필드)
// - 기간(7/30/90일)은 항상 오늘까지 포함하므로 이미 읽은 영상 행에서 바로 센다 (DB 를 다시 읽지 않는다).
// - 활동 중인 직원은 dailyTarget = 12, 퇴사·비활성 등 "목표가 없는 사람" 은 0.
export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireV4Admin(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))

    const [videos, { staff, map: userMap }] = await Promise.all([
      loadPeriodRows(supabaseAdmin, { startIso: range.startIso, endIso: range.endIso }),
      loadUsersShared(supabaseAdmin)
    ])

    // 활동 직원 + (퇴사/비활성이라도) 기간 내 영상을 가진 사람은 비교 대상에 포함
    const staffIds = new Set(staff.map((s) => s.id))
    const extra = Array.from(new Set(videos.map((v) => v.primary_owner_user_id)))
      .filter((id): id is string => Boolean(id) && !staffIds.has(id as string))
      .map((id) => userMap.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u) && u!.role_type !== 'super_admin' && u!.role_type !== 'admin')

    const stats = computeStaffStats(videos, [...staff, ...extra], range.endYmd)
    const team = computeKpis(videos)

    // range.endYmd 는 "오늘(한국 시간)" 이다.
    const todayCounts = countByOwnerOnDay(videos, range.endYmd)
    const rows = stats.map((row) => ({
      ...row,
      todayCount: todayCounts.get(row.userId) || 0,
      dailyTarget: staffIds.has(row.userId) ? DAILY_TARGET : 0
    }))

    return cachedJson({
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      rows,
      team,
      todayYmd: range.endYmd,
      dailyTarget: DAILY_TARGET
    })
  } catch (e) {
    return v4ErrorResponse(e, '담당자별 성과를 불러오지 못했어요')
  }
}
