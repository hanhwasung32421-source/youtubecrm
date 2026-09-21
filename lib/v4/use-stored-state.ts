'use client'

// 마지막에 고른 기간/필터를 브라우저에 기억하는 useState.
// - 저장소 접근이 막혀 있어도(시크릿 모드 등) 조용히 기본값으로 동작한다.
// - 첫 렌더는 항상 기본값 → 마운트 직후 저장값을 읽는다. ready 가 true 가 된 뒤에 데이터를 불러오면
//   기본값으로 한 번, 저장값으로 또 한 번 불러오는 낭비와 화면 깜빡임을 피할 수 있다.

import { useCallback, useEffect, useRef, useState } from 'react'

export function useStoredState<T extends string | number | boolean>(
  key: string,
  initial: T,
  validate?: (value: unknown) => value is T
): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [ready, setReady] = useState(false)
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown
        if (typeof parsed === typeof initial && (!validate || validate(parsed))) setValue(parsed as T)
      }
    } catch {
      // 저장값이 없거나 망가져 있으면 기본값 유지
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = useCallback((next: T) => {
    setValue(next)
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(next))
    } catch {
      // 저장 실패는 무시
    }
  }, [])

  return [value, set, ready]
}

export function isPeriodValue(value: unknown): value is 7 | 30 | 90 {
  return value === 7 || value === 30 || value === 90
}
