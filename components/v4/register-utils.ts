// 영상 등록 화면 전용 도우미 (React 의존 없음).
// - 붙여넣은 주소를 정리(앞뒤 공백 제거, 문장 속 링크 추출, https:// 보정)
// - 영상 고유 ID 추출 (중복 등록 안내용)
// - localStorage 읽기/쓰기는 항상 try/catch (사생활 보호 모드 등에서 실패할 수 있음)

const URL_IN_TEXT = /(https?:\/\/[^\s]+)|((?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s]+)/i

export function normalizeYoutubeUrl(raw: string) {
  const text = (raw || '').trim()
  if (!text) return ''
  const match = text.match(URL_IN_TEXT)
  let candidate = (match ? match[0] : text).trim()
  // 문장 끝에 붙은 문장부호 제거
  candidate = candidate.replace(/[)\]}>.,;'"”’]+$/, '')
  if (!/^https?:\/\//i.test(candidate) && /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(candidate)) {
    candidate = `https://${candidate}`
  }
  return candidate
}

export function isYoutubeUrl(value: string) {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === 'youtu.be'
  } catch {
    return false
  }
}

export function extractVideoId(value: string) {
  try {
    const url = new URL(value.trim())
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || ''
    const v = url.searchParams.get('v')
    if (v) return v
    const m = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

export function isShortsUrl(value: string) {
  try {
    return /^\/shorts\//.test(new URL(value.trim()).pathname)
  } catch {
    return false
  }
}

export function normalizeStockName(value: string) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

// KST 기준 오늘 날짜 (YYYY-MM-DD)
export function todayKst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// 다음 한국 시간 0시까지 남은 밀리초 (한국은 서머타임이 없어서 UTC+9 고정). 정각이면 24시간 뒤를 돌려준다.
export function msUntilNextKstMidnight(nowMs: number) {
  const DAY = 24 * 60 * 60 * 1000
  const shifted = nowMs + 9 * 60 * 60 * 1000
  return DAY - (((shifted % DAY) + DAY) % DAY)
}

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 저장이 막힌 환경이면 그냥 넘어간다 (기능은 계속 동작).
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readStorage(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
