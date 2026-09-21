import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api/error-response'
import { authenticate } from '@/lib/v3/server'
import { SHARED_TABLES } from '@/lib/v3/tables'

// 등록하기 전에 "이 영상, 이미 등록했나?"를 확인한다.  GET /api/v3/my-videos?videoId=<유튜브 영상 번호 11자>
//  - 없으면            { found: false }
//  - 내 것(또는 관리자)  { found: true, mine: true, video: { id, stock_name, content_type, content_category, created_at } }
//  - 다른 직원이 등록    { found: true, mine: false, registeredAt }   (자세한 내용은 알려 주지 않는다)
// 공용 등록 API는 같은 영상 번호로 다시 등록하면 덮어쓰고 담당자를 등록한 사람으로 바꾸므로,
// 화면이 미리 알려 줄 수 있도록 하는 조회다. 목록 화면(20개씩)과 달리 전체에서 정확히 찾는다.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

type Row = {
  id: string
  stock_name: string | null
  content_type: 'longform' | 'shortform'
  content_category: string | null
  created_at: string
  primary_owner_user_id: string | null
}

export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const videoId = new URL(request.url).searchParams.get('videoId') || ''
    if (!VIDEO_ID.test(videoId)) {
      return NextResponse.json({ error: '유튜브 영상 주소를 다시 확인해 주세요.' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from(SHARED_TABLES.videos)
      .select('id, stock_name, content_type, content_category, created_at, primary_owner_user_id')
      .eq('youtube_video_id', videoId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ found: false })

    const row = data as Row
    if (!isAdmin && row.primary_owner_user_id !== profile.id) {
      return NextResponse.json({ found: true, mine: false, registeredAt: row.created_at })
    }
    return NextResponse.json({
      found: true,
      mine: true,
      video: {
        id: row.id,
        stock_name: row.stock_name,
        content_type: row.content_type,
        content_category: row.content_category,
        created_at: row.created_at
      }
    })
  } catch (e) {
    return errorResponse(e, '등록 여부를 확인하지 못했어요.')
  }
}
