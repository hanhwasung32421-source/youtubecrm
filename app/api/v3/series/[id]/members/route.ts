import { ApiFail, apiError, authenticate, chunk, isUuid, loadVideosByIds, noStoreJson, readJson, requireUuid } from '@/lib/v3/server'
import { assertCanEditSeries, assertCanMove, assertOwnVideos, loadMemberships, loadSeriesById } from '@/lib/v3/series-access'
import { V3_TABLES } from '@/lib/v3/tables'
import { mergeOrder, orderTimestamps } from '@/lib/v3/series-logic'

const MAX_MEMBERS = 500

// 시리즈에 영상 추가. 영상은 한 시리즈에만 속할 수 있어서,
// 이미 다른 시리즈에 있으면 "옮기기"로 처리한다(내가 고칠 수 있는 시리즈에서만).
//   응답: { ok, already?: true, moved?: true, fromSeriesName? }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const id = requireUuid((await context.params).id, '시리즈')
    const body = ((await readJson(request)) || {}) as { videoId?: unknown }
    const videoId = requireUuid(body.videoId, '영상')

    const series = await loadSeriesById(supabaseAdmin, id)
    assertCanEditSeries(series, profile, isAdmin)

    const [video] = await loadVideosByIds(supabaseAdmin, [videoId])
    if (!video) throw new ApiFail(404, '영상을 찾을 수 없어요. 삭제되었을 수 있어요. 화면을 새로 고쳐 주세요.')
    assertOwnVideos([video], profile, isAdmin)

    const [current] = await loadMemberships(supabaseAdmin, [videoId])
    if (current && current.series_id === id) return noStoreJson({ ok: true, already: true })
    if (current) assertCanMove([current], id, profile, isAdmin)

    const { error } = await supabaseAdmin.from(V3_TABLES.videoSeriesMembers).upsert({ series_id: id, video_id: videoId, added_at: new Date().toISOString() }, { onConflict: 'video_id' })
    if (error) throw error

    return noStoreJson(current ? { ok: true, moved: true, fromSeriesName: current.seriesName } : { ok: true })
  } catch (e) {
    return apiError(e, '시리즈에 영상을 추가하지 못했어요.', { reference: '시리즈나 영상을 찾을 수 없어요. 화면을 새로 고친 뒤 다시 시도해 주세요.' })
  }
}

// 시리즈에서 영상 제외(영상 자체는 그대로 남는다). 이미 빠져 있어도 성공으로 본다.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const id = requireUuid((await context.params).id, '시리즈')
    const body = ((await readJson(request)) || {}) as { videoId?: unknown }
    const videoId = requireUuid(body.videoId ?? new URL(request.url).searchParams.get('videoId'), '영상')

    const series = await loadSeriesById(supabaseAdmin, id)
    assertCanEditSeries(series, profile, isAdmin)

    const { error } = await supabaseAdmin.from(V3_TABLES.videoSeriesMembers).delete().eq('series_id', id).eq('video_id', videoId)
    if (error) throw error

    return noStoreJson({ ok: true })
  } catch (e) {
    return apiError(e, '시리즈에서 영상을 빼지 못했어요.')
  }
}

// 시리즈 안의 영상 순서 저장. 순서는 시리즈에 넣은 시각(added_at)에 담는다.
//   body: { videoIds: string[] }  ← 원하는 순서. 빠졌거나 그사이 추가된 영상은 원래 순서대로 뒤에 붙고, 이미 빠진 영상은 무시한다.
//   응답: { ok, videoIds }  ← 저장된 최종 순서
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const id = requireUuid((await context.params).id, '시리즈')
    const body = ((await readJson(request)) || {}) as { videoIds?: unknown }
    if (!Array.isArray(body.videoIds) || body.videoIds.length > MAX_MEMBERS || !body.videoIds.every(isUuid)) {
      throw new ApiFail(400, '바꿀 순서를 다시 확인해 주세요. 화면을 새로 고친 뒤 다시 시도해 주세요.')
    }

    const series = await loadSeriesById(supabaseAdmin, id)
    assertCanEditSeries(series, profile, isAdmin)

    const { data, error } = await supabaseAdmin.from(V3_TABLES.videoSeriesMembers).select('video_id, added_at').eq('series_id', id).order('added_at', { ascending: true }).limit(MAX_MEMBERS)
    if (error) throw error
    const current = ((data || []) as { video_id: string }[]).map((row) => row.video_id)
    const finalOrder = mergeOrder(current, body.videoIds as string[])
    const stamps = orderTimestamps(finalOrder.length, Date.now())

    // 영상마다 시각만 고친다. (upsert 를 쓰면 그사이 빠진 영상이 되살아날 수 있어서 개별 수정으로 한다)
    for (const part of chunk(finalOrder.map((videoId, i) => ({ videoId, at: stamps[i] })), 25)) {
      const results = await Promise.all(part.map((row) => supabaseAdmin.from(V3_TABLES.videoSeriesMembers).update({ added_at: row.at }).eq('series_id', id).eq('video_id', row.videoId)))
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
    }

    return noStoreJson({ ok: true, videoIds: finalOrder })
  } catch (e) {
    return apiError(e, '순서를 저장하지 못했어요.')
  }
}
