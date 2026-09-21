import { ApiFail, apiError, authenticate, chunk, cleanText, isUuid, loadVideosByIds, noStoreJson, readJson } from '@/lib/v3/server'
import { assertCanMove, assertNameFree, assertOwnVideos, loadMemberships } from '@/lib/v3/series-access'
import { V3_TABLES } from '@/lib/v3/tables'
import { timeMs } from '@/lib/v3/engagement'

const MAX_INITIAL_VIDEOS = 100

// 새 시리즈 생성 + 초기 영상 묶기
//   body: { name (필수), stockName?, videoIds? }
export async function POST(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const body = ((await readJson(request)) || {}) as { name?: unknown; stockName?: unknown; videoIds?: unknown }
    const name = cleanText(body.name, 200, '시리즈 이름')
    if (!name) throw new ApiFail(400, '시리즈 이름을 입력해 주세요.')
    const stockName = cleanText(body.stockName, 100, '종목')

    let videoIds: string[] = []
    if (body.videoIds !== undefined && body.videoIds !== null) {
      if (!Array.isArray(body.videoIds) || !body.videoIds.every(isUuid)) throw new ApiFail(400, '묶을 영상을 다시 골라 주세요.')
      videoIds = Array.from(new Set(body.videoIds as string[]))
      if (videoIds.length > MAX_INITIAL_VIDEOS) throw new ApiFail(400, `한 번에 ${MAX_INITIAL_VIDEOS}개까지만 묶을 수 있어요. 나머지는 만든 뒤에 추가해 주세요.`)
    }

    await assertNameFree(supabaseAdmin, name)

    // 영상이 실제로 있는지, 내 영상인지, 다른 시리즈에서 옮겨도 되는지 미리 확인한다.
    let movedCount = 0
    let previous: { video_id: string; series_id: string }[] = []
    // 시리즈 안의 순서는 added_at 으로 정한다. 올린 날짜가 이른 영상이 앞에 오도록 1밀리초씩 차이를 둔다.
    let orderedIds = videoIds
    if (videoIds.length > 0) {
      const videos = await loadVideosByIds(supabaseAdmin, videoIds)
      if (videos.length !== videoIds.length) throw new ApiFail(404, '일부 영상을 찾을 수 없어요. 화면을 새로 고친 뒤 다시 골라 주세요.')
      assertOwnVideos(videos, profile, isAdmin)
      const memberships = await loadMemberships(supabaseAdmin, videoIds)
      assertCanMove(memberships, null, profile, isAdmin)
      movedCount = memberships.length
      previous = memberships.map((m) => ({ video_id: m.video_id, series_id: m.series_id }))
      orderedIds = [...videos].sort((x, y) => (timeMs(x.published_at || x.created_at) || 0) - (timeMs(y.published_at || y.created_at) || 0) || x.id.localeCompare(y.id)).map((v) => v.id)
    }

    const { data: series, error: seriesError } = await supabaseAdmin
      .from(V3_TABLES.videoSeries)
      .insert({ name, stock_name: stockName, created_by: profile.id })
      .select('id, name, stock_name, created_at')
      .single()
    if (seriesError) throw seriesError

    if (orderedIds.length > 0) {
      const baseMs = Date.now()
      // video_id 는 unique → 이미 다른 시리즈에 있던 영상은 이쪽으로 옮겨진다(위에서 권한 확인 완료).
      for (const [chunkIndex, part] of chunk(orderedIds, 50).entries()) {
        const { error: memberError } = await supabaseAdmin
          .from(V3_TABLES.videoSeriesMembers)
          .upsert(
            part.map((videoId, i) => ({ series_id: series.id, video_id: videoId, added_at: new Date(baseMs + chunkIndex * 50 + i).toISOString() })),
            { onConflict: 'video_id' }
          )
        if (memberError) {
          // 반쪽짜리 시리즈가 남지 않도록 방금 만든 시리즈를 되돌린다.
          await supabaseAdmin.from(V3_TABLES.videoSeries).delete().eq('id', series.id)
          // 다른 시리즈에서 옮겨 오던 영상은 원래 시리즈로 돌려놓는다.
          if (previous.length > 0) await supabaseAdmin.from(V3_TABLES.videoSeriesMembers).upsert(previous, { onConflict: 'video_id' })
          throw memberError
        }
      }
    }

    return noStoreJson({ ok: true, series: { id: series.id, name: series.name, stockName: series.stock_name }, moved: movedCount })
  } catch (e) {
    return apiError(e, '시리즈를 만들지 못했어요.', { duplicate: '같은 이름의 시리즈가 이미 있어요.' })
  }
}
