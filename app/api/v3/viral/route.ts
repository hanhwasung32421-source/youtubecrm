import { isoDaysAgo, median, viewVelocity } from '@/lib/v3/engagement'
import { VIDEO_FIELDS_LIST, apiError, authenticate, cachedJson, isMissingTableError, loadTeamVideos, loadUserNames } from '@/lib/v3/server'
import { V3_TABLES } from '@/lib/v3/tables'

const THRESHOLD_MULTIPLIER = 2
const MIN_TEAM_SAMPLE = 5
const MAX_ITEMS = 30

// 바이럴 신호 레이더
//   조회 속도 = 조회수 ÷ max(게시 후 경과일, 1)
//   최근 30일 팀 전체 영상의 조회 속도 중앙값을 기준으로, 그 2배를 넘으면 "🔥 바이럴 후보"
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const now = new Date()
    const teamVideos = await loadTeamVideos(supabaseAdmin, { sinceIso: isoDaysAgo(30, now), limit: 3000, fields: VIDEO_FIELDS_LIST })
    const velocities = teamVideos.map((v) => viewVelocity(v, now))
    const teamMedian = median(velocities)

    const insufficientData = teamVideos.length < MIN_TEAM_SAMPLE || teamMedian <= 0

    let candidates = teamVideos
      .map((v, i) => ({ video: v, velocity: velocities[i], ratio: teamMedian > 0 ? velocities[i] / teamMedian : 0 }))
      .filter((row) => !insufficientData && row.ratio >= THRESHOLD_MULTIPLIER)
      .sort((a, b) => b.ratio - a.ratio)

    if (!isAdmin) {
      candidates = candidates.filter((row) => row.video.primary_owner_user_id === profile.id)
    }

    // 화면에 보여줄 상위 30개만 확인(ack) 여부를 조회한다. (후보 전체를 .in()에 넣으면 요청 주소가 너무 길어짐)
    const shown = candidates.slice(0, MAX_ITEMS)
    const ackByVideo = new Map<string, { note: string | null; at: string; by: string }>()
    let acksAvailable = true
    if (shown.length > 0) {
      const ackRes = await supabaseAdmin
        .from(V3_TABLES.viralSignalAcks)
        .select('video_id, action_note, created_at, acknowledged_by')
        .in(
          'video_id',
          shown.map((c) => c.video.id)
        )
        .order('created_at', { ascending: false })
      if (ackRes.error) {
        if (!isMissingTableError(ackRes.error)) throw ackRes.error
        acksAvailable = false
      } else {
        for (const row of (ackRes.data || []) as { video_id: string; action_note: string | null; created_at: string; acknowledged_by: string }[]) {
          // 영상 1개에는 가장 최근 확인 기록 1개만 쓴다.
          if (!ackByVideo.has(row.video_id)) ackByVideo.set(row.video_id, { note: row.action_note, at: row.created_at, by: row.acknowledged_by })
        }
      }
    }
    const names = ackByVideo.size > 0 ? await loadUserNames(supabaseAdmin) : new Map<string, string>()

    const items = shown.map((row) => {
      const ack = ackByVideo.get(row.video.id)
      return {
        id: row.video.id,
        title: row.video.title || row.video.stock_name || '(제목 없음)',
        stockName: row.video.stock_name,
        contentType: row.video.content_type,
        youtubeUrl: row.video.youtube_url,
        viewCount: row.video.view_count,
        publishedAt: row.video.published_at || row.video.created_at,
        velocity: Math.round(row.velocity),
        ratio: row.ratio,
        note: `${row.video.stock_name || '이'} 영상이 팀 중앙값 대비 ${row.ratio.toFixed(1)}배 빠르게 조회수가 오르고 있습니다.`,
        acknowledged: !!ack,
        actionNote: ack?.note || null,
        ackedAt: ack?.at || null,
        ackedByName: ack ? names.get(ack.by) || null : null
      }
    })

    return cachedJson({
      insufficientData,
      teamMedianVelocity: Math.round(teamMedian),
      teamSampleSize: teamVideos.length,
      minSampleSize: MIN_TEAM_SAMPLE,
      thresholdMultiplier: THRESHOLD_MULTIPLIER,
      acksAvailable,
      summary: insufficientData
        ? '최근 30일간 등록된 영상이 충분하지 않아 바이럴 신호를 계산할 수 없습니다.'
        : items.length > 0
          ? `팀 중앙값 대비 2배 이상 빠르게 성장 중인 영상 ${items.length}건을 찾았습니다. 1위는 "${items[0].title}"(${items[0].ratio.toFixed(1)}배)입니다.`
          : '현재 팀 중앙값 대비 2배 이상 빠르게 성장 중인 영상이 없습니다.',
      items
    })
  } catch (e) {
    return apiError(e, '급상승 영상을 불러오지 못했어요.')
  }
}
