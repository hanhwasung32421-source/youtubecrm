import { NextResponse } from 'next/server'
import { z } from 'zod'
import { TABLES } from '@/lib/supabase/tables'
import { V2_TABLES } from '@/lib/v2/tables'
import { authedContext, forbidden, handleDbError, handleRouteError, isUuid } from '@/lib/v2/server'
import type { ThumbnailReview } from '@/lib/v2/types'

// 썸네일 클릭률 자가평가(1~5점) — 제목·썸네일 최적화 보드에서 사용.
// 평가는 여러 번 남길 수 있고 화면에는 가장 최근 것이 쓰인다. 잘못 남긴 최신 평가는 DELETE 로 지울 수 있다.
const createSchema = z.object({
  videoId: z.string().uuid('영상 정보가 올바르지 않아요. 화면을 새로고침해 주세요.'),
  rating: z.number().int('별점은 1~5점 중에서 골라 주세요.').min(1, '별점은 1~5점 중에서 골라 주세요.').max(5, '별점은 1~5점 중에서 골라 주세요.'),
  note: z.string().trim().max(300, '메모는 300자까지 적을 수 있어요.').optional().nullable()
})

const SELECT = 'id, video_id, rating, note, reviewed_by, created_at'

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json())
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)

    const { data: video, error: videoError } = await supabaseAdmin
      .from(TABLES.videos)
      .select('id, primary_owner_user_id')
      .eq('id', body.videoId)
      .maybeSingle()
    if (videoError) return handleDbError(videoError, '영상 정보를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    if (!video) return NextResponse.json({ error: '영상을 찾을 수 없어요. 화면을 새로고침해 주세요.' }, { status: 404 })
    if (!isAdmin && video.primary_owner_user_id !== profile.id) {
      return NextResponse.json({ error: '본인이 등록한 영상만 평가할 수 있어요.' }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from(V2_TABLES.thumbnailReviews)
      .insert({ video_id: body.videoId, rating: body.rating, note: body.note || null, reviewed_by: profile.id })
      .select(SELECT)
      .single()
    if (error || !data) return handleDbError(error, '썸네일 평가를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')

    return NextResponse.json({ ok: true, item: data as ThumbnailReview })
  } catch (e) {
    return handleRouteError(e, '썸네일 평가를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
}

// 평가 지우기: 평가를 남긴 본인 또는 관리자만. 이미 없으면 성공으로 본다.
export async function DELETE(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)
    const id = new URL(request.url).searchParams.get('id') || ''
    if (!isUuid(id)) return NextResponse.json({ error: '지울 평가를 찾지 못했어요. 화면을 새로고침해 주세요.' }, { status: 400 })

    const { data: existing, error: loadError } = await supabaseAdmin.from(V2_TABLES.thumbnailReviews).select('id, reviewed_by').eq('id', id).maybeSingle()
    if (loadError) return handleDbError(loadError, '평가를 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    if (!existing) return NextResponse.json({ ok: true })
    if (!isAdmin && existing.reviewed_by !== profile.id) return forbidden('본인이 남긴 평가만 지울 수 있어요.')

    const { error } = await supabaseAdmin.from(V2_TABLES.thumbnailReviews).delete().eq('id', id)
    if (error) return handleDbError(error, '평가를 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, '평가를 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
}
