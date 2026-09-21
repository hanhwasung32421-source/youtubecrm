import { noStoreJson } from '@/lib/v4/http'
import { invalidatePeriodRows } from '@/lib/v4/period-rows'
import { dbError, requireV4Admin, v4ErrorResponse } from '@/lib/v4/server'
import { V4_TABLES } from '@/lib/v4/tables'
import { YT_BATCH_SIZE, YoutubeApiError, fetchYoutubeStatsBatch, youtubeIdOf, type YoutubeStat } from '@/lib/v4/youtube-stats'

// 영상 통계를 유튜브에서 다시 받아와 youtubeCRM_videos 를 갱신하고 youtubeCRM_video_snapshots 에 스냅샷을 남긴다.
// 공용 테이블에 쓰는 유일한 V4 라우트.
//
// 대상 선정 (팀이 하루 60~90개를 올리므로 "최근 30개"만으로는 부족하다):
//   1) 가장 최근에 등록한 RECENT_LIMIT 개  — 방금 올린 영상은 조회수가 빨리 변한다.
//   2) 통계를 받은 지 가장 오래된(또는 한 번도 못 받은) STALE_LIMIT 개 — 눌 때마다 조금씩 돌아가며 전체를 훑는다.
// 유튜브 videos.list 는 50개를 한 번에 조회(쿼터 1)하므로 최대 MAX_API_CALLS 번 = 쿼터 10 이내로 끝난다.
export const maxDuration = 60

const RECENT_LIMIT = 150
const STALE_LIMIT = 350
const MAX_API_CALLS = 10
const API_CONCURRENCY = 3
const UPDATE_CONCURRENCY = 10
const IN_CHUNK = 100
const SNAPSHOT_DEDUPE_MS = 60 * 60 * 1000

type Target = {
  id: string
  youtube_video_id: string | null
  youtube_url: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
}

const TARGET_COLUMNS = 'id, youtube_video_id, youtube_url, view_count, like_count, comment_count'

function chunk<T>(list: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// 간단한 동시 실행 제한 (순서 보장 X)
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor]
        cursor += 1
        await worker(item)
      }
    })
  )
}

export async function POST(request: Request) {
  try {
    const { supabaseAdmin } = await requireV4Admin(request)

    // ---- 사용할 API 키 (쿼터 초과 시 다음 계정 키로 넘어간다)
    const { data: accounts, error: accountError } = await supabaseAdmin
      .from(V4_TABLES.youtubeAccounts)
      .select('id, account_name, api_key, api_active, is_active')
      .eq('api_active', true)
      .order('created_at', { ascending: true })
      .limit(5)
    if (accountError) throw dbError(accountError)
    const usable = (accounts || []).filter((a) => a.api_key && a.is_active !== false)
    const keyPool = (usable.length > 0 ? usable : (accounts || []).filter((a) => a.api_key)) as Array<{ api_key: string; account_name: string | null }>
    if (keyPool.length === 0) {
      return noStoreJson({ error: '활성화된 유튜브 API 키가 없어요. 유튜브 계정에서 API를 켜 주세요.' }, { status: 409 })
    }

    // ---- 대상 영상 고르기: 최근 등록 + 가장 오래 못 받은 것
    const [recentResult, staleResult] = await Promise.all([
      supabaseAdmin.from(V4_TABLES.videos).select(TARGET_COLUMNS).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(RECENT_LIMIT),
      supabaseAdmin
        .from(V4_TABLES.videos)
        .select(TARGET_COLUMNS)
        .order('last_synced_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false })
        .limit(STALE_LIMIT + RECENT_LIMIT)
    ])
    if (recentResult.error) throw dbError(recentResult.error)
    if (staleResult.error) throw dbError(staleResult.error)

    const picked = new Map<string, Target>()
    for (const row of (recentResult.data || []) as unknown as Target[]) picked.set(row.id, row)
    let staleAdded = 0
    for (const row of (staleResult.data || []) as unknown as Target[]) {
      if (staleAdded >= STALE_LIMIT) break
      if (picked.has(row.id)) continue
      picked.set(row.id, row)
      staleAdded += 1
    }

    // 유튜브 ID 를 알 수 없는 영상은 조회 대상에서 빼고 실패로 센다.
    const withIds: Array<{ target: Target; ytId: string }> = []
    let failed = 0
    for (const target of picked.values()) {
      const ytId = youtubeIdOf(target)
      if (ytId) withIds.push({ target, ytId })
      else failed += 1
    }
    const total = picked.size
    const syncedAt = new Date().toISOString()

    // ---- 유튜브 통계 일괄 조회 (50개씩, 최대 MAX_API_CALLS 번)
    const idToTargets = new Map<string, Target[]>()
    for (const { target, ytId } of withIds) idToTargets.set(ytId, [...(idToTargets.get(ytId) || []), target])
    const uniqueIds = Array.from(idToTargets.keys())
    const batches = chunk(uniqueIds, YT_BATCH_SIZE).slice(0, MAX_API_CALLS)
    const skippedByCap = uniqueIds.length - batches.reduce((sum, b) => sum + b.length, 0)
    failed += skippedByCap

    const stats = new Map<string, YoutubeStat>()
    let keyIndex = 0
    const state: { apiError: YoutubeApiError | null } = { apiError: null }
    let apiCalls = 0
    const askBatch = async (ids: string[]) => {
      // 쿼터 초과면 다음 키로 한 번씩만 넘어가 재시도한다.
      for (;;) {
        if (state.apiError) return
        const key = keyPool[keyIndex]
        if (!key) return
        try {
          apiCalls += 1
          const result = await fetchYoutubeStatsBatch(ids, key.api_key)
          for (const [id, stat] of result) stats.set(id, stat)
          // 응답에 없는 영상(삭제됨/비공개 전환)은 통계를 못 받은 것으로 세되, 다음에도 같은 영상이 맨 앞에서 반복되지 않게 아래에서 확인 시각만 남긴다.
          return
        } catch (e) {
          if (e instanceof YoutubeApiError && e.reason === 'quota' && keyIndex < keyPool.length - 1) {
            keyIndex += 1
            continue
          }
          state.apiError = e instanceof YoutubeApiError ? e : new YoutubeApiError('유튜브에서 통계를 받지 못했어요.', 'http')
          return
        }
      }
    }
    await runPool(batches, API_CONCURRENCY, askBatch)

    // ---- 갱신: 값이 바뀐 영상은 개별 update, 그대로인 영상은 확인 시각만 한 번에 update
    const changedRows: Array<{ target: Target; stat: YoutubeStat; view: number | null; like: number | null; comment: number | null }> = []
    const unchangedIds: string[] = []
    const notFoundIds: string[] = []
    let missing = 0
    const snapshotCandidates: Array<{ videoId: string; stat: YoutubeStat; view: number | null; like: number | null; comment: number | null }> = []

    for (const { target, ytId } of withIds) {
      const stat = stats.get(ytId)
      if (!stat) {
        // 유튜브가 응답에 넣어 주지 않은 영상 (삭제/비공개). 조회 자체가 실패한 배치의 영상은 '확인 시각'을 남기지 않는다.
        if (!state.apiError) notFoundIds.push(target.id)
        missing += 1
        continue
      }
      // 좋아요 숨김/누락(null)은 0 으로 덮어쓰지 않고 기존 값을 유지한다.
      const view = stat.viewCount ?? target.view_count
      const like = stat.likeCount ?? target.like_count
      const comment = stat.commentCount ?? target.comment_count
      snapshotCandidates.push({ videoId: target.id, stat, view, like, comment })
      const same = Number(view ?? 0) === Number(target.view_count ?? 0) && Number(like ?? 0) === Number(target.like_count ?? 0) && Number(comment ?? 0) === Number(target.comment_count ?? 0)
      if (same) unchangedIds.push(target.id)
      else changedRows.push({ target, stat, view, like, comment })
    }

    let updateFailed = 0
    const failedUpdateIds = new Set<string>()
    await runPool(changedRows, UPDATE_CONCURRENCY, async (row) => {
      const { error } = await supabaseAdmin
        .from(V4_TABLES.videos)
        .update({ view_count: row.view, like_count: row.like, comment_count: row.comment, last_synced_at: syncedAt, updated_at: syncedAt })
        .eq('id', row.target.id)
      if (error) {
        console.error('[v4] sync-stats 영상 갱신 실패', row.target.id, error)
        updateFailed += 1
        failedUpdateIds.add(row.target.id)
      }
    })
    // 통계가 그대로거나 유튜브에 없는 영상도 "확인한 시각"은 남겨야 다음 번에 다른 영상이 차례를 받는다.
    for (const ids of chunk([...unchangedIds, ...notFoundIds], IN_CHUNK)) {
      const { error } = await supabaseAdmin.from(V4_TABLES.videos).update({ last_synced_at: syncedAt, updated_at: syncedAt }).in('id', ids)
      if (error) console.error('[v4] sync-stats 확인 시각 갱신 실패', error)
    }
    failed += updateFailed + missing

    // ---- 스냅샷: 같은 시간대(최근 1시간)에 이미 같은 숫자로 남긴 영상은 건너뛴다.
    let snapshots = 0
    let snapshotsSkipped = 0
    let snapshotFailed = false
    if (snapshotCandidates.length > 0) {
      const hourAgoIso = new Date(Date.parse(syncedAt) - SNAPSHOT_DEDUPE_MS).toISOString()
      const latest = new Map<string, { view: number; like: number; comment: number }>()
      for (const ids of chunk(snapshotCandidates.map((c) => c.videoId), IN_CHUNK)) {
        const { data, error } = await supabaseAdmin
          .from(V4_TABLES.videoSnapshots)
          .select('video_id, view_count, like_count, comment_count, snapshot_at')
          .in('video_id', ids)
          .gte('snapshot_at', hourAgoIso)
          .order('snapshot_at', { ascending: false })
          .limit(1000)
        if (error) {
          console.error('[v4] sync-stats 스냅샷 조회 실패', error)
          continue
        }
        for (const row of (data || []) as Array<{ video_id: string; view_count: number | null; like_count: number | null; comment_count: number | null }>) {
          if (!latest.has(row.video_id)) latest.set(row.video_id, { view: Number(row.view_count ?? 0), like: Number(row.like_count ?? 0), comment: Number(row.comment_count ?? 0) })
        }
      }
      const toInsert = snapshotCandidates
        .filter((c) => !failedUpdateIds.has(c.videoId))
        .filter((c) => {
          const prev = latest.get(c.videoId)
          const same = prev && prev.view === Number(c.view ?? 0) && prev.like === Number(c.like ?? 0) && prev.comment === Number(c.comment ?? 0)
          if (same) snapshotsSkipped += 1
          return !same
        })
        .map((c) => ({
          video_id: c.videoId,
          snapshot_at: syncedAt,
          view_count: c.view,
          like_count: c.like,
          comment_count: c.comment,
          privacy_status: c.stat.privacyStatus
        }))
      for (const rows of chunk(toInsert, IN_CHUNK)) {
        const { error } = await supabaseAdmin.from(V4_TABLES.videoSnapshots).insert(rows)
        if (error) {
          // 스냅샷 테이블 문제는 통계 갱신 자체를 실패로 보지 않는다 (서버 로그만).
          console.error('[v4] sync-stats 스냅샷 저장 실패', error)
          snapshotFailed = true
        } else {
          snapshots += rows.length
        }
      }
    }

    // 조회수를 새로 받았으니, 잠깐 기억해 둔 기간별 영상 목록을 비워 다음 조회에 새 숫자가 바로 나오게 한다.
    invalidatePeriodRows()

    const updated = changedRows.length - updateFailed + unchangedIds.length
    // 통계를 한 건도 못 받았고 원인이 유튜브 쪽이면 성공처럼 보이지 않게 오류로 알린다.
    if (updated === 0 && state.apiError) {
      return noStoreJson({ error: state.apiError.message }, { status: state.apiError.reason === 'quota' ? 429 : 502 })
    }

    const accountName = keyPool[Math.min(keyIndex, keyPool.length - 1)]?.account_name || null
    return noStoreJson({
      updated,
      changed: changedRows.length - updateFailed,
      unchanged: unchangedIds.length,
      failed,
      total,
      snapshots,
      snapshotsSkipped,
      snapshotFailed,
      apiCalls,
      partial: Boolean(state.apiError) || skippedByCap > 0,
      warning: state.apiError ? state.apiError.message : null,
      syncedAt,
      accountName
    })
  } catch (e) {
    // 중간에 실패했어도 일부 영상은 이미 갱신됐을 수 있으니 기억해 둔 목록은 비운다.
    invalidatePeriodRows()
    return v4ErrorResponse(e, '조회수를 새로 받지 못했어요')
  }
}
