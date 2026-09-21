// 붙여넣은 유튜브 주소를 정리한다. 공유 API(POST /api/videos/create)는 watch?v=ID 와 youtu.be/ID 만
// 이해하므로, shorts/live/embed 주소와 공유 링크의 꼬리 파라미터(si, t, list)를 모두 watch?v=ID 로 통일한다.

export type NormalizedYoutubeUrl =
  | { ok: true; url: string; videoId: string; isShort: boolean }
  | { ok: false; empty: boolean }

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

export function normalizeYoutubeUrl(raw: string): NormalizedYoutubeUrl {
  // 보이지 않는 문자(폭 없는 공백 등) 제거 후 첫 번째 주소처럼 보이는 덩어리만 사용
  const cleaned = (raw || '').replace(/[​-‍﻿]/g, '').trim()
  if (!cleaned) return { ok: false, empty: true }

  const token = cleaned.split(/\s+/)[0]
  const withProtocol = /^https?:\/\//i.test(token) ? token : `https://${token}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    return { ok: false, empty: false }
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  let videoId = ''
  let isShort = false

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] || ''
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts[0] === 'shorts') {
      videoId = parts[1] || ''
      isShort = true
    } else if (parts[0] === 'live' || parts[0] === 'embed') {
      videoId = parts[1] || ''
    } else {
      videoId = parsed.searchParams.get('v') || ''
    }
  }

  if (!ID_PATTERN.test(videoId)) return { ok: false, empty: false }
  return { ok: true, url: `https://www.youtube.com/watch?v=${videoId}`, videoId, isShort }
}

// 이미 저장된 주소에서 영상 ID만 꺼낸다(오늘 등록 목록과 중복 여부를 비교할 때 사용).
export function videoIdFromStoredUrl(url: string | null | undefined): string {
  if (!url) return ''
  const result = normalizeYoutubeUrl(url)
  return result.ok ? result.videoId : ''
}

// localStorage는 시크릿 창·차단 설정에서 던질 수 있으므로 항상 try/catch로 감싼다.
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 저장이 안 돼도 등록 자체에는 영향이 없다.
  }
}
