import {
  average,
  bucketizeEngagement,
  buildScatter,
  commentRatePct,
  engagementRatePct,
  isoDaysAgo,
  pctChange,
  timeMs
} from '@/lib/v3/engagement'
import { VIDEO_FIELDS_RATES, apiError, authenticate, cachedJson, isUuid, loadScopedVideos, loadStaffUsers } from '@/lib/v3/server'

// 참여도 대시보드
//   참여율(%)      = (좋아요 + 댓글) / 조회수 × 100
//   댓글 참여율(%) = 댓글 / 조회수 × 100
// V4의 "좋아요율" 성장 KPI와는 다른, 댓글 활발도 중심의 지표를 함께 계산한다.
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const staffParam = new URL(request.url).searchParams.get('staffId')
    const staffId = isUuid(staffParam) ? staffParam : null
    // 영상과 직원 목록은 서로 기다릴 필요가 없어 동시에 받는다.
    const [videos, staff] = await Promise.all([
      loadScopedVideos(supabaseAdmin, {
        isAdmin,
        selfUserId: profile.id,
        staffId: isAdmin ? staffId : null,
        limit: 1500,
        fields: VIDEO_FIELDS_RATES
      }),
      isAdmin ? loadStaffUsers(supabaseAdmin) : Promise.resolve([])
    ])

    const withViews = videos.filter((v) => Number(v.view_count || 0) > 0)
    const engagementRates = withViews.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)
    const commentRates = withViews.map((v) => commentRatePct(v)).filter((v): v is number => v !== null)

    const avgEngagementPct = average(engagementRates)
    const avgCommentRatePct = average(commentRates)

    const distribution = bucketizeEngagement(engagementRates)

    // 좋아요 vs 댓글 참여 지형도: 실제 비율(like/comment)과 관측 최댓값 대비 위치(x/y)를 함께 준다.
    const scatter = buildScatter(withViews, 400).map((p) => ({
      id: p.id,
      label: p.label,
      sub: `좋아요율 ${p.like.toFixed(2)}% · 댓글율 ${p.comment.toFixed(3)}%`,
      like: p.like,
      comment: p.comment,
      x: p.x,
      y: p.y,
      tone: p.tone
    }))

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
        viewCount: Number(row.video.view_count || 0),
        youtubeUrl: row.video.youtube_url
      }))

    // 이번 주 vs 지난 주(등록일 기준) 참여율 비교. 시각은 문자열이 아니라 밀리초로 비교한다.
    const now = new Date()
    const since7 = timeMs(isoDaysAgo(7, now))
    const since14 = timeMs(isoDaysAgo(14, now))
    const thisWeek = videos.filter((v) => timeMs(v.created_at) >= since7)
    const lastWeek = videos.filter((v) => {
      const t = timeMs(v.created_at)
      return t >= since14 && t < since7
    })
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

    return cachedJson({
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
      staffOptions: staff.map((s) => ({ id: s.id, name: s.name })),
      staffIdFilter: staffId || null
    })
  } catch (e) {
    return apiError(e, '참여 현황을 불러오지 못했어요.')
  }
}
