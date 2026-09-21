import {
  average,
  bucketizeEngagement,
  buildScatter,
  commentRatePct,
  engagementRatePct,
  isoDaysAgo,
  likeRatePct,
  timeMs
} from '@/lib/v3/engagement'
import { VIDEO_FIELDS_RATES, apiError, authenticate, cachedJson, isUuid, loadScopedVideos, loadStaffUsers } from '@/lib/v3/server'

// 한 번에 읽는 영상 수의 한도(최근 등록 순). 이보다 오래된 영상은 계산에서 빠지므로, 꽉 찼을 때는 truncated 로 알려 준다.
const LOAD_LIMIT = 4000
// 순위표: 정렬 기준마다 상위 RANK_LIMIT 개씩 보낸다(화면에서 정렬을 바꿔도 각 기준의 진짜 상위가 보이도록).
const RANK_LIMIT = 300
// 순위에 넣는 최소 조회수(조회수가 너무 적으면 비율이 들쭉날쭉해서 노이즈)
const RANK_MIN_VIEWS = 100

// 참여도 대시보드
//   참여율(%)      = (좋아요 + 댓글) / 조회수 × 100
//   댓글 참여율(%) = 댓글 / 조회수 × 100
// 선택 조건(모두 생략 가능): ?staffId=(관리자만) &format=longform|shortform &days=7|30|90 (등록일 기준. 없으면 전체 기간)
// 이번 주/지난 주 비교는 기간 조건과 상관없이 늘 최근 2주를 본다.
// 모든 비율은 % 단위(0~100)다. (0~1 이 아니다)
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const params = new URL(request.url).searchParams
    const staffParam = params.get('staffId')
    const staffId = isAdmin && isUuid(staffParam) ? staffParam : null
    const formatParam = params.get('format')
    const format = formatParam === 'longform' || formatParam === 'shortform' ? formatParam : null
    const daysParam = Number(params.get('days'))
    const days = [7, 30, 90].includes(daysParam) ? daysParam : 0
    // 영상과 직원 목록은 서로 기다릴 필요가 없어 동시에 받는다.
    const [allScoped, staff] = await Promise.all([
      loadScopedVideos(supabaseAdmin, {
        isAdmin,
        selfUserId: profile.id,
        staffId,
        limit: LOAD_LIMIT,
        fields: VIDEO_FIELDS_RATES
      }),
      isAdmin ? loadStaffUsers(supabaseAdmin) : Promise.resolve([])
    ])

    // 형식 조건은 모든 계산에 걸고, 기간 조건은 분포·평균·순위에만 건다(주간 비교는 늘 최근 2주).
    const videos = format ? allScoped.filter((v) => v.content_type === format) : allScoped
    const now = new Date()
    const periodSince = days > 0 ? timeMs(isoDaysAgo(days, now)) : null
    const periodVideos = periodSince === null ? videos : videos.filter((v) => timeMs(v.created_at) >= periodSince)
    const withViews = periodVideos.filter((v) => Number(v.view_count || 0) > 0)
    const engagementRates = withViews.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)
    const commentRates = withViews.map((v) => commentRatePct(v)).filter((v): v is number => v !== null)

    const avgEngagementPct = average(engagementRates)
    const avgCommentRatePct = average(commentRates)

    const distribution = bucketizeEngagement(engagementRates)

    // 좋아요 vs 댓글 참여 지형도: 실제 비율(like/comment, %)과 색·모양을 정하는 tone 만 준다. (위치는 화면이 계산한다)
    const scatter = buildScatter(withViews, 400).map((p) => ({ id: p.id, label: p.label, like: p.like, comment: p.comment, tone: p.tone }))

    // 영상별 순위표 재료: 조회수 100회 이상 영상. 정렬 기준(댓글·전체 반응·조회수·최근)마다 상위 RANK_LIMIT 개의 합집합을 보낸다.
    const rankable = withViews
      .filter((v) => Number(v.view_count || 0) >= RANK_MIN_VIEWS)
      .map((v) => ({
        id: v.id,
        title: v.title || v.stock_name || '(제목 없음)',
        stockName: v.stock_name,
        contentType: v.content_type,
        viewCount: Number(v.view_count || 0),
        likeRatePct: likeRatePct(v) || 0,
        commentRatePct: commentRatePct(v) || 0,
        engagementPct: engagementRatePct(v) || 0,
        publishedAt: v.published_at || v.created_at,
        youtubeUrl: v.youtube_url
      }))
    const keep = new Set<string>()
    const top = (pick: (r: (typeof rankable)[number]) => number) => {
      for (const row of [...rankable].sort((a, b) => pick(b) - pick(a)).slice(0, RANK_LIMIT)) keep.add(row.id)
    }
    top((r) => r.commentRatePct)
    top((r) => r.engagementPct)
    top((r) => r.viewCount)
    top((r) => timeMs(r.publishedAt) || 0)
    const videoRows = rankable.filter((r) => keep.has(r.id))
    const topComment = [...rankable]
      .sort((a, b) => b.commentRatePct - a.commentRatePct)
      .slice(0, 5)
      .map((row) => ({ id: row.id, label: row.title, sub: row.stockName || undefined, value: row.commentRatePct, viewCount: row.viewCount, youtubeUrl: row.youtubeUrl }))

    // 이번 주 vs 지난 주(등록일 기준) 참여율 비교. 시각은 문자열이 아니라 밀리초로 비교한다.
    const since7 = timeMs(isoDaysAgo(7, now))
    const since14 = timeMs(isoDaysAgo(14, now))
    const thisWeekRates = videos.filter((v) => timeMs(v.created_at) >= since7).map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)
    const lastWeekRates = videos
      .filter((v) => {
        const t = timeMs(v.created_at)
        return t >= since14 && t < since7
      })
      .map((v) => engagementRatePct(v))
      .filter((v): v is number => v !== null)
    const thisWeekAvg = average(thisWeekRates)
    const lastWeekAvg = average(lastWeekRates)

    return cachedJson({
      // 조회수가 있어 참여율을 계산한 영상 수(기간 조건 적용)
      videoCount: withViews.length,
      // 이번 주/지난 주에 "조회수가 있어 참여율을 계산할 수 있는" 영상 수 (빈 주 안내용)
      weekCounts: { thisWeek: thisWeekRates.length, lastWeek: lastWeekRates.length },
      kpis: {
        avgEngagementPct: { current: avgEngagementPct },
        avgCommentRatePct: { current: avgCommentRatePct },
        // 지난주 값은 지난주에 계산 가능한 영상이 있을 때만 준다.
        thisWeekAvgEngagementPct: { current: thisWeekAvg, previous: lastWeekRates.length > 0 ? lastWeekAvg : undefined }
      },
      distribution,
      scatter,
      topComment,
      videoRows,
      rankLimit: RANK_LIMIT,
      // 영상이 한도(LOAD_LIMIT)를 넘어서 오래된 영상이 계산에서 빠졌다
      truncated: allScoped.length >= LOAD_LIMIT,
      loadedCount: allScoped.length,
      staffOptions: staff.map((s) => ({ id: s.id, name: s.name }))
    })
  } catch (e) {
    return apiError(e, '참여 현황을 불러오지 못했어요.')
  }
}
