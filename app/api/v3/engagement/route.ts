import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api/error-response'
import {
  average,
  bucketizeEngagement,
  commentRatePct,
  engagementRatePct,
  isoDaysAgo,
  likeRatePct,
  pctChange,
  type VideoLite
} from '@/lib/v3/engagement'
import { authenticate, loadScopedVideos, loadStaffUsers } from '@/lib/v3/server'

const num = new Intl.NumberFormat('ko-KR')

// 참여도 대시보드
//   참여율(%)      = (좋아요 + 댓글) / 조회수 × 100
//   댓글 참여율(%) = 댓글 / 조회수 × 100
// V4의 "좋아요율" 성장 KPI와는 다른, 댓글 활발도 중심의 지표를 함께 계산한다.
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const staffId = new URL(request.url).searchParams.get('staffId')
    const videos = await loadScopedVideos(supabaseAdmin, {
      isAdmin,
      selfUserId: profile.id,
      staffId: isAdmin ? staffId : null,
      limit: 1500
    })

    const withViews = videos.filter((v) => Number(v.view_count || 0) > 0)
    const engagementRates = withViews.map((v) => engagementRatePct(v)!).filter((v) => v !== null)
    const commentRates = withViews.map((v) => commentRatePct(v)!).filter((v) => v !== null)

    const avgEngagementPct = average(engagementRates)
    const avgCommentRatePct = average(commentRates)

    const distribution = bucketizeEngagement(engagementRates)

    // 좋아요 vs 댓글 참여 지형도: 각 영상의 좋아요율/댓글율을 관측된 최댓값 대비 0~100 위치로 정규화
    const maxLike = Math.max(...withViews.map((v) => likeRatePct(v) || 0), 0.5)
    const maxComment = Math.max(...withViews.map((v) => commentRatePct(v) || 0), 0.2)
    const scatter = withViews.slice(0, 400).map((v) => {
      const like = likeRatePct(v) || 0
      const comment = commentRatePct(v) || 0
      return {
        id: v.id,
        label: v.title || v.stock_name || '(제목 없음)',
        sub: `좋아요율 ${like.toFixed(2)}% · 댓글율 ${comment.toFixed(3)}%`,
        x: (like / maxLike) * 100,
        y: (comment / maxComment) * 100,
        tone: comment / maxComment > like / maxLike ? 'violet' : 'blue'
      }
    })

    // 댓글이 유독 활발한 영상 Top 5 (최소 조회수 100 이상, 노이즈 배제)
    const topComment = withViews
      .filter((v) => Number(v.view_count || 0) >= 100)
      .map((v) => ({ video: v, ratio: commentRatePct(v) || 0 }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5)
      .map((row) => ({
        id: row.video.id,
        label: row.video.title || row.video.stock_name || '(제목 없음)',
        sub: row.video.stock_name || undefined,
        value: row.ratio,
        youtubeUrl: row.video.youtube_url
      }))

    // 이번 주 vs 지난 주(등록일 기준) 참여율 비교
    const since7 = isoDaysAgo(7)
    const since14 = isoDaysAgo(14)
    const thisWeek = videos.filter((v) => v.created_at >= since7)
    const lastWeek = videos.filter((v) => v.created_at >= since14 && v.created_at < since7)
    const thisWeekRates = thisWeek.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)
    const lastWeekRates = lastWeek.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)
    const thisWeekAvg = average(thisWeekRates)
    const lastWeekAvg = average(lastWeekRates)
    const weekChange = lastWeek.length > 0 ? pctChange(thisWeekAvg, lastWeekAvg) : null

    const summaryParts = [
      `이번 주 등록 영상(${thisWeek.length}개) 평균 참여율은 ${thisWeekAvg.toFixed(2)}%` +
        (weekChange === null ? '' : `이며, 지난 주(${lastWeekAvg.toFixed(2)}%) 대비 ${weekChange >= 0 ? '+' : ''}${weekChange.toFixed(1)}%`) +
        '입니다',
      topComment[0] ? `댓글이 가장 활발한 영상은 "${topComment[0].label}"(댓글율 ${topComment[0].value.toFixed(2)}%)입니다` : '아직 댓글 비율을 계산할 영상이 없습니다'
    ]

    const staffOptions = isAdmin ? (await loadStaffUsers(supabaseAdmin)).map((s) => ({ id: s.id, name: s.name })) : []

    return NextResponse.json({
      sample: false,
      summary: summaryParts.join('. ') + '.',
      videoCount: withViews.length,
      // 이번 주/지난 주에 "조회수가 있어 참여율을 계산할 수 있는" 영상 수 (빈 주 안내용)
      weekCounts: { thisWeek: thisWeekRates.length, lastWeek: lastWeekRates.length },
      kpis: {
        avgEngagementPct: { current: avgEngagementPct },
        avgCommentRatePct: { current: avgCommentRatePct },
        thisWeekAvgEngagementPct: { current: thisWeekAvg, previous: lastWeek.length > 0 ? lastWeekAvg : undefined }
      },
      distribution,
      scatter,
      topComment,
      staffOptions,
      staffIdFilter: staffId || null
    })
  } catch (e) {
    return errorResponse(e, '참여도 대시보드 조회에 실패했습니다.')
  }
}
