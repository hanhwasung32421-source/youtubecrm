import { NextResponse } from 'next/server'
import { addDaysToYmd, getKstDayStartIso, getKstYmd } from '@/lib/attendance/time'
import { computeScoreboard, type SnapshotRow } from '@/lib/v5/scoring'
import { V5_TABLES } from '@/lib/v5/tables'
import { SCORE_TIERS, type VideoRef } from '@/lib/v5/types'
import { badRequest, fetchAllPages, getSession, handleRouteError, loadUserMap } from '@/lib/v5/api'

// 기간(7/30/90일). created_at(등록 시각) 기준으로 서버에서 거른다.
const PERIODS = [7, 30, 90] as const
const DEFAULT_DAYS = 30
// 하루 60~90편 × 90일 ≈ 8,000편. 1,000행씩 나눠 읽되 안전 상한을 둔다(넘으면 truncated 로 알림).
const VIDEO_MAX_PAGES = 12
const SNAPSHOT_MAX_PAGES = 15
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
    const videoIdSet = new Set(videoRows.map((v) => v.id))

    // 초반 성장 점수용 스냅샷: 기간 안에 찍힌 것만(등록 이후에 생기므로 충분), 오래된 것부터.
    // 상한에 걸리면 뒤쪽(최근) 스냅샷이 빠지는데, 초반 48시간 판단에는 오래된 쪽이 더 중요하다.
    const snapshotsByVideoId = new Map<string, SnapshotRow[]>()
    let snapshotsTruncated = false
    if (videoRows.length > 0) {
      try {
        const snaps = await fetchAllPages<SnapshotRow>(
          (from, to, withCount) =>
            supabaseAdmin
              .from(V5_TABLES.videoSnapshots)
              .select('video_id, snapshot_at, view_count, like_count, comment_count', withCount ? { count: 'exact' } : undefined)
              .gte('snapshot_at', sinceIso)
              .order('snapshot_at', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to) as any,
          { maxPages: SNAPSHOT_MAX_PAGES }
        )
        snapshotsTruncated = snaps.truncated
        for (const row of snaps.rows) {
          if (!videoIdSet.has(row.video_id)) continue
          const list = snapshotsByVideoId.get(row.video_id) || []
          list.push(row)
          snapshotsByVideoId.set(row.video_id, list)
        }
      } catch (e) {
        // 스냅샷을 못 읽어도 조회 속도·반응 점수는 계산할 수 있다(초반 반응은 중간값 처리).
        console.error('V5 스코어보드 스냅샷 조회 실패', e)
      }
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

    return NextResponse.json({
      items: visible.slice(0, MAX_ROWS),
      shown: Math.min(total, MAX_ROWS),
      days,
      since: sinceYmd,
      summary,
      distribution,
      owners,
      unsynced,
      lastSyncedAt,
      truncated: videosResult.truncated,
      snapshotsTruncated
    })
  } catch (e) {
    return handleRouteError(e, '점수판을 불러오지 못했어요.')
  }
}
