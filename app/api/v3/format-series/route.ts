import { NextResponse } from 'next/server'
import { average, CONTENT_TYPE_LABELS, engagementRatePct, summarizeByFormat, type VideoLite, viewVelocity } from '@/lib/v3/engagement'
import { apiError, authenticate, isMissingTableError, isUuid, loadScopedVideos, loadTeamVideos, loadUserNames, loadVideosByIds } from '@/lib/v3/server'
import { V3_TABLES } from '@/lib/v3/tables'
import { sampleSeriesRows } from '@/lib/v3/sample-data'

const PICKER_LIMIT = 300
const PAGE = 1000

// 형식(롱폼 · 숏폼) 효과 + 시리즈 트래커
//   형식 효율 = 형식별 평균 참여율, 평균 조회 속도 (V4의 형식별 "건수" 비교와는 다른 지표)
//   시리즈 성과 = 시리즈에 속한 영상들의 평균 참여율 · 조회 속도를,
//                같은 종목의 시리즈 밖 영상(baseline)과 비교
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const now = new Date()
    const staffParam = new URL(request.url).searchParams.get('staffId')
    const staffId = isUuid(staffParam) ? staffParam : null

    const [scopedVideos, teamVideos] = await Promise.all([
      loadScopedVideos(supabaseAdmin, { isAdmin, selfUserId: profile.id, staffId: isAdmin ? staffId : null, limit: 1500 }),
      loadTeamVideos(supabaseAdmin, { limit: 3000 })
    ])

    const formatStats = summarizeByFormat(scopedVideos, now)

    const seriesRes = await supabaseAdmin
      .from(V3_TABLES.videoSeries)
      .select('id, name, stock_name, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    let sample = false
    let seriesRows: { id: string; name: string; stock_name: string | null; created_by: string | null; created_at: string }[] = []
    const membersBySeries = new Map<string, string[]>()
    const seriesOfVideo = new Map<string, string>()

    if (seriesRes.error) {
      if (!isMissingTableError(seriesRes.error)) throw seriesRes.error
      sample = true
    } else {
      seriesRows = seriesRes.data || []
      if (seriesRows.length > 0) {
        // 시리즈 수가 적으므로 멤버 전체를 한 번에(1000행씩 이어서) 받는다.
        for (let from = 0; ; from += PAGE) {
          const memberRes = await supabaseAdmin
            .from(V3_TABLES.videoSeriesMembers)
            .select('series_id, video_id')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1)
          if (memberRes.error) {
            if (isMissingTableError(memberRes.error)) break
            throw memberRes.error
          }
          const rows = (memberRes.data || []) as { series_id: string; video_id: string }[]
          for (const row of rows) {
            seriesOfVideo.set(row.video_id, row.series_id)
            const list = membersBySeries.get(row.series_id) || []
            list.push(row.video_id)
            membersBySeries.set(row.series_id, list)
          }
          if (rows.length < PAGE) break
        }
      }
    }

    // 멤버 영상은 최근 3000개 안에 없을 수도 있으니(예전 영상) id 로 따로 가져와 합친다.
    const videoById = new Map(teamVideos.map((v) => [v.id, v]))
    const missingIds = Array.from(seriesOfVideo.keys()).filter((id) => !videoById.has(id))
    if (missingIds.length > 0) {
      for (const v of await loadVideosByIds(supabaseAdmin, missingIds)) videoById.set(v.id, v)
    }

    const names = seriesRows.length > 0 ? await loadUserNames(supabaseAdmin) : new Map<string, string>()
    const seriesNameById = new Map(seriesRows.map((s) => [s.id, s.name]))
    const canEditOf = (createdBy: string | null) => isAdmin || createdBy === profile.id
    const titleOf = (v: VideoLite) => v.title || v.stock_name || '(제목 없음)'

    const series = sample
      ? sampleSeriesRows().map((r) => ({
          id: r.id,
          name: r.name,
          stockName: r.stock_name,
          videoCount: r.video_count,
          avgEngagementPct: r.avg_engagement_pct,
          avgVelocity: r.avg_velocity,
          baselineEngagementPct: r.baseline_engagement_pct,
          baselineVelocity: r.baseline_velocity,
          members: [] as { id: string; title: string }[],
          createdByName: null as string | null,
          canEdit: false
        }))
      : seriesRows.map((s) => {
          const memberIds = membersBySeries.get(s.id) || []
          const memberVideos = memberIds.map((id) => videoById.get(id)).filter((v): v is VideoLite => !!v)
          const engagementRates = memberVideos.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)
          const velocities = memberVideos.map((v) => viewVelocity(v, now))

          const baselinePool = teamVideos.filter((v) => !seriesOfVideo.has(v.id) && (s.stock_name ? v.stock_name === s.stock_name : true))
          const baselineEngagement = average(baselinePool.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null))
          const baselineVelocity = average(baselinePool.map((v) => viewVelocity(v, now)))

          return {
            id: s.id,
            name: s.name,
            stockName: s.stock_name,
            videoCount: memberVideos.length,
            avgEngagementPct: average(engagementRates),
            avgVelocity: average(velocities),
            baselineEngagementPct: baselineEngagement,
            baselineVelocity,
            members: memberVideos.map((v) => ({ id: v.id, title: titleOf(v) })),
            createdByName: s.created_by ? names.get(s.created_by) || null : null,
            canEdit: canEditOf(s.created_by)
          }
        })

    const toPick = (v: VideoLite) => ({ id: v.id, title: titleOf(v), stockName: v.stock_name, contentType: v.content_type })

    // 아직 어느 시리즈에도 없는 영상 (새 시리즈/추가 후보)
    const eligibleVideos = scopedVideos
      .filter((v) => !seriesOfVideo.has(v.id))
      .slice(0, PICKER_LIMIT)
      .map(toPick)

    // 다른 시리즈에 들어 있지만 내가 고칠 수 있는 시리즈라서 "옮길 수 있는" 영상
    const movableVideos = sample
      ? []
      : scopedVideos
          .filter((v) => {
            const sid = seriesOfVideo.get(v.id)
            const owner = sid ? seriesRows.find((s) => s.id === sid) : null
            return !!owner && canEditOf(owner.created_by)
          })
          .slice(0, PICKER_LIMIT)
          .map((v) => ({ ...toPick(v), seriesId: seriesOfVideo.get(v.id) as string, seriesName: seriesNameById.get(seriesOfVideo.get(v.id) as string) || '' }))

    return NextResponse.json({
      sample,
      formatStats: {
        longform: { label: CONTENT_TYPE_LABELS.longform, ...formatStats.longform },
        shortform: { label: CONTENT_TYPE_LABELS.shortform, ...formatStats.shortform }
      },
      series,
      eligibleVideos,
      movableVideos
    })
  } catch (e) {
    return apiError(e, '형식 · 시리즈 비교를 불러오지 못했어요.')
  }
}
