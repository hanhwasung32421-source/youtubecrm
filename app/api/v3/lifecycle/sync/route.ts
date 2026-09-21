import { extractYoutubeVideoId } from '@/lib/youtube/api'
import { isoDaysAgo, type VideoLite } from '@/lib/v3/engagement'
import { ApiFail, apiError, authenticate, isUuid, loadActiveYoutubeApiKey, loadScopedVideos, loadVideosByIds, noStoreJson, readJson, requireUuid } from '@/lib/v3/server'
import { SHARED_TABLES } from '@/lib/v3/tables'
import { fetchYoutubeStatsBatch } from '@/lib/v3/youtube-stats'

// 유튜브 videos.list 는 id 를 여러 개 넣어도 할당량이 1 이라서 한 번에 10개씩 묶어 요청한다.
const MAX_PER_CALL = 10
// 같은 영상을 몇 분 안에 또 기록하면 그래프에 의미 없는 점만 쌓이므로 건너뛴다.
const RECENT_MS = 5 * 60 * 1000
// "전체 새로고침"이 살펴볼 범위: 최근 30일에 등록한 영상 중 기록이 가장 오래된 것부터.
const POOL_DAYS = 30

type ResultRow = { id: string; title: string; viewCount: number; ok: boolean; skipped?: boolean; error?: string }

const titleOf = (v: VideoLite) => v.title || v.stock_name || '(제목 없음)'

// "통계 새로고침": youtubeCRM_youtube_accounts 의 활성 API 키로 최신 조회수/좋아요/댓글 수를
// 가져와 youtubeCRM_videos 를 갱신하고, youtubeCRM_video_snapshots 에 시점 스냅샷을 쌓는다.
// 이렇게 쌓인 스냅샷이 "조회 성장 곡선(라이프사이클)" 페이지의 데이터가 된다.
//   - videoId 가 있으면 그 영상 1개(본인 영상만, 관리자는 전체)
//   - 없으면 기록이 가장 오래된 영상부터 최대 10개 (직원은 본인 영상, 관리자는 staffId 로 좁힐 수 있음)
export async function POST(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const raw = ((await readJson(request)) || {}) as { videoId?: unknown; staffId?: unknown }
    const videoId = raw.videoId ? requireUuid(raw.videoId, '영상') : null
    const staffId = isAdmin && isUuid(raw.staffId) ? raw.staffId : null

    const apiKey = await loadActiveYoutubeApiKey(supabaseAdmin)
    if (!apiKey) {
      throw new ApiFail(400, '유튜브 연결 키가 아직 등록되지 않았어요. 관리자에게 키 등록을 요청해 주세요.')
    }

    const nowMs = Date.now()
    const recentCutoff = nowMs - RECENT_MS
    let targets: VideoLite[]
    let remaining = 0

    if (videoId) {
      const [video] = await loadVideosByIds(supabaseAdmin, [videoId])
      if (!video) throw new ApiFail(404, '영상을 찾을 수 없어요. 삭제되었을 수 있어요.')
      if (!isAdmin && video.primary_owner_user_id !== profile.id) throw new ApiFail(403, '내가 등록한 영상만 새로고침할 수 있어요.')
      targets = [video]
    } else {
      const pool = await loadScopedVideos(supabaseAdmin, { isAdmin, selfUserId: profile.id, staffId, limit: 400, sinceIso: isoDaysAgo(POOL_DAYS) })
      const stale = pool
        .filter((v) => !v.last_synced_at || new Date(v.last_synced_at).getTime() < recentCutoff)
        .sort((a, b) => (a.last_synced_at ? new Date(a.last_synced_at).getTime() : 0) - (b.last_synced_at ? new Date(b.last_synced_at).getTime() : 0))
      targets = stale.slice(0, MAX_PER_CALL)
      remaining = Math.max(stale.length - targets.length, 0)
    }

    const results: ResultRow[] = []
    if (targets.length === 0) {
      return noStoreJson({ updated: 0, total: 0, skipped: 0, remaining: 0, results })
    }

    // 1) 바로 직전(5분 안)에 이미 기록한 영상은 건너뛴다.
    const recentSnap = new Set<string>()
    if (videoId) {
      const { data, error } = await supabaseAdmin
        .from(SHARED_TABLES.videoSnapshots)
        .select('video_id')
        .eq('video_id', videoId)
        .gte('snapshot_at', new Date(recentCutoff).toISOString())
        .limit(1)
      if (error) throw error
      for (const row of (data || []) as { video_id: string }[]) recentSnap.add(row.video_id)
    }

    // 2) 유튜브 영상 id 를 정리하고 한 번에 조회
    const runnable: { video: VideoLite; ytId: string }[] = []
    for (const video of targets) {
      if (recentSnap.has(video.id)) {
        results.push({ id: video.id, title: titleOf(video), viewCount: video.view_count || 0, ok: true, skipped: true })
        continue
      }
      const ytId = (video.youtube_video_id || '').trim() || extractYoutubeVideoId(video.youtube_url || '')
      if (!ytId) {
        results.push({ id: video.id, title: titleOf(video), viewCount: video.view_count || 0, ok: false, error: '유튜브 주소를 확인할 수 없어요.' })
        continue
      }
      runnable.push({ video, ytId })
    }

    const stats = await fetchYoutubeStatsBatch(
      runnable.map((r) => r.ytId),
      apiKey
    )

    // 3) 유튜브에서 찾은 영상만 스냅샷 기록 → 영상 최신값 갱신
    const nowIso = new Date().toISOString()
    const found: { video: VideoLite; stat: NonNullable<ReturnType<typeof stats.get>> }[] = []
    for (const { video, ytId } of runnable) {
      const stat = stats.get(ytId)
      if (!stat || stat.viewCount === null) {
        results.push({ id: video.id, title: titleOf(video), viewCount: video.view_count || 0, ok: false, error: '유튜브에서 찾을 수 없어요. 삭제되었거나 비공개일 수 있어요.' })
        continue
      }
      found.push({ video, stat })
    }

    if (found.length > 0) {
      const { error: snapshotError } = await supabaseAdmin.from(SHARED_TABLES.videoSnapshots).insert(
        found.map(({ video, stat }) => ({
          video_id: video.id,
          snapshot_at: nowIso,
          view_count: stat.viewCount,
          like_count: stat.likeCount ?? video.like_count ?? null,
          comment_count: stat.commentCount ?? video.comment_count ?? null,
          privacy_status: stat.privacyStatus,
          raw_json: stat
        }))
      )
      if (snapshotError) throw snapshotError

      await Promise.all(
        found.map(async ({ video, stat }) => {
          // 좋아요 숨김/댓글 막힘(null)이면 기존 값을 0으로 덮어쓰지 않는다.
          const patch: Record<string, unknown> = { view_count: stat.viewCount, last_synced_at: nowIso }
          if (stat.likeCount !== null) patch.like_count = stat.likeCount
          if (stat.commentCount !== null) patch.comment_count = stat.commentCount
          if (stat.privacyStatus) patch.privacy_status = stat.privacyStatus
          const { error } = await supabaseAdmin.from(SHARED_TABLES.videos).update(patch).eq('id', video.id)
          if (error) {
            console.error('sync: video update failed', video.id, error)
            results.push({ id: video.id, title: titleOf(video), viewCount: video.view_count || 0, ok: false, error: '기록은 남겼지만 영상 정보를 갱신하지 못했어요.' })
          } else {
            results.push({ id: video.id, title: titleOf(video), viewCount: stat.viewCount as number, ok: true })
          }
        })
      )
    }

    return noStoreJson({
      updated: results.filter((r) => r.ok && !r.skipped).length,
      total: results.length,
      skipped: results.filter((r) => r.skipped).length,
      remaining,
      results
    })
  } catch (e) {
    return apiError(e, '통계 새로고침에 실패했어요.')
  }
}
