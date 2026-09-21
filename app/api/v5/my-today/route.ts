import { getKstDayEndIso, getKstDayStartIso, getKstYmd } from '@/lib/attendance/time'
import { V5_TABLES } from '@/lib/v5/tables'
import { getSession, handleRouteError, jsonNoStore } from '@/lib/v5/api'
import { groupStocks } from '@/components/v5/register-logic'

// 오늘(한국 시간 기준) 내가 등록한 영상 수. 브라우저가 아니라 서버 기준 숫자라서
// 새로고침하거나 다른 기기에서 열어도 같은 값이 나온다.
// 관리자에게는 팀 전체 오늘 등록 수(teamCount)도 함께 준다.
// stocks: 오늘 내가 등록한 영상의 종목별 개수(많은 순). 화면의 "오늘 등록한 종목" 목록에 쓴다.
export async function GET(request: Request) {
  try {
    const { supabaseAdmin, profile, isAdmin } = await getSession(request)
    const dateKst = getKstYmd()
    const startIso = getKstDayStartIso(dateKst)
    const endIso = getKstDayEndIso(dateKst)

    // 개수와 함께 종목 이름도 읽어 "오늘 등록한 종목별 개수"를 만든다(하루 10~15개라 가볍다).
    const { data: todayRows, count, error } = await supabaseAdmin
      .from(V5_TABLES.videos)
      .select('stock_name', { count: 'exact' })
      .eq('primary_owner_user_id', profile.id)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: true })
      .limit(500)
    if (error) throw error
    const stocks = groupStocks(((todayRows || []) as Array<{ stock_name: string | null }>).map((r) => r.stock_name))

    let teamCount: number | undefined
    if (isAdmin) {
      const team = await supabaseAdmin
        .from(V5_TABLES.videos)
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startIso)
        .lte('created_at', endIso)
      if (!team.error) teamCount = team.count || 0
    }

    return jsonNoStore({ count: count || 0, dateKst, stocks, ...(teamCount !== undefined ? { teamCount } : {}) })
  } catch (e) {
    return handleRouteError(e, '오늘 등록 수 조회 실패')
  }
}
