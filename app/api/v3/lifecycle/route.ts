import { NextResponse } from 'next/server'
import { daysSince } from '@/lib/v3/engagement'
import { downsample } from '@/lib/v3/chart-math'
import {
  VIDEO_FIELDS_LIST,
  apiError,
  authenticate,
  cachedJson,
  isUuid,
  loadScopedVideos,
  loadSnapshotCounts,
  loadStaffUsers,
  loadVideoSnapshots,
  loadVideosByIds
} from '@/lib/v3/server'

// 화면에 처음 보이는 영상(+ "더 보기"로 몇 번 펼친 정도)까지만 기록 개수를 센다.
// 300개 영상의 기록을 전부 세면 행이 수천 개라서, 나머지는 개수를 비워 두고(null) 영상을 고르면 그때 정확히 보여 준다.
const COUNT_LIMIT = 60
// 그래프에 그릴 점의 최대 개수(그보다 많으면 고르게 솎아 낸다)
const CHART_POINTS = 150
// 한 영상에서 읽어 오는 기록의 최대 개수(가장 최근 것부터)
const SNAPSHOT_FETCH = 400

// 목록 모드: ?videoId 없이 호출 -> 선택 가능한 영상 목록 + 스냅샷 개수
// 상세 모드: ?videoId=... -> 해당 영상의 스냅샷 시계열(게시 후 N일 vs 조회수)
export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const url = new URL(request.url)
    const videoId = url.searchParams.get('videoId')
    const staffParam = url.searchParams.get('staffId')
    const staffId = isUuid(staffParam) ? staffParam : null

    if (videoId) {
      if (!isUuid(videoId)) return NextResponse.json({ error: '영상을 찾을 수 없어요. 목록에서 다시 골라 주세요.' }, { status: 404 })
      // 영상 정보와 조회수 기록은 서로 기다릴 필요가 없어 동시에 받는다. (권한이 없으면 기록은 버린다)
      const [[video], snap] = await Promise.all([loadVideosByIds(supabaseAdmin, [videoId]), loadVideoSnapshots(supabaseAdmin, videoId, SNAPSHOT_FETCH)])
      if (!video) return NextResponse.json({ error: '영상을 찾을 수 없어요. 삭제되었을 수 있어요.' }, { status: 404 })
      if (!isAdmin && video.primary_owner_user_id !== profile.id) {
        return NextResponse.json({ error: '내가 등록한 영상만 볼 수 있어요.' }, { status: 403 })
      }

      const publishedRef = video.published_at || video.created_at
      // "이전 기록보다 얼마나 늘었는지"는 솎아 내기 전에 계산해 둔다(솎은 뒤에 계산하면 값이 틀려진다).
      const full = snap.rows.map((row, i) => {
        const viewCount = Number(row.view_count || 0)
        const prevViews = i > 0 ? Number(snap.rows[i - 1].view_count || 0) : null
        return {
          snapshotAt: row.snapshot_at,
          viewCount,
          likeCount: Number(row.like_count || 0),
          commentCount: Number(row.comment_count || 0),
          day: daysSince(publishedRef, new Date(row.snapshot_at)),
          gain: prevViews === null ? null : Math.max(viewCount - prevViews, 0)
        }
      })
      // 점이 너무 많으면 앞부분만 솎고, 마지막 두 개는 진짜 기록 그대로 남긴다("최근 속도" 계산이 정확하도록).
      const snapshots = [...downsample(full.slice(0, -2), CHART_POINTS - 2), ...full.slice(-2)]

      return cachedJson({
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
        totalSnapshots: snap.total,
        sampled: snapshots.length < snap.total,
        enough: snap.total >= 2
      })
    }

    const [videos, staff] = await Promise.all([
      loadScopedVideos(supabaseAdmin, {
        isAdmin,
        selfUserId: profile.id,
        staffId: isAdmin ? staffId : null,
        limit: 300,
        fields: VIDEO_FIELDS_LIST
      }),
      isAdmin ? loadStaffUsers(supabaseAdmin) : Promise.resolve([])
    ])

    const countByVideo = await loadSnapshotCounts(
      supabaseAdmin,
      videos.slice(0, COUNT_LIMIT).map((v) => v.id)
    )

    const items = videos.map((v, index) => ({
      id: v.id,
      title: v.title || v.stock_name || '(제목 없음)',
      stockName: v.stock_name,
      contentType: v.content_type,
      viewCount: v.view_count,
      publishedAt: v.published_at,
      youtubeUrl: v.youtube_url,
      // 개수를 세지 않은 영상은 null (화면에서는 개수 표시를 생략)
      snapshotCount: index < COUNT_LIMIT ? countByVideo.get(v.id) || 0 : null
    }))

    return cachedJson({ items, staffOptions: staff.map((s) => ({ id: s.id, name: s.name })) })
  } catch (e) {
    return apiError(e, '조회수 기록을 불러오지 못했어요.')
  }
}
