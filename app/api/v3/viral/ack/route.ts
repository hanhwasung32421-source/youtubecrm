import { ApiFail, apiError, authenticate, cleanText, loadVideosByIds, noStoreJson, readJson, requireUuid, type Profile, type SupabaseAdmin } from '@/lib/v3/server'
import { V3_TABLES } from '@/lib/v3/tables'

// 급상승 영상의 "확인했어요" 기록. 영상 1개에는 확인 기록이 1개만 남는다(다시 누르면 메모/시간만 바뀜).
//   POST   { videoId, actionNote? } → 확인 표시(이미 있으면 메모 수정)
//   PATCH  { videoId, actionNote? } → 메모만 수정(확인 기록이 없으면 404)
//   DELETE { videoId } 또는 ?videoId= → 확인 취소
// 직원은 본인이 등록한 영상만, 관리자는 모든 영상을 처리할 수 있다.

async function assertCanTouch(supabaseAdmin: SupabaseAdmin, profile: Profile, isAdmin: boolean, videoId: string) {
  const [video] = await loadVideosByIds(supabaseAdmin, [videoId])
  if (!video) throw new ApiFail(404, '영상을 찾을 수 없어요. 삭제되었을 수 있어요. 화면을 새로 고쳐 주세요.')
  if (!isAdmin && video.primary_owner_user_id !== profile.id) throw new ApiFail(403, '내가 등록한 영상만 확인 표시를 할 수 있어요.')
}

async function loadExistingAcks(supabaseAdmin: SupabaseAdmin, videoId: string) {
  const { data, error } = await supabaseAdmin
    .from(V3_TABLES.viralSignalAcks)
    .select('id, created_at')
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as { id: string; created_at: string }[]
}

async function saveAck(request: Request, mode: 'upsert' | 'edit') {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const body = ((await readJson(request)) || {}) as { videoId?: unknown; actionNote?: unknown }
    const videoId = requireUuid(body.videoId, '영상')
    const actionNote = cleanText(body.actionNote, 200, '메모')

    await assertCanTouch(supabaseAdmin, profile, isAdmin, videoId)

    const existing = await loadExistingAcks(supabaseAdmin, videoId)
    const nowIso = new Date().toISOString()

    if (existing.length > 0) {
      const [keep, ...extra] = existing
      const patch: Record<string, unknown> = { action_note: actionNote }
      if (mode === 'upsert') {
        patch.acknowledged_by = profile.id
        patch.created_at = nowIso
      }
      const { error } = await supabaseAdmin.from(V3_TABLES.viralSignalAcks).update(patch).eq('id', keep.id)
      if (error) throw error
      // 예전에 중복으로 쌓인 기록이 있으면 정리한다.
      if (extra.length > 0) {
        await supabaseAdmin
          .from(V3_TABLES.viralSignalAcks)
          .delete()
          .in(
            'id',
            extra.map((row) => row.id)
          )
      }
    } else {
      if (mode === 'edit') throw new ApiFail(404, '확인 기록이 없어요. 화면을 새로 고쳐 주세요.')
      const { error } = await supabaseAdmin.from(V3_TABLES.viralSignalAcks).insert({
        video_id: videoId,
        acknowledged_by: profile.id,
        action_note: actionNote
      })
      if (error) throw error
    }

    return noStoreJson({ ok: true, ack: { actionNote, at: mode === 'edit' && existing[0] ? existing[0].created_at : nowIso, byName: profile.name } })
  } catch (e) {
    return apiError(e, '확인 표시를 저장하지 못했어요.', { reference: '영상을 찾을 수 없어요. 화면을 새로 고친 뒤 다시 시도해 주세요.' })
  }
}

export async function POST(request: Request) {
  return saveAck(request, 'upsert')
}

export async function PATCH(request: Request) {
  return saveAck(request, 'edit')
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const body = ((await readJson(request)) || {}) as { videoId?: unknown }
    const videoId = requireUuid(body.videoId ?? new URL(request.url).searchParams.get('videoId'), '영상')

    await assertCanTouch(supabaseAdmin, profile, isAdmin, videoId)

    // 이미 지워진 뒤 다시 눌러도 성공으로 본다.
    const { error } = await supabaseAdmin.from(V3_TABLES.viralSignalAcks).delete().eq('video_id', videoId)
    if (error) throw error

    return noStoreJson({ ok: true })
  } catch (e) {
    return apiError(e, '확인 취소에 실패했어요.')
  }
}
