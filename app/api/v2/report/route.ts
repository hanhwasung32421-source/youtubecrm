import {
  cachedJson,
  checklistFor,
  computeDiscoverability,
  handleRouteError,
  isMissingTableError,
  loadChecklistMap,
  loadStaffMap,
  loadVideos,
  missingTableResponse,
  requireV2Admin,
  slimVideo
} from '@/lib/v2/server'
import type { DiscoverabilityRow, ReportPayload } from '@/lib/v2/types'

// 기간(7일·30일)을 화면에서 나누므로, 하루 60~90개 기준 30일 치(약 2,700개)가 들어오도록 3,000개까지 받는다.
const REPORT_LIMIT = 3000
// 점수 계산과 순위 표에 쓰는 칸만 읽는다 (설명·썸네일 주소 등 긴 값은 읽지 않는다).
const COLUMNS = 'id, title, stock_name, content_type, youtube_url, published_at, view_count, like_count, primary_owner_user_id, created_at'

// 검색 성과 리포트: 영상별 발견성 점수(조회 속도 40% + 좋아요율 30% + SEO 체크리스트 완료율 30%) 리더보드
export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin } = await requireV2Admin(request)

    const videos = await loadVideos(supabaseAdmin, { userId: profile.id, isAdmin: true }, REPORT_LIMIT, COLUMNS)
    const videoIds = videos.map((v) => v.id)

    // 체크리스트와 담당자 이름은 서로 기다릴 필요가 없어 한꺼번에 조회한다.
    let checklistMap
    let staffMap: Map<string, string>
    try {
      ;[checklistMap, staffMap] = await Promise.all([loadChecklistMap(supabaseAdmin, videoIds), loadStaffMap(supabaseAdmin)])
    } catch (e) {
      if (isMissingTableError(e)) return missingTableResponse()
      throw e
    }

    const items: DiscoverabilityRow[] = videos
      .map((video) => {
        const checklist = checklistFor(video.id, checklistMap)
        const metrics = computeDiscoverability(video, checklist)
        return { video: slimVideo(video), ownerName: staffMap.get(video.primary_owner_user_id) || '-', ...metrics }
      })
      .sort((a, b) => b.score - a.score)

    const payload: ReportPayload = { items, capped: videos.length >= REPORT_LIMIT }
    return cachedJson(payload)
  } catch (e) {
    return handleRouteError(e, '성과 요약을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
}
