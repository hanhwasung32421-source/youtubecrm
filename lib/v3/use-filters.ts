'use client'

// V3 분석 화면의 필터 상태를 "주소(URL) + 브라우저 저장소"와 이어 주는 훅. (규칙 자체는 lib/v3/filters.ts 의 순수 함수)
//   - 화면 상태는 바로 바뀌고(빠름), 주소는 router.replace 로 따라간다. → 링크를 복사하면 같은 화면이 열린다.
//   - 주소에 필터가 없으면 마지막에 쓰던 필터를 브라우저 저장소에서 읽어 온다(저장소가 막혀 있어도 화면은 정상).
//   - 뒤로 가기/링크로 주소가 바뀌면 화면 상태도 따라 바뀐다.
//   - useSearchParams 를 쓰므로 이 훅을 쓰는 화면은 <Suspense> 안에 있어야 한다.
//   - 반환값의 ready 가 true 가 된 뒤에 첫 요청을 보내면 요청이 두 번 나가지 않는다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  activeChips,
  consumeWritten,
  decodeSaved,
  defaultFilters,
  encodeSaved,
  filtersEqual,
  resetPatch,
  resolveFilters,
  serializeFilters,
  storageKey,
  type FilterChip,
  type FilterSpec,
  type Filters
} from '@/lib/v3/filters'
import { useLatest } from '@/lib/v3/interact'

function readSaved(spec: FilterSpec, pageKey: string): Filters | null {
  try {
    return decodeSaved(spec, window.localStorage.getItem(storageKey(pageKey)))
  } catch {
    return null
  }
}

function writeSaved(spec: FilterSpec, pageKey: string, filters: Filters) {
  try {
    window.localStorage.setItem(storageKey(pageKey), encodeSaved(spec, filters))
  } catch {
    // 저장소를 못 쓰면 기억만 못 할 뿐이다.
  }
}

function clearSaved(pageKey: string) {
  try {
    window.localStorage.removeItem(storageKey(pageKey))
  } catch {
    // 무시
  }
}

export type UseFilters = {
  filters: Filters
  ready: boolean
  // 하나 이상을 바꾼다. 예) set({ format: 'longform' })
  set: (patch: Partial<Filters>) => void
  // 필터를 기본값으로(검색어 포함). 선택한 영상 같은 것은 그대로 둔다.
  reset: () => void
  // 기본값이 아닌 필터들(칩으로 보여 줄 것)
  chips: (labelFor: (key: string, value: string) => string) => FilterChip[]
  // 지금 화면을 그대로 여는 링크. extra 로 선택한 영상 등을 덧붙일 수 있다.
  shareUrl: (extra?: Partial<Filters>) => string
}

export function useUrlFilters(pageKey: string, spec: FilterSpec): UseFilters {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(spec))
  const [ready, setReady] = useState(false)
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  // 우리가 방금 주소에 적은 값들. 이 값이 useSearchParams 로 돌아오면 "밖에서 바뀐 것"이 아니므로 무시한다.
  const written = useRef<string[]>([])
  const spString = searchParams.toString()
  const latest = useLatest({ spec, pageKey, router, pathname, spString, searchParams })

  const writeUrl = useCallback(
    (next: Filters) => {
      const { spec: sp, router: r, pathname: path, spString: current } = latest.current
      const qs = serializeFilters(sp, next)
      // 이미 그 주소이고 아직 반영을 기다리는 변경도 없을 때만 건너뛴다.
      if (qs === current && written.current.length === 0) return
      written.current.push(qs)
      r.replace(qs ? `${path}?${qs}` : path, { scroll: false })
    },
    [latest]
  )

  // 처음 한 번: 주소와 저장된 값을 합쳐서 시작 상태를 정한다.
  useEffect(() => {
    const { spec: sp, pageKey: key, searchParams: params } = latest.current
    const resolved = resolveFilters(sp, (k) => params.get(k), readSaved(sp, key))
    setFilters(resolved)
    filtersRef.current = resolved
    setReady(true)
    // 저장된 값으로 시작했다면 주소에도 반영해서, 이 주소를 복사해도 같은 화면이 열리게 한다.
    writeUrl(resolved)
  }, [latest, writeUrl])

  // 뒤로 가기/앞으로 가기/다른 화면에서 온 링크처럼 주소가 밖에서 바뀌면 화면 상태를 맞춘다.
  useEffect(() => {
    if (!ready) return
    const consumed = consumeWritten(written.current, spString)
    if (consumed.matched) {
      written.current = consumed.rest
      return
    }
    const { spec: sp, pageKey: key, searchParams: params } = latest.current
    const resolved = resolveFilters(sp, (k) => params.get(k), readSaved(sp, key))
    if (!filtersEqual(sp, filtersRef.current, resolved)) {
      setFilters(resolved)
      filtersRef.current = resolved
    }
  }, [spString, ready, latest])

  const set = useCallback(
    (patch: Partial<Filters>) => {
      const { spec: sp, pageKey: key } = latest.current
      const next: Filters = { ...filtersRef.current }
      for (const k of Object.keys(patch)) if (k in sp && patch[k] !== undefined) next[k] = patch[k] as string
      // 걸러진(허용되는) 값으로 다시 정리한다.
      const clean = resolveFilters(sp, (k) => next[k], null)
      if (filtersEqual(sp, filtersRef.current, clean)) return
      filtersRef.current = clean
      setFilters(clean)
      writeSaved(sp, key, clean)
      writeUrl(clean)
    },
    [latest, writeUrl]
  )

  const reset = useCallback(() => {
    const { spec: sp, pageKey: key } = latest.current
    clearSaved(key)
    const next: Filters = { ...filtersRef.current, ...resetPatch(sp) }
    filtersRef.current = next
    setFilters(next)
    writeUrl(next)
  }, [latest, writeUrl])

  const chips = useCallback((labelFor: (key: string, value: string) => string) => activeChips(spec, filters, labelFor), [spec, filters])

  const shareUrl = useCallback(
    (extra: Partial<Filters> = {}) => {
      const merged: Filters = { ...filtersRef.current }
      for (const k of Object.keys(extra)) if (extra[k] !== undefined) merged[k] = extra[k] as string
      const qs = serializeFilters(spec, merged, { all: true })
      const path = latest.current.pathname
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      return `${origin}${path}${qs ? `?${qs}` : ''}`
    },
    [spec, latest]
  )

  return useMemo(() => ({ filters, ready, set, reset, chips, shareUrl }), [filters, ready, set, reset, chips, shareUrl])
}

// 검색칸처럼 글자마다 주소를 바꾸면 안 되는 입력: 입력은 바로 보이고, 잠깐 멈추면 필터에 반영한다.
// 필터가 밖에서 바뀌면(초기화·뒤로 가기) 입력칸도 따라 바뀐다. 입력 중인 글자를 덮어쓰지 않는다.
export function useDebouncedField(value: string, commit: (next: string) => void, delayMs = 300): [string, (next: string) => void] {
  const [input, setInput] = useState(value)
  const committed = useRef(value)
  const commitRef = useLatest(commit)

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setInput(value)
    }
  }, [value])

  useEffect(() => {
    if (input.trim() === committed.current) return
    const timer = window.setTimeout(() => {
      // 필터는 앞뒤 공백을 지운 값으로 저장하므로 같은 값으로 맞춰 둔다(안 그러면 입력 중인 공백이 지워진다).
      committed.current = input.trim()
      commitRef.current(input.trim())
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [input, delayMs, commitRef])

  return [input, setInput]
}
