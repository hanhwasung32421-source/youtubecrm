import { NextResponse } from 'next/server'
import { getSession, handleRouteError, loadUserMap, loadVideoOptions } from '@/lib/v5/api'

// 실험 대상 영상 / 플레이북 예시 영상 선택용 검색.
// ?q= 종목명·제목 검색(없으면 최근 등록순), 최대 60개. 전체 목록은 내려보내지 않는다.
export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    const { supabaseAdmin } = session
    const q = new URL(request.url).searchParams.get('q') || ''
    const videos = await loadVideoOptions(supabaseAdmin, { q, limit: 60 })
    const userMap = await loadUserMap(supabaseAdmin, videos.map((v) => v.primary_owner_user_id))
    const items = videos.map((v) => ({ ...v, owner_name: v.primary_owner_user_id ? userMap.get(v.primary_owner_user_id) || null : null }))
    return NextResponse.json({ items })
  } catch (e) {
    return handleRouteError(e, '영상 목록을 불러오지 못했어요.')
  }
}
