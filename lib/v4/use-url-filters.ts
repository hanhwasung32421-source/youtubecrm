'use client'

// 화면 필터를 "주소 + 브라우저 저장소" 에 함께 기억하는 훅.
// - 주소(?period=7&q=...)에 필터가 하나라도 있으면 주소가 이긴다 → 링크를 보내면 상대도 같은 화면을 본다.
// - 주소가 비어 있으면 마지막으로 쓴 필터(localStorage, 버전이 붙은 키)를 되살린다. 저장소가 막혀 있어도(시크릿 모드 등) 조용히 기본값으로 동작한다.
// - 필터를 바꾸면 주소를 router.replace 로 갱신한다 (뒤로 가기 기록이 필터마다 쌓이지 않는다). 기본값은 주소에 쓰지 않는다.
// - 다른 곳에서 주소가 바뀌면(사이드바 링크, 뒤로 가기 등) 화면 필터도 따라간다. 우리가 방금 쓴 주소는 되돌아와도 무시한다.
// useSearchParams 를 쓰므로 이 훅을 쓰는 화면은 반드시 <Suspense> 안에 있어야 한다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { classifyUrlChange, decodeFilters, decodeFromString, defaultsOf, encodeFilters, hasSpecParams, sameFilters, type FilterSpec } from '@/lib/v4/filter-codec'

export const FILTER_STORE_VERSION = 'v1'
const storeKey = (page: string) => `v4:filters:${FILTER_STORE_VERSION}:${page}`
const MAX_PENDING = 8

function readStored(page: string): string | null {
  try {
    const raw = window.localStorage.getItem(storeKey(page))
    return typeof raw === 'string' ? raw : null
  } catch {
    return null
  }
}

function writeStored(page: string, query: string) {
  try {
    window.localStorage.setItem(storeKey(page), query)
  } catch {
    // 저장 실패는 무시
  }
}

export type UrlFilters<F> = {
  filters: F
  // 주소·저장소를 읽어 첫 필터가 정해졌는지. false 인 동안에는 데이터를 요청하지 않는다(기본값으로 한 번, 저장값으로 또 한 번 받는 낭비 방지).
  ready: boolean
  set: (patch: Partial<F>) => void
  // 지정한 항목만 기본값으로 (기간처럼 항상 화면에 보이는 것은 남겨 둘 수 있다)
  reset: (keys: Array<keyof F>) => void
  // 지금 화면 그대로의 링크 (기본값은 생략)
  shareUrl: () => string
}

export function useUrlFilters<F>(page: string, spec: FilterSpec<F>): UrlFilters<F> {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const urlHasFilters = hasSpecParams(spec, (name) => searchParams.get(name))
  const [filters, setFilters] = useState<F>(() => decodeFilters(spec, (name) => searchParams.get(name)))
  const [ready, setReady] = useState(urlHasFilters)

  // 주소를 "필터 부분만, 기본값 생략, 정해진 순서" 로 정리한 문자열. 표기 차이(%20 / +, 순서)에 흔들리지 않게 비교용으로 쓴다.
  const urlQuery = useMemo(
    () => encodeFilters(spec, decodeFilters(spec, (name) => searchParams.get(name))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, spec]
  )
  const urlQueryRef = useRef(urlQuery) // 주소가 지금 이 값이라고 우리가 믿는 것
  const pendingRef = useRef<string[]>([]) // 우리가 쓴 뒤 아직 주소에 반영된 걸 확인하지 못한 값들 (순서대로)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  // 주소를 바꿔 쓴다. 방금 쓴 값은 pendingRef 에 남겨 두었다가, 그 주소가 되돌아오면 "우리가 쓴 것" 으로 알아본다.
  const writeUrl = (query: string) => {
    urlQueryRef.current = query
    pendingRef.current = [...pendingRef.current, query].slice(-MAX_PENDING)
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  // 처음 열었는데 주소에 필터가 없으면 마지막에 쓰던 필터를 되살린다.
  useEffect(() => {
    if (ready) return
    const stored = readStored(page)
    if (stored) {
      const restored = decodeFromString(spec, stored)
      if (!sameFilters(spec, restored, filtersRef.current)) setFilters(restored)
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 주소가 바뀌었을 때: 우리가 쓴 것이면 무시, 아니면 "다른 곳에서 이동해 온 것" 이므로 필터를 그에 맞춘다.
  useEffect(() => {
    const change = classifyUrlChange(urlQuery, pendingRef.current, urlQueryRef.current)
    pendingRef.current = change.pending // 되돌아온 값과 그보다 먼저 쓴 값은 처리 끝
    if (change.kind !== 'external') return
    urlQueryRef.current = urlQuery
    const next = hasSpecParams(spec, (name) => searchParams.get(name))
      ? decodeFilters(spec, (name) => searchParams.get(name))
      : (() => {
          const stored = readStored(page)
          return stored ? decodeFromString(spec, stored) : defaultsOf(spec)
        })()
    if (!sameFilters(spec, next, filtersRef.current)) setFilters(next)
    // 저장된 필터를 되살렸는데 주소가 비어 있으면(사이드바에서 들어온 경우 등) 주소도 맞춰 둔다. (링크 공유·새로고침이 같은 화면이 되게)
    const nextQuery = encodeFilters(spec, next)
    if (nextQuery !== urlQuery) writeUrl(nextQuery)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery])

  // 필터가 바뀌면 저장소와 주소에 반영한다.
  useEffect(() => {
    if (!ready) return
    const query = encodeFilters(spec, filters)
    writeStored(page, query)
    if (query === urlQueryRef.current) return
    writeUrl(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, ready])

  const set = useCallback((patch: Partial<F>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch }
      return sameFilters(spec, prev, next) ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = useCallback((keys: Array<keyof F>) => {
    const defaults = defaultsOf(spec)
    const patch: Partial<F> = {}
    for (const key of keys) patch[key] = defaults[key]
    setFilters((prev) => {
      const next = { ...prev, ...patch }
      return sameFilters(spec, prev, next) ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shareUrl = useCallback(() => {
    const query = encodeFilters(spec, filtersRef.current)
    return `${window.location.origin}${pathname}${query ? `?${query}` : ''}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return { filters, ready, set, reset, shareUrl }
}
