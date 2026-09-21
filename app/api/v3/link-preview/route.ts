import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api/error-response'
import { extractYoutubeVideoId } from '@/lib/youtube/api'
import { authenticate, loadActiveYoutubeApiKey } from '@/lib/v3/server'
import { lookupYoutubeVideo, type LookupCode } from './youtube-lookup'

// 영상 등록 폼의 "이 영상이 맞나요?" 미리보기용. URL만으로 제목/썸네일/채널을 먼저 보여주고,
// 실제 저장은 여전히 공용 POST /api/videos/create 가 담당한다(등록 시 다시 한 번 조회해 저장).
//
// 응답 규칙(화면이 원인을 알아볼 수 있게):
//  - 성공: { title, channelName, thumbnailUrl, publishedAt, viewCount, durationSeconds }
//  - 미리보기를 못 만들 때: { error: 한글 안내, code } (HTTP 200 — 등록 자체는 막지 않는다)
//      code = 'no-key' | 'not-found' | 'quota' | 'key' | 'unknown'
//  - 주소가 잘못됐으면 400 { error, code: 'bad-url' }
const MESSAGES: Record<LookupCode | 'no-key', string> = {
  'no-key': '유튜브 연결이 꺼져 있어 미리보기를 만들 수 없어요. 등록은 그대로 하실 수 있어요.',
  'not-found': '유튜브에서 이 영상을 찾지 못했어요. 삭제됐거나 비공개일 수 있어요.',
  quota: '오늘 유튜브 조회 한도를 다 써서 영상 정보를 확인할 수 없어요.',
  key: '유튜브 연결 설정에 문제가 있어 영상 정보를 확인할 수 없어요.',
  unknown: '지금은 영상 정보를 확인할 수 없어요. 등록은 그대로 하실 수 있어요.'
}

export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response

  try {
    const url = new URL(request.url).searchParams.get('url') || ''
    const videoId = extractYoutubeVideoId(url)
    if (!videoId) {
      return NextResponse.json({ error: '유효한 유튜브 영상 주소가 아닙니다.', code: 'bad-url' }, { status: 400 })
    }

    const apiKey = await loadActiveYoutubeApiKey(auth.supabaseAdmin)
    if (!apiKey) return NextResponse.json({ error: MESSAGES['no-key'], code: 'no-key' }, { status: 200 })

    const result = await lookupYoutubeVideo(videoId, apiKey)
    if (!result.ok) return NextResponse.json({ error: MESSAGES[result.code], code: result.code }, { status: 200 })

    const { meta } = result
    return NextResponse.json({
      title: meta.title,
      channelName: meta.channelName,
      thumbnailUrl: meta.thumbnailUrl,
      publishedAt: meta.publishedAt,
      viewCount: meta.viewCount,
      durationSeconds: meta.durationSeconds
    })
  } catch (e) {
    return errorResponse(e, '미리보기를 불러오지 못했습니다.')
  }
}
