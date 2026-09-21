// localStorage는 시크릿 창·차단 설정에서 던질 수 있으므로 항상 try/catch로 감싼다.
// (저장이 안 돼도 화면 동작에는 영향이 없다. 비밀번호 같은 민감한 값은 절대 여기에 넣지 않는다.)

export function readSafe(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeSafe(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 무시
  }
}

// 마지막으로 로그인한 아이디(이메일 또는 아이디). 비밀번호는 저장하지 않는다.
export const LAST_LOGIN_ID_KEY = 'v3.login.lastId'
