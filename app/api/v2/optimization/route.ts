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
import type { OptimizationPayload, OptimizationRow } from '@/lib/v2/types'

// 제목·썸네일 최적화 보드: 관리자는 전체, 직원은 본인 영상만. "개선 필요" 점수가 높은 순.
export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)

    const videos = await loadVideos(supabaseAdmin, { userId: profile.id, isAdmin }, 300)
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
      let improvementScore = 0
      if (!titleLengthOk) improvementScore += 1
      if (!titleHasStock) improvementScore += 1
      if (!hasDescription) improvementScore += 1
      if (!latestReview || latestReview.rating < 3) improvementScore += 1
      return {
        video: { ...video, owner_name: staffMap?.get(video.primary_owner_user_id) || null },
        titleLength,
        titleLengthOk,
        titleHasStock,
        hasDescription,
        checklist,
        latestReview,
        improvementScore
      }
    })

    items.sort((a, b) => b.improvementScore - a.improvementScore || (a.video.created_at < b.video.created_at ? 1 : -1))

    const payload: OptimizationPayload = { items }
    return NextResponse.json(payload)
  } catch (e) {
    return handleRouteError(e, '최적화 보드 조회 실패')
  }
}
