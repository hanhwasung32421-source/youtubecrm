import { aggregateStocks, getPeriodRange, parsePeriod } from '@/lib/v4/analytics'
import { cachedJson } from '@/lib/v4/http'
import { loadPeriodRows } from '@/lib/v4/period-rows'
import { requireV4User, splitByIso, v4ErrorResponse } from '@/lib/v4/server'

export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await requireV4User(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))
    const recent30 = getPeriodRange(30)
    const ownerId = isAdmin ? null : profile.id

    // 현재 기간 + 직전 기간(전기 대비 추세) + 최근 30일(Top5)을 한 번에 읽고(1000행씩 끝까지) JS에서 나눈다.
    // 같은 기간을 이미 읽은 다른 화면(랭킹·타이밍 등)이 있으면 15초 동안 그 결과를 함께 쓴다.
    const windowStartIso = new Date(range.prevStartIso) < new Date(recent30.startIso) ? range.prevStartIso : recent30.startIso
    const windowVideos = await loadPeriodRows(supabaseAdmin, { startIso: windowStartIso, endIso: range.endIso, ownerId })
    const { current, before } = splitByIso(windowVideos, range.startIso)
    const previous = before.filter((v) => new Date(v.created_at).getTime() >= new Date(range.prevStartIso).getTime())
    const recentVideos = splitByIso(windowVideos, recent30.startIso).current

    const items = aggregateStocks(current, previous)
    const top5Recent = aggregateStocks(recentVideos, [])
      .filter((s) => s.totalViews > 0)
      .sort((a, b) => b.avgViews - a.avgViews || b.totalViews - a.totalViews)
      .slice(0, 5)
      .map(({ stockName, videoCount, totalViews, avgViews }) => ({ stockName, videoCount, totalViews, avgViews }))

    return cachedJson({
      scope: isAdmin ? 'admin' : 'staff',
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      previousRange: { start: range.prevStartYmd, end: range.prevEndYmd },
      items,
      top5Recent,
      totals: {
        stockCount: items.length,
        videoCount: current.length
      }
    })
  } catch (e) {
    return v4ErrorResponse(e, '종목 트렌드 조회 실패')
  }
}
