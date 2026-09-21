'use client'

// 페이지별로 마지막에 고른 필터를 브라우저에 기억한다. (개인 브라우저 저장소가 막혀 있어도 화면은 정상 동작)

import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'v3:pref:'

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(PREFIX + key, value)
    else window.localStorage.removeItem(PREFIX + key)
  } catch {
    // 저장소를 못 쓰면 기억만 못 할 뿐이다.
  }
}

// 처음 렌더에서는 initial, 마운트 직후 저장된 값을 읽고 ready=true 가 된다.
// 저장된 값으로 데이터를 불러와야 하는 화면은 ready 가 된 뒤에 첫 요청을 보낸다(요청 2번 방지).
export function usePref(key: string, initial = ''): [string, (value: string) => void, boolean] {
  const [value, setValue] = useState(initial)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const saved = readPref(key)
    if (saved !== null) setValue(saved)
    setReady(true)
  }, [key])

  const update = useCallback(
    (next: string) => {
      setValue(next)
      writePref(key, next)
    },
    [key]
  )

  return [value, update, ready]
}
