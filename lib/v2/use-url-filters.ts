'use client'

// 화면 필터를 주소(?period=30&staff=…)와 브라우저 저장소에 함께 맞춰 두는 훅.
//  - 주소에 필터가 있으면 그것이 우선이라, 링크를 보내면 같은 화면이 열려요.
//  - 주소에 없으면 지난번에 고른 값(localStorage, 버전이 붙은 키)을 다시 적용해요.
//  - 값을 바꾸면 화면은 바로 바뀌고, 주소는 router.replace 로 조용히 맞춰요. (기록이 쌓이지 않아 뒤로 가기가 깔끔)
//  - 이 훅을 쓰는 화면은 반드시 <Suspense> 로 감싸야 해요 (useSearchParams 요구사항).
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { activeFilterKeys, defaultFilters, hasKnownParam, parseFilters, resolveFilters, serializeFilters, type FilterSpec, type Filters } from './filters'
import { readRemembered, writeRemembered } from './use-remembered'

export type UrlFilters<S extends FilterSpec> = {
  filters: Filters<S>
  /** 일부만 바꾼다. 화면은 즉시, 주소·저장소는 뒤이어 맞춘다. */
  setFilters: (patch: Partial<Filters<S>>) => void
  /** 모든 필터를 기본값으로 */
  reset: () => void
  /** 기본값과 다른 필터의 이름들 */
  activeKeys: (keyof S & string)[]
  /** 사용자가 고른 적이 있거나(주소·저장값 포함) 지금 막 고른 경우 */
  touched: boolean
  /** 지금 필터가 반영된 공유용 전체 주소 */
  shareHref: () => string
}

const STORAGE_VERSION = 'v1'

export function useUrlFilters<S extends FilterSpec>(page: string, spec: S): UrlFilters<S> {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const storageKey = `filters.${STORAGE_VERSION}.${page}`

  const [filters, setState] = useState<Filters<S>>(() => parseFilters(spec, params))
  const [touched, setTouched] = useState(() => hasKnownParam(spec, params))
  const stateRef = useRef(filters)
  // 우리가 방금 주소에 쓴 값. 그 값이 주소로 되돌아온 것(메아리)은 무시하고, 그 밖의 변화(뒤로 가기·링크 이동)만 따른다.
  const writtenRef = useRef<string[]>([])
  const specRef = useRef(spec)

  const canonical = serializeFilters(spec, parseFilters(spec, params))
  const lastSeenRef = useRef(canonical)

  const writeUrl = useCallback(
    (query: string) => {
      writtenRef.current = [...writtenRef.current.slice(-3), query]
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router]
  )

  // 처음 열렸을 때: 주소에 필터가 없으면 저장해 둔 값을 적용한다.
  useEffect(() => {
    const s = specRef.current
    if (hasKnownParam(s, params)) {
      // 링크로 들어왔다면 그 값을 "마지막에 본 필터"로 기억한다. (종목·영상 하나 같은 일회성 값만 있는 링크는 기억을 건드리지 않는다)
      if (Object.keys(s).some((key) => !s[key].transient && params.get(key) !== null)) {
        writeRemembered(storageKey, serializeFilters(s, parseFilters(s, params), { persistOnly: true }))
      }
      return
    }
    const { state, source } = resolveFilters(s, params, readRemembered(storageKey))
    if (source !== 'saved') return
    stateRef.current = state
    setState(state)
    setTouched(true)
    writeUrl(serializeFilters(s, state))
    // 처음 한 번만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 주소가 밖에서 바뀌었을 때(뒤로 가기, 다른 화면의 링크): 화면 필터를 주소에 맞춘다.
  useEffect(() => {
    if (canonical === lastSeenRef.current) return
    lastSeenRef.current = canonical
    const own = serializeFilters(specRef.current, stateRef.current)
    if (canonical === own) {
      // 주소가 화면을 따라잡았다.
      writtenRef.current = []
      return
    }
    // 우리가 조금 전에 쓴 값이 늦게 돌아온 것이면, 화면이 이미 더 새로우므로 무시한다.
    if (writtenRef.current.includes(canonical)) return
    const next = parseFilters(specRef.current, params)
    stateRef.current = next
    setState(next)
    setTouched(true)
    writtenRef.current = []
    // params 는 canonical 이 바뀔 때만 읽으면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical])

  const commit = useCallback(
    (next: Filters<S>) => {
      const query = serializeFilters(specRef.current, next)
      // 허용되지 않는 값이 섞여 있어도 저장·표시가 같도록, 주소로 만든 값을 다시 읽어 쓴다.
      const clean = parseFilters(specRef.current, new URLSearchParams(query))
      stateRef.current = clean
      setState(clean)
      setTouched(true)
      writeRemembered(storageKey, serializeFilters(specRef.current, clean, { persistOnly: true }))
      writeUrl(query)
    },
    [storageKey, writeUrl]
  )

  const setFilters = useCallback((patch: Partial<Filters<S>>) => commit({ ...stateRef.current, ...patch } as Filters<S>), [commit])
  const reset = useCallback(() => commit(defaultFilters(specRef.current)), [commit])

  const shareHref = useCallback(() => {
    const query = serializeFilters(specRef.current, stateRef.current)
    return `${window.location.origin}${pathname}${query ? `?${query}` : ''}`
  }, [pathname])

  return { filters, setFilters, reset, activeKeys: activeFilterKeys(spec, filters), touched, shareHref }
}
