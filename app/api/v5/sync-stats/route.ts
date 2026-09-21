import { NextResponse } from 'next/server'
import { extractYoutubeVideoId } from '@/lib/youtube/api'
import { fetchYoutubeStatsBatch, YOUTUBE_BATCH_SIZE, YoutubeApiError, type YoutubeStats } from '@/lib/v5/youtube-batch'
import { V5_TABLES } from '@/lib/v5/tables'
import { chunk, forbidden, getSession, handleRouteError } from '@/lib/v5/api'

// 유튜브에서 조회수·좋아요·댓글을 다시 받아와 youtubeCRM_videos 를 갱신하고
// youtubeCRM_video_snapshots 에 스냅샷을 남긴다(알고리즘 친화도의 "초기 성장" 축 계산용).
// 공용 테이블에 쓰는 유일한 V5 라우트. 관리자 전용.
//
// - 한 번에 최대 MAX_PER_RUN 개, 50개씩 묶어서 호출 → 유튜브 호출은 최대 3번(쿼터 3).
// - 가장 오래 갱신 안 된 영상(한 번도 안 한 영상 우선)부터. 최근 90일 안에 등록된 영상만.
// - 방금(10분 안에) 갱신한 영상은 건너뛴다. 남은 영상은 다시 누르면 이어서 처리한다.
// - 같은 영상의 스냅샷은 1시간에 하나만 남긴다.
const MAX_PER_RUN = 150
const RECENT_WINDOW_DAYS = 90
const SKIP_IF_SYNCED_WITHIN_MS = 10 * 60 * 1000
const SNAPSHOT_MIN_GAP_MS = 60 * 60 * 1000
const UPDATE_CONCURRENCY = 8

type Target = { id: string; youtube_video_id: string | null; youtube_url: string | null }

export async function POST(request: Request) {
  try {
    const session = await getSession(request)
    if (!session.isAdmin) return forbidden()
    const { supabaseAdmin } = session

    const { data: accounts, error: accountError } = await supabaseAdmin
      .from(V5_TABLES.youtubeAccounts)
      .select('id, account_name, api_key, api_active, is_active')
      .eq('api_active', true)
      .order('created_at', { ascending: true })
      .limit(5)
    if (accountError) throw accountError
    const account = (accounts || []).find((a: any) => a.api_key && a.is_active !== false) || (accounts || [])[0]
    if (!account?.api_key) {
      return NextResponse.json({ error: '켜져 있는 유튜브 API 키가 없어요. 유튜브 계정에서 API를 켜 주세요.' }, { status: 409 })
    }

    const now = Date.now()
    const recentSince = new Date(now - RECENT_WINDOW_DAYS * 86_400_000).toISOString()
    const freshCutoff = new Date(now - SKIP_IF_SYNCED_WITHIN_MS).toISOString()

    // 갱신이 필요한 영상 후보(최근 90일, 10분 안에 갱신한 것 제외). 오래 안 한 순서, 한 번도 안 한 영상이 맨 앞.
    const { data: videos, error: videoError, count } = await supabaseAdmin
      .from(V5_TABLES.videos)
      .select('id, youtube_video_id, youtube_url', { count: 'exact' })
      .gte('created_at', recentSince)
      .or(`last_synced_at.is.null,last_synced_at.lt.${freshCutoff}`)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: false })
      .range(0, MAX_PER_RUN - 1)
    if (videoError) throw videoError

    const targets = (videos || []) as Target[]
    const syncedAt = new Date().toISOString()
    const remainingAfter = Math.max((count ?? targets.length) - targets.length, 0)

    if (targets.length === 0) {
      return NextResponse.json({ updated: 0, failed: 0, total: 0, remaining: 0, snapshotsSaved: 0, snapshotsSkipped: 0, syncedAt, accountName: account.account_name, nothingToDo: true })
    }

    // 영상별 유튜브 id 확정(없으면 주소에서 뽑는다)
    const withYoutubeId = targets.map((t) => ({ target: t, ytId: t.youtube_video_id || extractYoutubeVideoId(t.youtube_url || '') }))
    const failedIds = new Set<string>()
    for (const w of withYoutubeId) if (!w.ytId) failedIds.add(w.target.id)
    const lookupable = withYoutubeId.filter((w) => w.ytId)

    // 1) 유튜브 호출: 50개씩. 한도/키 문제가 나면 거기서 멈추고 여기까지 받은 것만 반영한다.
    const stats = new Map<string, YoutubeStats>()
    let stoppedReason: 'quota' | 'key' | 'network' | 'other' | null = null
    const attempted = new Set<string>()
    for (const group of chunk(lookupable, YOUTUBE_BATCH_SIZE)) {
      try {
        const result = await fetchYoutubeStatsBatch(group.map((g) => g.ytId as string), account.api_key as string)
        for (const g of group) attempted.add(g.target.id)
        for (const [ytId, s] of result) stats.set(ytId, s)
      } catch (e) {
        stoppedReason = e instanceof YoutubeApiError ? e.kind : 'other'
        console.error('V5 sync-stats 유튜브 호출 실패', e)
        break
      }
    }

    if (stats.size === 0 && stoppedReason) {
      const message =
        stoppedReason === 'quota'
          ? '오늘 유튜브에서 가져올 수 있는 한도를 다 썼어요. 내일 다시 시도해 주세요.'
          : stoppedReason === 'key'
            ? '유튜브 API 키를 쓸 수 없어요. 유튜브 계정의 API 키를 확인해 주세요.'
            : '유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
      return NextResponse.json({ error: message }, { status: stoppedReason === 'quota' ? 429 : 502 })
    }

    // 2) 이미 1시간 안에 스냅샷이 있는 영상 확인(중복 스냅샷 방지)
    const gapSince = new Date(now - SNAPSHOT_MIN_GAP_MS).toISOString()
    const recentlySnapshotted = new Set<string>()
    const idsToCheck = lookupable.filter((w) => stats.has(w.ytId as string)).map((w) => w.target.id)
    for (const group of chunk(idsToCheck)) {
      const { data, error } = await supabaseAdmin.from(V5_TABLES.videoSnapshots).select('video_id').in('video_id', group).gte('snapshot_at', gapSince)
      if (error) {
        console.error('V5 sync-stats 최근 스냅샷 조회 실패', error)
        continue
      }
      for (const row of (data || []) as Array<{ video_id: string }>) recentlySnapshotted.add(row.video_id)
    }

    // 3) 영상 통계 갱신(동시 8개) + 스냅샷 모으기
    let updated = 0
    const snapshotRows: Array<Record<string, unknown>> = []
    const work = lookupable.filter((w) => stats.has(w.ytId as string))
    for (const w of lookupable) {
      // 유튜브가 돌려주지 않은 영상(삭제/비공개/잘못된 id)은 실패로 센다. 호출 자체를 못 한 영상은 다음에 이어서 한다.
      if (attempted.has(w.target.id) && !stats.has(w.ytId as string)) failedIds.add(w.target.id)
    }

    // 유튜브가 못 찾은 영상(삭제/비공개)은 통계는 그대로 두고 '시도한 시각'만 남겨서, 다음 차례에 계속 맨 앞을 차지하지 않게 한다.
    const notFoundIds = lookupable.filter((w) => attempted.has(w.target.id) && !stats.has(w.ytId as string)).map((w) => w.target.id)
    for (const group of chunk(notFoundIds)) {
      const { error } = await supabaseAdmin.from(V5_TABLES.videos).update({ last_synced_at: syncedAt }).in('id', group)
      if (error) console.error('V5 sync-stats 미확인 영상 표시 실패', error)
    }

    const updateOne = async (w: (typeof work)[number]) => {
      const s = stats.get(w.ytId as string)!
      const patch: Record<string, unknown> = { last_synced_at: syncedAt, updated_at: syncedAt }
      if (s.viewCount !== null) patch.view_count = s.viewCount
      if (s.likeCount !== null) patch.like_count = s.likeCount
      if (s.commentCount !== null) patch.comment_count = s.commentCount
      const { error } = await supabaseAdmin.from(V5_TABLES.videos).update(patch).eq('id', w.target.id)
      if (error) {
        console.error('V5 sync-stats 영상 갱신 실패', w.target.id, error)
        failedIds.add(w.target.id)
        return
      }
      updated += 1
      if (!recentlySnapshotted.has(w.target.id)) {
        snapshotRows.push({
          video_id: w.target.id,
          snapshot_at: syncedAt,
          view_count: s.viewCount,
          like_count: s.likeCount,
          comment_count: s.commentCount,
          privacy_status: s.privacyStatus
        })
      }
    }
    for (let i = 0; i < work.length; i += UPDATE_CONCURRENCY) {
      await Promise.all(work.slice(i, i + UPDATE_CONCURRENCY).map(updateOne))
    }

    // 4) 스냅샷은 묶어서 한 번에 넣는다. 실패해도 통계 갱신 자체는 성공으로 본다(서버 로그만).
    let snapshotsSaved = 0
    for (const group of chunk(snapshotRows, 200)) {
      const { error } = await supabaseAdmin.from(V5_TABLES.videoSnapshots).insert(group)
      if (error) console.error('V5 sync-stats 스냅샷 저장 실패', error)
      else snapshotsSaved += group.length
    }

    const notReached = stoppedReason ? lookupable.filter((w) => !attempted.has(w.target.id)).length : 0
    return NextResponse.json({
      updated,
      failed: failedIds.size,
      total: targets.length,
      remaining: remainingAfter + notReached,
      snapshotsSaved,
      snapshotsSkipped: work.filter((w) => recentlySnapshotted.has(w.target.id)).length,
      stopped: stoppedReason,
      syncedAt,
      accountName: account.account_name
    })
  } catch (e) {
    return handleRouteError(e, '조회수를 새로 가져오지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
