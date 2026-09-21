'use client'

// 마지막에 고른 필터를 브라우저에 기억해 두는 작은 도우미.
// localStorage 가 막혀 있어도(시크릿 모드 등) 화면은 그대로 동작한다.
const PREFIX = 'v2:'

export function readRemembered(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function writeRemembered(key: string, value: string) {
  try {
    window.localStorage.setItem(PREFIX + key, value)
  } catch {
    // 저장이 안 돼도 화면 동작에는 영향이 없다.
  }
}
