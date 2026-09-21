import { addDaysToYmd, getKstDayStartIso, getKstYmd } from '@/lib/attendance/time'
import { computeScoreboard, EARLY_WINDOW_HOURS, isEarlyGrowthCandidate, type SnapshotRow } from '@/lib/v5/scoring'
import { V5_TABLES } from '@/lib/v5/tables'
import { SCORE_TIERS, type VideoRef } from '@/lib/v5/types'
import { badRequest, chunk, fetchAllPages, getSession, handleRouteError, IN_CHUNK, jsonCached, loadUserMap } from '@/lib/v5/api'

// 기간(7/30/90일). created_at(등록 시각) 기준으로 서버에서 거른다.
const PERIODS = [7, 30, 90] as const
const DEFAULT_DAYS = 30
// 하루 60~90편 × 90일 ≈ 8,000편. 1,000행씩 나눠 읽되 안전 상한을 둔다(넘으면 truncated 로 알림).
const VIDEO_MAX_PAGES = 12
// 초기 성장용 스냅샷: 100개 영상씩 묶어 동시에 5묶음, 최대 80묶음(8,000편), 묶음당 1,000행.
const SNAPSHOT_PARALLEL = 5
const SNAPSHOT_MAX_GROUPS = 80
const SNAPSHOT_GROUP_ROWS = 1000
const HOUR_MS = 3_600_000
// 응답으로 내려주는 순위 행 수. 합계/평균/분포는 항상 전체 기준으로 계산한다.
const MAX_ROWS = 200

type VideoDbRow = Omit<VideoRef, 'thumbnail_url' | 'owner_name'> & { last_synced_at: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 알고리즘 친화도 스코어보드 — youtubeCRM_videos(+ video_snapshots)는 이미 존재하는 공용 테이블.
// 점수는 "선택한 기간의 팀 전체 영상"끼리 비교한 백분위이고, 담당자 필터는 그 결과를 좁혀 보여줄 뿐이다.
export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    const { supabaseAdmin } = session

    const url = new URL(request.url)
    const daysParam = Number(url.searchParams.get('days') || DEFAULT_DAYS)
    const days = (PERIODS as readonly number[]).includes(daysParam) ? daysParam : DEFAULT_DAYS
    const ownerParam = url.searchParams.get('owner') || ''
    if (ownerParam && !UUID_RE.test(ownerParam)) return badRequest('담당자를 찾을 수 없어요.')

    // 오늘 포함 N일(한국 시간 0시 기준)
    const sinceYmd = addDaysToYmd(getKstYmd(), -(days - 1))
    const sinceIso = getKstDayStartIso(sinceYmd)

    const videosResult = await fetchAllPages<VideoDbRow>(
      (from, to, withCount) =>
        supabaseAdmin
          .from(V5_TABLES.videos)
          .select(
            'id, title, stock_name, content_type, published_at, view_count, like_count, comment_count, youtube_url, primary_owner_user_id, created_at, last_synced_at',
            withCount ? { count: 'exact' } : undefined
          )
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to) as any,
      { maxPages: VIDEO_MAX_PAGES }
    )

    const videoRows = videosResult.rows

    // 초기 성장 점수용 스냅샷. 필요한 것만 싸게 읽는다:
    //  - 올린 지 48시간이 훨씬 지나서 등록한 영상은 48시간 안 스냅샷이 있을 수 없으니 조회하지 않는다(결과 동일, 항상 중립 10점).
    //  - 나머지는 올린 시각 순으로 묶어 100개씩, 그 묶음의 (올린 시각 ~ +48시간) 구간 스냅샷만 읽는다.
    //  - 묶음은 동시에 몇 개씩만, 전체 묶음 수에도 상한을 둔다(넘거나 실패하면 snapshotsTruncated 로 알림).
    const snapshotsByVideoId = new Map<string, SnapshotRow[]>()
    let snapshotsTruncated = false
    const candidates = videoRows
      .filter((v) => isEarlyGrowthCandidate(v.published_at, v.created_at))
      .sort((x, y) => Date.parse(y.published_at as string) - Date.parse(x.published_at as string))
    const groups = chunk(candidates, IN_CHUNK)
    if (groups.length > SNAPSHOT_MAX_GROUPS) snapshotsTruncated = true
    const sinceMs = Date.parse(sinceIso)
    const readGroup = async (group: VideoDbRow[]) => {
      const times = group.map((v) => Date.parse(v.published_at as string)).filter((n) => Number.isFinite(n))
      if (times.length === 0) return
      const from = new Date(Math.max(Math.min(...times) - EARLY_WINDOW_HOURS * HOUR_MS, sinceMs)).toISOString()
      const to = new Date(Math.max(...times) + EARLY_WINDOW_HOURS * HOUR_MS).toISOString()
      try {
        const { data, error } = await supabaseAdmin
          .from(V5_TABLES.videoSnapshots)
          .select('video_id, snapshot_at, view_count')
          .in('video_id', group.map((v) => v.id))
          .gte('snapshot_at', from)
          .lte('snapshot_at', to)
          .order('snapshot_at', { ascending: true })
          .range(0, SNAPSHOT_GROUP_ROWS - 1)
        if (error) throw error
        const rows = (data || []) as SnapshotRow[]
        if (rows.length >= SNAPSHOT_GROUP_ROWS) snapshotsTruncated = true
        for (const row of rows) {
          const list = snapshotsByVideoId.get(row.video_id) || []
          list.push(row)
          snapshotsByVideoId.set(row.video_id, list)
        }
      } catch (e) {
        // 스냅샷을 못 읽어도 조회 속도·참여율 점수는 계산할 수 있다(초기 성장은 중간값 처리).
        snapshotsTruncated = true
        console.error('V5 스코어보드 스냅샷 조회 실패', e)
      }
    }
    const limitedGroups = groups.slice(0, SNAPSHOT_MAX_GROUPS)
    for (let i = 0; i < limitedGroups.length; i += SNAPSHOT_PARALLEL) {
      await Promise.all(limitedGroups.slice(i, i + SNAPSHOT_PARALLEL).map(readGroup))
    }

    const videoRefs: VideoRef[] = videoRows.map((v) => ({
      id: v.id,
      title: v.title,
      stock_name: v.stock_name,
      content_type: v.content_type,
      published_at: v.published_at,
      view_count: v.view_count,
      like_count: v.like_count,
      comment_count: v.comment_count,
      youtube_url: v.youtube_url,
      thumbnail_url: null,
      primary_owner_user_id: v.primary_owner_user_id,
      created_at: v.created_at
    }))

    const userMap = await loadUserMap(supabaseAdmin, videoRefs.map((v) => v.primary_owner_user_id))
    const withOwner = videoRefs.map((v) => ({ ...v, owner_name: v.primary_owner_user_id ? userMap.get(v.primary_owner_user_id) || null : null }))

    // 백분위는 기간 전체(팀 전체)로 계산한다.
    const scored = computeScoreboard(withOwner, snapshotsByVideoId).sort(
      (a, b) => b.totalScore - a.totalScore || (b.video.view_count || 0) - (a.video.view_count || 0)
    )

    // 담당자 목록은 항상 팀 전체 기준(필터를 골라도 다른 사람으로 바꿀 수 있게)
    const ownerCounts = new Map<string, { id: string; name: string; count: number }>()
    for (const r of scored) {
      const id = r.video.primary_owner_user_id
      if (!id) continue
      const cur = ownerCounts.get(id) || { id, name: userMap.get(id) || '이름 없음', count: 0 }
      cur.count += 1
      ownerCounts.set(id, cur)
    }
    const owners = Array.from(ownerCounts.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))

    const visible = ownerParam ? scored.filter((r) => r.video.primary_owner_user_id === ownerParam) : scored
    const total = visible.length
    const scoreSum = visible.reduce((s, r) => s + r.totalScore, 0)
    const distribution = SCORE_TIERS.map((tier) => ({ tier, count: visible.filter((r) => r.tier === tier).length }))
    const summary = {
      total,
      avg: total > 0 ? Math.round(scoreSum / total) : 0,
      strong: visible.filter((r) => r.tier === 'excellent' || r.tier === 'good').length,
      weak: visible.filter((r) => r.tier === 'poor').length
    }

    // 조회수를 한 번도 가져오지 않은 영상은 0으로 계산돼 점수가 낮게 나온다 → 화면에서 알려 준다.
    const syncedIds = new Set(videoRows.filter((v) => v.last_synced_at).map((v) => v.id))
    const unsynced = visible.filter((r) => !syncedIds.has(r.video.id)).length
    let lastSyncedAt: string | null = null
    for (const v of videoRows) if (v.last_synced_at && (!lastSyncedAt || v.last_synced_at > lastSyncedAt)) lastSyncedAt = v.last_synced_at

    return jsonCached({
      items: visible.slice(0, MAX_ROWS),
      // 점수가 가장 낮은 "아쉬움" 구간 영상(낮은 순 최대 5개). 순위 목록이 200개에서 잘려도 "손봐야 할 영상"을 빠짐없이 짚기 위해 따로 내려준다.
      bottom: visible
        .slice(-5)
        .filter((r) => r.tier === 'poor')
        .reverse(),
      shown: Math.min(total, MAX_ROWS),
      days,
      since: sinceYmd,
      summary,
      distribution,
      owners,
      unsynced,
      lastSyncedAt,
      earlyKnown: visible.filter((r) => r.hasSnapshotData).length,
      generatedAt: new Date().toISOString(),
      truncated: videosResult.truncated,
      snapshotsTruncated
    })
  } catch (e) {
    return handleRouteError(e, '점수판을 불러오지 못했어요.')
  }
}
