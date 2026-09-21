'use client'

import { useEffect, useRef, useState } from 'react'

// 화면에 가까워졌을 때(기본: 300px 앞) 한 번만 true 가 된다. 무거운 그래프를 "보게 될 때" 내려받는 용도.
// IntersectionObserver 를 못 쓰는 브라우저에서는 바로 true.
export function useInView<T extends Element>(rootMargin = '300px') {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    if (seen) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [seen, rootMargin])

  return { ref, seen }
}
