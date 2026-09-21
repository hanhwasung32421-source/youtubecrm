'use client'

import { useCallback, useRef } from 'react'

// 매 렌더마다 새로 만들어지는 함수를 "늘 같은 함수"로 감싼다. 안에서는 항상 가장 최근 값을 쓴다.
// 무거운 자식(목록·표)에 넘겨서, 글자를 칠 때마다 자식이 다시 그려지지 않게 하는 용도.
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: Args) => ref.current(...args), [])
}
