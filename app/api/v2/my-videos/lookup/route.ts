import { NextResponse } from 'next/server'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { errorResponse } from '@/lib/api/error-response'
import { TABLES } from '@/lib/supabase/tables'

// 영상 등록 직전 확인: 이 유튜브 영상이 이미 등록돼 있는지, 있다면 내 것인지 알려 준다.
// 등록 화면은 이 결과로 "방금 새로 만든 영상인지"를 확실히 알 때만 되돌리기(삭제)를 열어 준다.
// serverNow 는 서버 시계 기준 시각이라, 되돌리기 삭제가 "이 시각 이후에 만들어진 영상만" 지우도록 확인하는 데 쓴다.

const VIDEO_ID = /^[\w-]{11}$/

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
  try {
    const videoId = new URL(request.url).searchParams.get('videoId') || ''
    if (!VIDEO_ID.test(videoId)) return fail('유튜브 영상 주소를 다시 확인해 주세요.', 400)

    const { profile, supabaseAdmin } = await getProfileByAccessToken(getBearerToken(request))
    const { data, error } = await supabaseAdmin
      .from(TABLES.videos)
      .select('id, stock_name, content_type, created_at, primary_owner_user_id')
      .eq('youtube_video_id', videoId)
      .limit(1)
    if (error) return errorResponse(error, '영상을 확인하지 못했어요.')

    const serverNow = new Date().toISOString()
    const video = data?.[0]
    if (!video) return NextResponse.json({ ok: true, exists: false, serverNow })

    return NextResponse.json({
      ok: true,
      exists: true,
      mine: video.primary_owner_user_id === profile.id,
      item: { id: video.id, stock_name: video.stock_name, content_type: video.content_type, created_at: video.created_at },
      serverNow
    })
  } catch (e) {
    if (e instanceof Error && /로그인이 필요|프로필을 찾을 수 없/.test(e.message)) return fail(e.message, 401)
    return errorResponse(e, '영상을 확인하지 못했어요.')
  }
}
