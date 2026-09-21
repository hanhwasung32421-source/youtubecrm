import { NextResponse } from 'next/server'
import { addDays, kstDayStart, kstYmd } from '@/lib/v2/dates'
import { checklistFor, computeDiscoverability, handleRouteError, isMissingTableError, loadChecklistMap, loadStaffMap, loadVideos, requireV2Admin } from '@/lib/v2/server'
import { sampleReportPayload } from '@/lib/v2/sample-data'
import type { DiscoverabilityRow, ReportPayload } from '@/lib/v2/types'

// 검색 성과 리포트: 영상별 발견성 점수(조회 속도 40% + 좋아요율 30% + SEO 체크리스트 완료율 30%) 리더보드
export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin } = await requireV2Admin(request)

    const videos = await loadVideos(supabaseAdmin, { userId: profile.id, isAdmin: true }, 500)
    const videoIds = videos.map((v) => v.id)

    let checklistMap
    try {
      checklistMap = await loadChecklistMap(supabaseAdmin, videoIds)
    } catch (e) {
      if (isMissingTableError(e)) return NextResponse.json(sampleReportPayload())
      throw e
    }

    const staffMap = await loadStaffMap(supabaseAdmin)

    const items: DiscoverabilityRow[] = videos
      .map((video) => {
        const checklist = checklistFor(video.id, checklistMap)
        const metrics = computeDiscoverability(video, checklist)
        return { video, ownerName: staffMap.get(video.primary_owner_user_id) || '-', ...metrics }
      })
      .sort((a, b) => b.score - a.score)

    const sevenDaysAgo = kstDayStart(addDays(kstYmd(), -6)).toISOString()
    const recentItems = items.filter((row) => (row.video.published_at || row.video.created_at) >= sevenDaysAgo)
    const top = recentItems[0] || items[0]

    const insight = top
      ? `이번 주 반응이 가장 좋은 영상은 ${top.ownerName}님의 「${top.video.title || '(제목 없음)'}」 — 하루 평균 ${Math.round(top.viewsPerDay).toLocaleString('ko-KR')}회 조회, 반응 점수 ${top.score}점입니다.`
      : '표시할 영상이 없습니다. 영상을 등록하면 반응 점수가 계산됩니다.'

    const payload: ReportPayload = { items, insight }
    return NextResponse.json(payload)
  } catch (e) {
    return handleRouteError(e, '검색 성과 리포트 조회 실패')
  }
}
