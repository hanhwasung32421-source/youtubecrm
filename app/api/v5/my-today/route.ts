import { NextResponse } from 'next/server'
import { getKstDayEndIso, getKstDayStartIso, getKstYmd } from '@/lib/attendance/time'
import { V5_TABLES } from '@/lib/v5/tables'
import { getSession, handleRouteError } from '@/lib/v5/api'

// 오늘(한국 시간 기준) 내가 등록한 영상 수. 브라우저가 아니라 서버 기준 숫자라서
// 새로고침하거나 다른 기기에서 열어도 같은 값이 나온다.
// 관리자에게는 팀 전체 오늘 등록 수(teamCount)도 함께 준다.
export async function GET(request: Request) {
  try {
    const { supabaseAdmin, profile, isAdmin } = await getSession(request)
    const dateKst = getKstYmd()
    const startIso = getKstDayStartIso(dateKst)
    const endIso = getKstDayEndIso(dateKst)

    const { count, error } = await supabaseAdmin
      .from(V5_TABLES.videos)
      .select('id', { count: 'exact', head: true })
      .eq('primary_owner_user_id', profile.id)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
    if (error) throw error

    let teamCount: number | undefined
    if (isAdmin) {
      const team = await supabaseAdmin
        .from(V5_TABLES.videos)
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startIso)
        .lte('created_at', endIso)
      if (!team.error) teamCount = team.count || 0
    }

    return NextResponse.json({ count: count || 0, dateKst, ...(teamCount !== undefined ? { teamCount } : {}) })
  } catch (e) {
    return handleRouteError(e, '오늘 등록 수 조회 실패')
  }
}
