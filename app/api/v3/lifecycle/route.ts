import { NextResponse } from 'next/server'
import { daysSince } from '@/lib/v3/engagement'
import { apiError, authenticate, isUuid, loadScopedVideos, loadSnapshotCounts, loadStaffUsers, loadVideosByIds } from '@/lib/v3/server'
import { SHARED_TABLES } from '@/lib/v3/tables'

// 목록 모드: ?videoId 없이 호출 -> 선택 가능한 영상 목록 + 스냅샷 개수
// 상세 모드: ?videoId=... -> 해당 영상의 스냅샷 시계열(게시 후 N일 vs 조회수)
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const url = new URL(request.url)
    const videoId = url.searchParams.get('videoId')
    const staffId = url.searchParams.get('staffId')

    if (videoId) {
      if (!isUuid(videoId)) return NextResponse.json({ error: '영상을 찾을 수 없어요. 목록에서 다시 골라 주세요.' }, { status: 404 })
      const [video] = await loadVideosByIds(supabaseAdmin, [videoId])
      if (!video) return NextResponse.json({ error: '영상을 찾을 수 없어요. 삭제되었을 수 있어요.' }, { status: 404 })
      if (!isAdmin && video.primary_owner_user_id !== profile.id) {
        return NextResponse.json({ error: '내가 등록한 영상만 볼 수 있어요.' }, { status: 403 })
      }

      const { data, error } = await supabaseAdmin
        .from(SHARED_TABLES.videoSnapshots)
        .select('snapshot_at, view_count, like_count, comment_count')
        .eq('video_id', videoId)
        .order('snapshot_at', { ascending: true })
        .limit(1000)
      if (error) throw error

      const rows = (data || []) as { snapshot_at: string; view_count: number | null; like_count: number | null; comment_count: number | null }[]
      const publishedRef = video.published_at || video.created_at
      const snapshots = rows.map((row) => ({
        snapshotAt: row.snapshot_at,
        viewCount: Number(row.view_count || 0),
        likeCount: Number(row.like_count || 0),
        commentCount: Number(row.comment_count || 0),
        day: daysSince(publishedRef, new Date(row.snapshot_at))
      }))

      return NextResponse.json({
        video: {
          id: video.id,
          title: video.title || video.stock_name || '(제목 없음)',
          stockName: video.stock_name,
          contentType: video.content_type,
          youtubeUrl: video.youtube_url,
          publishedAt: video.published_at,
          viewCount: video.view_count,
          lastSyncedAt: video.last_synced_at || null
        },
        snapshots,
        enough: snapshots.length >= 2
      })
    }

    const videos = await loadScopedVideos(supabaseAdmin, {
      isAdmin,
      selfUserId: profile.id,
      staffId: isAdmin ? staffId : null,
      limit: 300
    })

    const countByVideo = await loadSnapshotCounts(
      supabaseAdmin,
      videos.map((v) => v.id)
    )

    const items = videos.map((v) => ({
      id: v.id,
      title: v.title || v.stock_name || '(제목 없음)',
      stockName: v.stock_name,
      contentType: v.content_type,
      viewCount: v.view_count,
      publishedAt: v.published_at,
      youtubeUrl: v.youtube_url,
      snapshotCount: countByVideo.get(v.id) || 0
    }))

    const staffOptions = isAdmin ? (await loadStaffUsers(supabaseAdmin)).map((s) => ({ id: s.id, name: s.name })) : []

    return NextResponse.json({ items, staffOptions })
  } catch (e) {
    return apiError(e, '조회수 기록을 불러오지 못했어요.')
  }
}
