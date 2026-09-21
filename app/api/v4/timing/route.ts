import { computeTimingHeatmap, getPeriodRange, parsePeriod } from '@/lib/v4/analytics'
import { cachedJson } from '@/lib/v4/http'
import { loadPeriodRows } from '@/lib/v4/period-rows'
import { requireV4User, v4ErrorResponse } from '@/lib/v4/server'

export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await requireV4User(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))
    const ownerId = isAdmin ? null : profile.id

    const videos = await loadPeriodRows(supabaseAdmin, { startIso: range.startIso, endIso: range.endIso, ownerId })
    const { cells, recommendations, maxCount, maxAvg } = computeTimingHeatmap(videos)

    return cachedJson({
      scope: isAdmin ? 'admin' : 'staff',
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      sampleCount: videos.length,
      cells,
      recommendations,
      maxCount,
      maxAvg
    })
  } catch (e) {
    return v4ErrorResponse(e, '업로드 시간대 분석을 불러오지 못했어요')
  }
}
