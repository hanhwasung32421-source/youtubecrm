import { NextResponse } from 'next/server'
import { z } from 'zod'
import { TABLES } from '@/lib/supabase/tables'
import { V2_TABLES } from '@/lib/v2/tables'
import { authedContext, chunkIds, handleDbError, handleRouteError, isUuid, loadChecklistMap, mapLimit, noStoreJson, nowIso } from '@/lib/v2/server'
import { SEO_CHECKLIST_FIELDS, type SeoChecklist, type SeoChecklistsPayload } from '@/lib/v2/types'

// 등록 직후 & 최적화 보드에서 영상별 SEO 체크리스트를 읽고 토글한다.
const patchSchema = z.object({
  videoId: z.string().uuid('영상 정보가 올바르지 않아요. 화면을 새로고침해 주세요.'),
  patch: z
    .object({
      title_has_stock: z.boolean().optional(),
      thumbnail_text_checked: z.boolean().optional(),
      description_timestamps: z.boolean().optional(),
      tags_5plus: z.boolean().optional()
    })
    .default({})
})

const MAX_IDS = 300
const CHECKLIST_SELECT = 'video_id, title_has_stock, thumbnail_text_checked, description_timestamps, tags_5plus, updated_at'

export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)
    const url = new URL(request.url)
    let videoIds = (url.searchParams.get('videoIds') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(isUuid)
      .slice(0, MAX_IDS)

    if (videoIds.length === 0) {
      const payload: SeoChecklistsPayload = { items: [] }
      return NextResponse.json(payload)
    }

    // 직원은 본인이 등록한 영상의 체크리스트만 읽을 수 있다.
    if (!isAdmin) {
      const ownedChunks = await mapLimit(chunkIds(videoIds), 3, async (ids) => {
        const { data, error } = await supabaseAdmin.from(TABLES.videos).select('id').eq('primary_owner_user_id', profile.id).in('id', ids)
        if (error) throw error
        return (data || []) as { id: string }[]
      })
      videoIds = ownedChunks.flat().map((row) => row.id)
      if (videoIds.length === 0) return NextResponse.json({ items: [] } satisfies SeoChecklistsPayload)
    }

    const map = await loadChecklistMap(supabaseAdmin, videoIds)
    const payload: SeoChecklistsPayload = { items: [...map.values()] }
    return NextResponse.json(payload)
  } catch (e) {
    return handleRouteError(e, '체크리스트를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
}

export async function PATCH(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await authedContext(request)
    const body = patchSchema.parse(await request.json())

    const { data: video, error: videoError } = await supabaseAdmin
      .from(TABLES.videos)
      .select('id, primary_owner_user_id')
      .eq('id', body.videoId)
      .maybeSingle()
    if (videoError) return handleDbError(videoError, '영상 정보를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    if (!video) return NextResponse.json({ error: '영상을 찾을 수 없어요. 화면을 새로고침해 주세요.' }, { status: 404 })
    if (!isAdmin && video.primary_owner_user_id !== profile.id) {
      return NextResponse.json({ error: '본인이 등록한 영상만 체크리스트를 바꿀 수 있어요.' }, { status: 403 })
    }

    const patchColumns: Record<string, boolean> = {}
    for (const field of SEO_CHECKLIST_FIELDS) {
      if (body.patch[field] !== undefined) patchColumns[field] = body.patch[field] as boolean
    }

    const { data, error } = await supabaseAdmin
      .from(V2_TABLES.seoChecklists)
      .upsert({ video_id: body.videoId, ...patchColumns, updated_at: nowIso() }, { onConflict: 'video_id' })
      .select(CHECKLIST_SELECT)
      .single()
    if (error || !data) return handleDbError(error, '체크리스트를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')

    return noStoreJson({ ok: true, item: data as SeoChecklist })
  } catch (e) {
    return handleRouteError(e, '체크리스트를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
}
