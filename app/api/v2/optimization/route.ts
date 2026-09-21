import { NextResponse } from 'next/server'
import {
  authedContext,
  checklistFor,
  handleRouteError,
  isMissingTableError,
  loadChecklistMap,
  loadLatestReviewMap,
  loadStaffMap,
  loadVideos
} from '@/lib/v2/server'
import { sampleOptimizationPayload } from '@/lib/v2/sample-data'
import { improvementScoreOf, type OptimizationPayload, type OptimizationRow } from '@/lib/v2/types'

const VIDEO_LIMIT = 600

// 제목·썸네일 최적화 보드: 관리자는 전체, 직원은 본인 영상만. "개선 필요" 점수가 높은 순.
export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)

    const videos = await loadVideos(supabaseAdmin, { userId: profile.id, isAdmin }, VIDEO_LIMIT)
    const videoIds = videos.map((v) => v.id)

    let checklistMap
    let reviewMap
    try {
      ;[checklistMap, reviewMap] = await Promise.all([loadChecklistMap(supabaseAdmin, videoIds), loadLatestReviewMap(supabaseAdmin, videoIds)])
    } catch (e) {
      if (isMissingTableError(e)) return NextResponse.json(sampleOptimizationPayload())
      throw e
    }

    const staffMap = isAdmin ? await loadStaffMap(supabaseAdmin) : null

    const items: OptimizationRow[] = videos.map((video) => {
      const titleLength = (video.title || '').length
      const titleLengthOk = titleLength > 0 && titleLength <= 60
      const titleHasStock = Boolean(video.title && video.title.includes(video.stock_name))
      const hasDescription = Boolean(video.description && video.description.trim().length > 0)
      const checklist = checklistFor(video.id, checklistMap)
      const latestReview = reviewMap.get(video.id) || null
      return {
        video: { ...video, owner_name: staffMap?.get(video.primary_owner_user_id) || null },
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
    return NextResponse.json(payload)
  } catch (e) {
    return handleRouteError(e, '영상 점검 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
}
