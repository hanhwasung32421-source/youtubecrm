import { NextResponse } from 'next/server'
import { badRequest, getSession, handleRouteError, loadUserMap, loadVideoOptions, loadVideosByIds, uuidSchema, type VideoOptionRow } from '@/lib/v5/api'

// 실험 대상 영상 / 플레이북 예시 영상 선택용 검색.
// ?q= 종목명·제목 검색(없으면 최근 등록순), 최대 60개. 전체 목록은 내려보내지 않는다.
// ?id= 영상 하나를 id 로 찾는다(점수판의 "이 영상으로 실험 만들기" 링크가 폼을 미리 채울 때 쓴다). 없으면 items 가 빈 배열.
export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    const { supabaseAdmin } = session
    const search = new URL(request.url).searchParams
    const id = search.get('id')

    let videos: VideoOptionRow[]
    if (id) {
      if (!uuidSchema.safeParse(id).success) return badRequest('영상을 찾을 수 없어요.')
      videos = await loadVideosByIds<VideoOptionRow>(supabaseAdmin, [id], 'id, title, stock_name, content_type, published_at, view_count, primary_owner_user_id, created_at')
    } else {
      videos = await loadVideoOptions(supabaseAdmin, { q: search.get('q') || '', limit: 60 })
    }
    const userMap = await loadUserMap(supabaseAdmin, videos.map((v) => v.primary_owner_user_id))
    const items = videos.map((v) => ({ ...v, owner_name: v.primary_owner_user_id ? userMap.get(v.primary_owner_user_id) || null : null }))
    return NextResponse.json({ items })
  } catch (e) {
    return handleRouteError(e, '영상 목록을 불러오지 못했어요.')
  }
}
