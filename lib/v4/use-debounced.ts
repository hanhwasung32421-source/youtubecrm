'use client'

import { useEffect, useState } from 'react'

// 입력값이 멈춘 뒤 ms 가 지나야 바뀌는 값. 검색창에서 글자마다 서버에 묻지 않기 위해 쓴다.
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (Object.is(value, debounced)) return
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms, debounced])
  return debounced
}
