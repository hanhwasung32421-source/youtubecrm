import { aggregateStocks, getPeriodRange, parsePeriod } from '@/lib/v4/analytics'
import { cachedJson } from '@/lib/v4/http'
import { loadPeriodRows } from '@/lib/v4/period-rows'
import { requireV4User, splitByIso, v4ErrorResponse } from '@/lib/v4/server'

// GET /api/v4/stocks?period=  — 종목별 영상 수·조회수와 직전 같은 길이 기간 대비 변화.
// 관리자는 팀 전체, 직원은 본인 영상만 계산한다.
export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await requireV4User(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))
    const ownerId = isAdmin ? null : profile.id

    // 현재 기간 + 직전 기간(전기 대비 추세)을 한 번에 읽고(1000행씩 끝까지) JS에서 나눈다.
    // 같은 기간을 이미 읽은 다른 화면(랭킹·타이밍 등)이 있으면 잠깐 그 결과를 함께 쓴다.
    const windowVideos = await loadPeriodRows(supabaseAdmin, { startIso: range.prevStartIso, endIso: range.endIso, ownerId })
    const { current, before } = splitByIso(windowVideos, range.startIso)

    const items = aggregateStocks(current, before)

    return cachedJson({
      scope: isAdmin ? 'admin' : 'staff',
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      previousRange: { start: range.prevStartYmd, end: range.prevEndYmd },
      items,
      totals: {
        stockCount: items.length,
        videoCount: current.length
      }
    })
  } catch (e) {
    return v4ErrorResponse(e, '종목 정보를 불러오지 못했어요')
  }
}
