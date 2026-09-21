import { NextResponse } from 'next/server'
import { V5_TABLES } from '@/lib/v5/tables'
import { badRequest, getSession, handleRouteError, jsonNoStore, loadUserMap } from '@/lib/v5/api'

const PAGE_SIZE = 20

// 등록 화면용 목록. 공용 /api/videos/mine 과 같은 규칙(직원=내 영상, 관리자=전체)이지만
// 수정 화면에 필요한 메모(content_category)와 등록한 사람 이름을 함께 준다.
export async function GET(request: Request) {
  try {
    const { supabaseAdmin, profile, isAdmin } = await getSession(request)

    const url = new URL(request.url)

    // ?videoId=유튜브영상번호(11자): 이미 등록된 영상인지 한 건만 확인한다(등록 전 중복 안내용).
    // 내가 등록한 것이면 mine=true, 다른 팀원 것이면 mine=false 와 그 사람 이름을 준다.
    const lookupId = url.searchParams.get('videoId')
    if (lookupId !== null) {
      if (!/^[\w-]{11}$/.test(lookupId)) return badRequest('영상 번호가 올바르지 않아요. 주소를 다시 붙여 넣어 주세요.')
      const { data: found, error: lookupError } = await supabaseAdmin
        .from(V5_TABLES.videos)
        .select('id, stock_name, content_type, content_category, created_at, primary_owner_user_id')
        .eq('youtube_video_id', lookupId)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (!found) return jsonNoStore({ match: null })
      const row = found as { id: string; stock_name: string; content_type: string; content_category: string | null; created_at: string; primary_owner_user_id: string | null }
      const mine = row.primary_owner_user_id === profile.id
      let ownerName: string | null = null
      if (!mine && row.primary_owner_user_id) {
        const names = await loadUserMap(supabaseAdmin, [row.primary_owner_user_id])
        ownerName = names.get(row.primary_owner_user_id) || null
      }
      return jsonNoStore({
        match: {
          id: row.id,
          stock_name: row.stock_name,
          content_type: row.content_type,
          content_category: row.content_category,
          created_at: row.created_at,
          mine,
          owner_name: ownerName
        }
      })
    }

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
