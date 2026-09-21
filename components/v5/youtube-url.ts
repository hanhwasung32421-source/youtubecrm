// 유튜브 주소를 다루는 순수 도우미(다른 파일을 가져오지 않는다 → 단독으로 시험할 수 있다).
// register-utils.ts 가 이 파일의 함수를 그대로 다시 내보내므로 기존 import 경로는 그대로 동작한다.

const YOUTUBE_URL_RE = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i

export function findYoutubeUrl(text: string): string | null {
  const match = text.match(YOUTUBE_URL_RE)
  return match ? match[0] : null
}

// 붙여넣은 글에서 유튜브 주소만 뽑아 정리한다. 앞뒤 공백/줄바꿈 제거, https:// 없으면 붙여 준다.
export function normalizeUrl(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  const picked = findYoutubeUrl(text) ?? text.split(/\s+/)[0]
  return /^https?:\/\//i.test(picked) ? picked : `https://${picked}`
}

export function extractVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/)
  return m ? m[1] : null
}

export function isYoutubeUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|music)\./, '')
    return host === 'youtube.com' || host === 'youtu.be'
  } catch {
    return false
  }
}

export function isShortsUrl(url: string) {
  return /youtube\.com\/shorts\//i.test(url)
}

// 서버는 ?v= 형태와 youtu.be 형태만 알아보므로(/shorts/ · /live/ · /embed/ 는 인식 못 함),
// 서버로 보낼 때는 항상 이 표준 주소로 바꿔서 보낸다.
export function canonicalWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`
}

// 등록할 수 없는 주소일 때, "무엇이 문제이고 어떻게 하면 되는지"를 한 문장으로 알려 준다.
// 등록 가능한 주소(영상 하나를 가리키는 주소)면 빈 문자열.
export function describeUrlProblem(url: string): string {
  if (!url) return ''
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return '주소 모양이 올바르지 않아요. 유튜브 영상 주소를 처음부터 끝까지 다시 복사해 붙여 넣어 주세요.'
  }
  const host = parsed.hostname.replace(/^(www|m|music)\./i, '').toLowerCase()
  if (host !== 'youtube.com' && host !== 'youtu.be') {
    return '유튜브 주소가 아니에요. youtube.com 또는 youtu.be 로 시작하는 영상 주소를 붙여 넣어 주세요.'
  }
  if (extractVideoId(url)) return ''

  const path = parsed.pathname
  if (host === 'youtu.be') return '주소가 중간에 잘린 것 같아요. 영상 화면의 공유 → 링크 복사로 다시 복사해 주세요.'
  if (/^\/playlist/i.test(path)) return '재생목록 주소예요. 재생목록에서 영상 하나를 열고, 그 영상의 주소를 붙여 넣어 주세요.'
  if (/^\/(@|channel\/|c\/|user\/)/i.test(path)) return '채널 주소예요. 등록할 영상을 열고, 그 영상의 주소를 붙여 넣어 주세요.'
  if (/^\/shorts(\/|$)/i.test(path)) return '숏폼 주소가 짧거나 잘렸어요. 영상 화면의 공유 → 링크 복사로 다시 복사해 주세요.'
  if (/^\/(watch|live|embed)/i.test(path)) return '영상 번호가 없거나 잘린 주소예요. 주소창의 주소를 처음부터 끝까지 다시 복사해 주세요.'
  return '영상 하나를 가리키는 주소가 아니에요. 영상을 연 화면에서 주소를 복사해 붙여 넣어 주세요.'
}
