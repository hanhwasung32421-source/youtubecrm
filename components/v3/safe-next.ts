// 로그인 뒤 돌아갈 곳(?next=)을 안전하게 걸러낸다.
// 우리 화면(/v3/…)의 경로만 허용해서, 다른 사이트로 보내는 주소(오픈 리다이렉트)를 막는다.
// 순수 함수라서 화면 없이 시험할 수 있다.

const MAX_LENGTH = 300
// 로그인·가입 화면으로 다시 보내면 제자리를 맴돌기만 하므로 돌아갈 곳으로 쓰지 않는다.
const AUTH_PAGES = ['/v3/login', '/v3/signup']

function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 32 || code === 127 || code === 92) return true // 제어문자, 공백, 역슬래시
  }
  return false
}

export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > MAX_LENGTH) return null
  if (!value.startsWith('/v3/')) return null // "/v3" 만 있거나 다른 경로, 다른 사이트 주소는 모두 거절
  if (hasUnsafeChar(value)) return null // 줄바꿈·공백·역슬래시(브라우저가 슬래시로 읽는다)
  if (value.includes('//')) return null // "/v3//evil.com" 같은 모양

  // 주소 부분(경로)만 따로 봐서 "/v3/../admin" 처럼 밖으로 빠져나가는 모양을 막는다. (%2e%2e 도 함께)
  const path = value.split(/[?#]/)[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  if (/[\\\s]/.test(decoded) || decoded.includes('//')) return null
  if (decoded.split('/').some((part) => part === '..' || part === '.')) return null
  if (!decoded.startsWith('/v3/')) return null

  const lower = decoded.toLowerCase().replace(/\/+$/, '')
  if (AUTH_PAGES.includes(lower)) return null
  return value
}

// 로그인 화면 주소. 돌아올 곳이 안전할 때만 ?next= 를 붙인다.
export function loginHref(next?: string | null): string {
  const safe = safeNextPath(next)
  return safe ? `/v3/login?next=${encodeURIComponent(safe)}` : '/v3/login'
}
