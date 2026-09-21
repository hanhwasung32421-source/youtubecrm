'use client'

// 검색창 글자는 바로바로 보여주고, 입력이 멈춘 뒤(ms)에만 필터 값으로 확정하는 훅.
// - committed 가 바깥에서 바뀌면(필터 초기화, 링크로 이동 등) 입력칸 글자도 따라 바뀐다.
// - 확정한 값이 되돌아오는 경우에는 입력칸을 건드리지 않아, 글자를 치는 중에 덮어쓰이지 않는다.

import { useEffect, useRef, useState } from 'react'

export function useSearchField(committed: string, commit: (value: string) => void, ms = 300): [string, (text: string) => void] {
  const [text, setText] = useState(committed)
  const sentRef = useRef(committed)
  const commitRef = useRef(commit)
  commitRef.current = commit

  useEffect(() => {
    if (committed !== sentRef.current) {
      sentRef.current = committed
      setText(committed)
    }
  }, [committed])

  useEffect(() => {
    const value = text.trim()
    if (value === sentRef.current) return
    const timer = window.setTimeout(() => {
      sentRef.current = value
      commitRef.current(value)
    }, ms)
    return () => window.clearTimeout(timer)
  }, [text, ms])

  return [text, setText]
}
