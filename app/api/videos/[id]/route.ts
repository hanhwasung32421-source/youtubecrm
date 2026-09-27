import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { TABLES } from '@/lib/supabase/tables'
import { errorResponse } from '@/lib/api/error-response'

// 내가 등록한 영상 한 건을 고친다. 등록은 이제 주소만 넣으면 되고 종목명은
// 제목에서 자동으로 읽어내므로, 못 읽었거나 틀렸을 때 여기서 고친다.
// 본인이 등록한 영상이거나 관리자일 때만 허용한다.

type Params = { params: Promise<{ id: string }> }

const idSchema = z.string().uuid()

const patchSchema = z
  .object({
    stock_name: z.string().trim().min(1, '종목명을 입력해 주세요.').max(60, '종목명이 너무 길어요.').optional(),
    content_category: z.string().trim().max(200, '비고는 200자까지 적을 수 있어요.').nullable().optional()
  })
  .strict()

function isAdminRole(roleType: string) {
  return roleType === 'super_admin' || roleType === 'admin'
}

export async function PATCH(request: Request, context: Params) {
  try {
    const { id } = await context.params
    if (!idSchema.safeParse(id).success) {
      return NextResponse.json({ error: '잘못된 영상 주소입니다.' }, { status: 400 })
    }

    const patch = patchSchema.parse(await request.json())
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '바꿀 내용이 없습니다.' }, { status: 400 })
    }

    const { profile, supabaseAdmin } = await getProfileByAccessToken(getBearerToken(request))

    const { data: video, error: loadError } = await supabaseAdmin
      .from(TABLES.videos)
      .select('id, primary_owner_user_id')
      .eq('id', id)
      .maybeSingle()

    if (loadError) return errorResponse(loadError, '영상 조회 실패')
    if (!video) return NextResponse.json({ error: '영상을 찾을 수 없습니다. 이미 삭제됐을 수 있어요.' }, { status: 404 })
    if (video.primary_owner_user_id !== profile.id && !isAdminRole(profile.role_type)) {
      return NextResponse.json({ error: '내가 등록한 영상만 고칠 수 있습니다.' }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from(TABLES.videos)
      .update(patch)
      .eq('id', id)
      .select('id, title, stock_name, content_type, published_at, view_count, like_count, comment_count, youtube_url, created_at, youtube_account_id')
      .single()

    if (error || !data) return errorResponse(error, '영상 수정 실패')

    return NextResponse.json({ ok: true, video: data })
  } catch (e: any) {
    const firstIssue = e?.issues?.[0]
    if (firstIssue?.message) {
      return NextResponse.json({ error: firstIssue.message }, { status: 400 })
    }
    return errorResponse(e, '영상 수정 실패')
  }
}
