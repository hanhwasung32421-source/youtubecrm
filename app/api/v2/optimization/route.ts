import { NextResponse } from 'next/server'
import {
  authedContext,
  cachedJson,
  checklistFor,
  handleRouteError,
  isMissingTableError,
  loadChecklistMap,
  loadLatestReviewMap,
  loadStaffMap,
  loadVideos,
  slimVideo
} from '@/lib/v2/server'
import { sampleOptimizationPayload } from '@/lib/v2/sample-data'
import { improvementScoreOf, type OptimizationPayload, type OptimizationRow } from '@/lib/v2/types'

const VIDEO_LIMIT = 600
// 화면이 쓰는 칸만 읽는다. description 은 "비어 있는지"만 필요해서 읽은 뒤 응답에서는 뺀다.
const COLUMNS = 'id, title, description, stock_name, content_type, youtube_url, published_at, view_count, primary_owner_user_id, created_at'

// 제목·썸네일 최적화 보드: 관리자는 전체, 직원은 본인 영상만. "개선 필요" 점수가 높은 순.
export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)

    const videos = await loadVideos(supabaseAdmin, { userId: profile.id, isAdmin }, VIDEO_LIMIT, COLUMNS)
    const videoIds = videos.map((v) => v.id)

    // 세 조회는 서로 기다릴 필요가 없어 한꺼번에 보낸다.
    let checklistMap
    let reviewMap
    let staffMap: Map<string, string> | null = null
    try {
      ;[checklistMap, reviewMap, staffMap] = await Promise.all([
        loadChecklistMap(supabaseAdmin, videoIds),
        loadLatestReviewMap(supabaseAdmin, videoIds),
        isAdmin ? loadStaffMap(supabaseAdmin) : Promise.resolve(null)
      ])
    } catch (e) {
      if (isMissingTableError(e)) return NextResponse.json(sampleOptimizationPayload())
      throw e
    }

    const items: OptimizationRow[] = videos.map((video) => {
      const titleLength = (video.title || '').length
      const titleLengthOk = titleLength > 0 && titleLength <= 60
      const titleHasStock = Boolean(video.title && video.title.includes(video.stock_name))
      const hasDescription = Boolean(video.description && video.description.trim().length > 0)
      const checklist = checklistFor(video.id, checklistMap)
      const latestReview = reviewMap.get(video.id) || null
      return {
        video: slimVideo(video, { owner_name: staffMap?.get(video.primary_owner_user_id) || null }),
        titleLength,
        titleLengthOk,
        titleHasStock,
        hasDescription,
        checklist,
        latestReview,
        improvementScore: improvementScoreOf({ titleLengthOk, titleHasStock, hasDescription, latestReview })
      }
    })

    items.sort((a, b) => b.improvementScore - a.improvementScore || (a.video.created_at < b.video.created_at ? 1 : -1))

    const payload: OptimizationPayload = { items, capped: videos.length >= VIDEO_LIMIT }
    return cachedJson(payload)
  } catch (e) {
    return handleRouteError(e, '영상 점검 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
}
