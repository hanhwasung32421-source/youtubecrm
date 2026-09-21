import { NextResponse } from 'next/server'
import { STAFF_COLUMNS, computeKpis, computeStaffStats, getPeriodRange, parsePeriod } from '@/lib/v4/analytics'
import { loadUsers, loadVideos, requireV4Admin, v4ErrorResponse } from '@/lib/v4/server'

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireV4Admin(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))

    const [videos, { staff, map: userMap }] = await Promise.all([
      loadVideos(supabaseAdmin, { startIso: range.startIso, endIso: range.endIso, columns: STAFF_COLUMNS }),
      loadUsers(supabaseAdmin)
    ])

    // 활동 직원 + (퇴사/비활성이라도) 기간 내 영상을 가진 사람은 비교 대상에 포함
    const staffIds = new Set(staff.map((s) => s.id))
    const extra = Array.from(new Set(videos.map((v) => v.primary_owner_user_id)))
      .filter((id): id is string => Boolean(id) && !staffIds.has(id as string))
      .map((id) => userMap.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u) && u!.role_type !== 'super_admin' && u!.role_type !== 'admin')

    const rows = computeStaffStats(videos, [...staff, ...extra], range.endYmd)
    const team = computeKpis(videos)

    return NextResponse.json({
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      rows,
      team
    })
  } catch (e) {
    return v4ErrorResponse(e, '담당자 성과 비교 조회 실패')
  }
}
