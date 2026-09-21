import { average, CONTENT_TYPE_LABELS, engagementRatePct, isoDaysAgo, summarizeByFormat, timeMs, type VideoLite, viewVelocity } from '@/lib/v3/engagement'
import {
  VIDEO_FIELDS_RATES,
  apiError,
  authenticate,
  cachedJson,
  isMissingTableError,
  isUuid,
  loadScopedVideos,
  loadStaffUsers,
  loadTeamVideos,
  loadUserNames,
  loadVideosByIds
} from '@/lib/v3/server'
import { V3_TABLES } from '@/lib/v3/tables'
import { sampleSeriesRows } from '@/lib/v3/sample-data'

const PICKER_LIMIT = 300
const PAGE = 1000
// 팀 기준(시리즈 밖 영상 평균)과 형식 비교를 위해 읽는 영상 수의 한도(최근 등록 순)
const TEAM_LIMIT = 5000
const SCOPED_LIMIT = 3000

// 형식(롱폼 · 숏폼) 효과 + 시리즈 트래커
//   형식 효율 = 형식별 평균 참여율(%), 평균 조회 속도(회/일) (V4의 형식별 "건수" 비교와는 다른 지표)
//   시리즈 성과 = 시리즈에 속한 영상들의 평균 참여율 · 조회 속도를,
//                같은 종목의 시리즈 밖 영상(baseline)과 비교
//   선택 조건: ?staffId=(관리자만) &days=7|30|90 — 롱폼/숏폼 비교표의 범위만 좁힌다(시리즈 목록·기준 영상은 그대로).
//   시리즈 안의 영상 순서 = 시리즈에 넣은 시각(added_at) 순. ↑↓ 로 순서를 바꾸면 이 값을 다시 매긴다(PUT /api/v3/series/[id]/members).
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const now = new Date()
    const params = new URL(request.url).searchParams
    const staffParam = params.get('staffId')
    const staffId = isAdmin && isUuid(staffParam) ? staffParam : null
    const daysParam = Number(params.get('days'))
    const days = [7, 30, 90].includes(daysParam) ? daysParam : 0

    // 관리자가 팀 전체를 볼 때는 "범위 영상"이 "팀 영상"의 앞부분과 똑같으므로 한 번만 받는다.
    const sameAsTeam = isAdmin && !staffId
    const teamPromise = loadTeamVideos(supabaseAdmin, { limit: TEAM_LIMIT, fields: VIDEO_FIELDS_RATES })
    // 시리즈 목록·직원 목록도 영상과 상관없이 받을 수 있어서 함께 요청한다.
    const [teamVideos, scopedVideos, seriesRes, staff] = await Promise.all([
      teamPromise,
      sameAsTeam
        ? teamPromise.then((rows) => rows.slice(0, SCOPED_LIMIT))
        : loadScopedVideos(supabaseAdmin, { isAdmin, selfUserId: profile.id, staffId, limit: SCOPED_LIMIT, fields: VIDEO_FIELDS_RATES }),
      supabaseAdmin
        .from(V3_TABLES.videoSeries)
        .select('id, name, stock_name, created_by, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      isAdmin ? loadStaffUsers(supabaseAdmin) : Promise.resolve([])
    ])

    const periodSince = days > 0 ? timeMs(isoDaysAgo(days, now)) : null
    const formatStats = summarizeByFormat(periodSince === null ? scopedVideos : scopedVideos.filter((v) => timeMs(v.created_at) >= periodSince), now)

    let sample = false
    let seriesRows: { id: string; name: string; stock_name: string | null; created_by: string | null; created_at: string }[] = []
    const membersBySeries = new Map<string, string[]>()
    const addedAtOf = new Map<string, number>()
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
            .select('series_id, video_id, added_at')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1)
          if (memberRes.error) {
            if (isMissingTableError(memberRes.error)) break
            throw memberRes.error
          }
          const rows = (memberRes.data || []) as { series_id: string; video_id: string; added_at: string | null }[]
          for (const row of rows) {
            seriesOfVideo.set(row.video_id, row.series_id)
            addedAtOf.set(row.video_id, timeMs(row.added_at))
            const list = membersBySeries.get(row.series_id) || []
            list.push(row.video_id)
            membersBySeries.set(row.series_id, list)
          }
          if (rows.length < PAGE) break
        }
      }
    }

    // 멤버 영상은 최근 영상 안에 없을 수도 있으니(예전 영상) id 로 따로 가져와 합친다.
    const videoById = new Map(teamVideos.map((v) => [v.id, v]))
    const missingIds = Array.from(seriesOfVideo.keys()).filter((id) => !videoById.has(id))
    if (missingIds.length > 0) {
      for (const v of await loadVideosByIds(supabaseAdmin, missingIds)) videoById.set(v.id, v)
    }

    const names = seriesRows.length > 0 ? await loadUserNames(supabaseAdmin) : new Map<string, string>()
    const seriesById = new Map(seriesRows.map((s) => [s.id, s]))
    const canEditOf = (createdBy: string | null) => isAdmin || createdBy === profile.id
    const titleOf = (v: VideoLite) => v.title || v.stock_name || '(제목 없음)'

    // 기준 영상(시리즈 밖 영상)의 평균은 종목마다 한 번만 계산한다. (시리즈 수 × 영상 수만큼 반복하지 않도록)
    const outside = teamVideos.filter((v) => !seriesOfVideo.has(v.id))
    const baselineCache = new Map<string, { engagement: number; velocity: number }>()
    const baselineFor = (stock: string | null) => {
      const key = stock || ''
      const hit = baselineCache.get(key)
      if (hit) return hit
      const pool = key ? outside.filter((v) => v.stock_name === key) : outside
      const value = {
        engagement: average(pool.map((v) => engagementRatePct(v)).filter((v): v is number => v !== null)),
        velocity: average(pool.map((v) => viewVelocity(v, now)))
      }
      baselineCache.set(key, value)
      return value
    }

    const publishedOf = (v: VideoLite) => timeMs(v.published_at || v.created_at)
    // 순서: 시리즈에 넣은 시각 → (같은 시각이면) 올린 날짜가 이른 것 → id
    const memberOrder = (a: VideoLite, b: VideoLite) => {
      const at = (addedAtOf.get(a.id) || 0) - (addedAtOf.get(b.id) || 0)
      return at || publishedOf(a) - publishedOf(b) || a.id.localeCompare(b.id)
    }

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
          const baseline = baselineFor(s.stock_name)

          return {
            id: s.id,
            name: s.name,
            stockName: s.stock_name,
            videoCount: memberVideos.length,
            avgEngagementPct: average(engagementRates),
            avgVelocity: average(velocities),
            baselineEngagementPct: baseline.engagement,
            baselineVelocity: baseline.velocity,
            members: [...memberVideos].sort(memberOrder).map((v) => ({ id: v.id, title: titleOf(v) })),
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
            const owner = seriesById.get(seriesOfVideo.get(v.id) || '')
            return !!owner && canEditOf(owner.created_by)
          })
          .slice(0, PICKER_LIMIT)
          .map((v) => {
            const sid = seriesOfVideo.get(v.id) as string
            return { ...toPick(v), seriesId: sid, seriesName: seriesById.get(sid)?.name || '' }
          })

    return cachedJson({
      sample,
      formatStats: {
        longform: { label: CONTENT_TYPE_LABELS.longform, ...formatStats.longform },
        shortform: { label: CONTENT_TYPE_LABELS.shortform, ...formatStats.shortform }
      },
      series,
      eligibleVideos,
      movableVideos,
      staffOptions: staff.map((s) => ({ id: s.id, name: s.name }))
    })
  } catch (e) {
    return apiError(e, '형식 · 시리즈 비교를 불러오지 못했어요.')
  }
}
