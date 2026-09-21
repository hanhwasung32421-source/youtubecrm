'use client'

import { useCallback, useEffect, useState } from 'react'

// 마지막에 고른 필터를 브라우저에 기억해 두는 작은 훅.
// 서버 렌더링 결과와 어긋나지 않도록 처음엔 기본값으로 그리고, 마운트 뒤에 저장된 값으로 바꾼다.
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

export function useRememberedState<T extends string>(key: string, initial: T, allowed?: readonly T[]): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial)

  useEffect(() => {
    const saved = readRemembered(key)
    if (saved === null) return
    if (allowed && !allowed.includes(saved as T)) return
    setValue(saved as T)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback(
    (next: T) => {
      setValue(next)
      writeRemembered(key, next)
    },
    [key]
  )

  return [value, update]
}
