import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { errorResponse } from '@/lib/api/error-response'
import { TABLES } from '@/lib/supabase/tables'

// 내가 등록한 영상 한 건 고치기(PATCH) / 지우기(DELETE) / 메모 읽기(GET).
// 본인이 등록한 영상이거나 관리자일 때만 허용한다.
// DELETE 에 ?createdAfter=<시각> 이 붙어 있으면(등록 직후 "되돌리기"), 그 시각보다 먼저 만들어진 영상은 지우지 않는다.

type Params = { params: Promise<{ id: string }> }

const idSchema = z.string().uuid()

const patchSchema = z
  .object({
    stock_name: z.string().trim().min(1, '종목명을 적어 주세요.').max(60, '종목명이 너무 길어요.').optional(),
    content_type: z.enum(['longform', 'shortform'], { message: '형식은 롱폼 또는 숏폼이어야 해요.' }).optional(),
    content_category: z.string().trim().max(200, '메모는 200자까지 적을 수 있어요.').nullable().optional()
  })
  .strict()

function isAdminRole(roleType: string) {
  return roleType === 'super_admin' || roleType === 'admin'
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function handleError(e: unknown, fallback: string) {
  const issues = (e as { issues?: { message?: string }[] })?.issues
  if (issues?.[0]?.message) return fail(issues[0].message, 400)
  if (e instanceof Error && /로그인이 필요|프로필을 찾을 수 없/.test(e.message)) return fail(e.message, 401)
  return errorResponse(e, fallback)
}

async function loadOwned(request: Request, context: Params) {
  const { id } = await context.params
  if (!idSchema.safeParse(id).success) return { error: fail('영상을 찾을 수 없어요.', 404) } as const

  const { profile, supabaseAdmin } = await getProfileByAccessToken(getBearerToken(request))
  const { data: video, error } = await supabaseAdmin
    .from(TABLES.videos)
    .select('id, stock_name, content_type, content_category, primary_owner_user_id, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error) return { error: errorResponse(error, '영상을 불러오지 못했어요.') } as const
  if (!video) return { error: fail('영상을 찾을 수 없어요. 이미 삭제됐을 수 있어요.', 404) } as const
  if (video.primary_owner_user_id !== profile.id && !isAdminRole(profile.role_type)) {
    return { error: fail('내가 등록한 영상만 고치거나 지울 수 있어요.', 403) } as const
  }
  return { id, video, supabaseAdmin } as const
}

export async function GET(request: Request, context: Params) {
  try {
    const ctx = await loadOwned(request, context)
    if ('error' in ctx) return ctx.error
    return NextResponse.json({
      ok: true,
      item: { id: ctx.video.id, stock_name: ctx.video.stock_name, content_type: ctx.video.content_type, content_category: ctx.video.content_category ?? null }
    })
  } catch (e) {
    return handleError(e, '영상을 불러오지 못했어요.')
  }
}

export async function PATCH(request: Request, context: Params) {
  try {
    const patch = patchSchema.parse(await request.json().catch(() => ({})))
    if (Object.keys(patch).length === 0) return fail('바꿀 내용이 없어요.', 400)

    const ctx = await loadOwned(request, context)
    if ('error' in ctx) return ctx.error

    const update: Record<string, unknown> = {}
    if (patch.stock_name !== undefined) update.stock_name = patch.stock_name.replace(/\s+/g, ' ')
    if (patch.content_type !== undefined) update.content_type = patch.content_type
    if (patch.content_category !== undefined) update.content_category = patch.content_category || null

    const { data, error } = await ctx.supabaseAdmin
      .from(TABLES.videos)
      .update(update)
      .eq('id', ctx.id)
      .select('id, stock_name, content_type, content_category')
      .single()
    if (error) return errorResponse(error, '수정하지 못했어요.')
    return NextResponse.json({ ok: true, item: data })
  } catch (e) {
    return handleError(e, '수정하지 못했어요.')
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const ctx = await loadOwned(request, context)
    if ('error' in ctx) return ctx.error

    const guard = new URL(request.url).searchParams.get('createdAfter')
    if (guard !== null) {
      const guardMs = Date.parse(guard)
      const createdMs = Date.parse(String(ctx.video.created_at ?? ''))
      // 서버 시계 차이를 감안해 5초의 여유를 둔다. 만든 시각을 알 수 없으면 안전하게 지우지 않는다.
      if (Number.isNaN(guardMs) || Number.isNaN(createdMs) || createdMs < guardMs - 5000) {
        return fail('이 영상은 이번에 새로 만든 것이 아니라서 지우지 않았어요. 필요하면 목록에서 「삭제」를 눌러 주세요.', 409)
      }
    }

    // 이 영상을 가리키던 다른 기록은 DB 설정(CASCADE / SET NULL)에 따라 함께 정리된다.
    const { error } = await ctx.supabaseAdmin.from(TABLES.videos).delete().eq('id', ctx.id)
    if (error) return errorResponse(error, '삭제하지 못했어요.')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e, '삭제하지 못했어요.')
  }
}
