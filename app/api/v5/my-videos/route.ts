import { NextResponse } from 'next/server'
import { V5_TABLES } from '@/lib/v5/tables'
import { getSession, handleRouteError, loadUserMap } from '@/lib/v5/api'

const PAGE_SIZE = 20

// 등록 화면용 목록. 공용 /api/videos/mine 과 같은 규칙(직원=내 영상, 관리자=전체)이지만
// 수정 화면에 필요한 메모(content_category)와 등록한 사람 이름을 함께 준다.
export async function GET(request: Request) {
  try {
    const { supabaseAdmin, profile, isAdmin } = await getSession(request)

    const url = new URL(request.url)
    const page = Math.max(Number(url.searchParams.get('page') || '1') || 1, 1)
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabaseAdmin
      .from(V5_TABLES.videos)
      .select(
        'id, title, stock_name, content_type, content_category, published_at, view_count, like_count, comment_count, youtube_url, created_at, primary_owner_user_id',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to)

    if (!isAdmin) query = query.eq('primary_owner_user_id', profile.id)

    const { data, error, count } = await query
    if (error) throw error

    const rows = (data || []) as Array<{ primary_owner_user_id: string | null } & Record<string, unknown>>
    let names = new Map<string, string>()
    if (isAdmin) names = await loadUserMap(supabaseAdmin, rows.map((r) => r.primary_owner_user_id))

    const items = rows.map((r) => ({
      ...r,
      owner_name: r.primary_owner_user_id ? names.get(r.primary_owner_user_id) || null : null
    }))

    return NextResponse.json({
      items,
      pagination: { page, pageSize: PAGE_SIZE, totalCount: count || 0 }
    })
  } catch (e) {
    return handleRouteError(e, '영상 목록 조회 실패')
  }
}
