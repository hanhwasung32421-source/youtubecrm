import { NextResponse } from 'next/server'
import { TIMING_COLUMNS, computeTimingHeatmap, getPeriodRange, parsePeriod } from '@/lib/v4/analytics'
import { loadVideos, requireV4User, v4ErrorResponse } from '@/lib/v4/server'

export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await requireV4User(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))
    const ownerId = isAdmin ? null : profile.id

    const videos = await loadVideos(supabaseAdmin, { startIso: range.startIso, endIso: range.endIso, ownerId, columns: TIMING_COLUMNS })
    const { cells, recommendations, maxCount, maxAvg } = computeTimingHeatmap(videos)

    return NextResponse.json({
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
    return v4ErrorResponse(e, '업로드 타이밍 분석 조회 실패')
  }
}
