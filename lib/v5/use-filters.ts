'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { filterSignature, filtersFromStored, hasAnyKey, isDefaultFilters, mergeQuery, type FilterSpec } from '@/lib/v5/filters'
import { buildShareUrl } from '@/lib/v5/share'

// 화면 필터를 "주소(쿼리)" 와 "브라우저 저장소(localStorage)" 에 함께 남긴다.
//  - 주소에 필터가 있으면 그 값이 우선(링크를 받은 사람도 같은 화면을 본다). 없으면 마지막에 쓴 필터를 되살린다.
//  - 화면 값은 즉시 바뀌고(주소 이동을 기다리지 않는다), 주소는 router.replace 로 따라간다(뒤로 가기 기록이 쌓이지 않는다).
//  - 뒤로/앞으로 가기나 링크 이동으로 주소가 바뀌면 화면 필터도 그 주소를 따라간다.
// useSearchParams 를 쓰므로 이 훅을 쓰는 화면은 <Suspense> 안에 있어야 한다(Next 16).
export function useUrlFilters<T>(spec: FilterSpec<T>, storageKey: string) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [filters, setLocal] = useState<T>(spec.defaults)
  const [ready, setReady] = useState(false)
  const filtersRef = useRef<T>(spec.defaults)
  const paramsRef = useRef(params)
  paramsRef.current = params
  // 우리가 직접 바꾼 주소(뒤따라 오는 "주소가 바뀌었어요" 알림을 바깥 이동으로 오해하지 않기 위해)
  const issuedRef = useRef<string[]>([])

  const sig = useCallback((f: T) => filterSignature(spec, f), [spec])

  const goto = useCallback(
    (qs: string) => {
      if (qs === paramsRef.current.toString()) return
      issuedRef.current.push(qs)
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname]
  )

  const writeStored = useCallback(
    (f: T) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(spec.serialize(f)))
      } catch {
        // 저장이 막혀 있어도 이번 화면에서는 그대로 동작
      }
    },
    [spec, storageKey]
  )

  // 처음 한 번: 주소 → 저장된 값 → 기본값 순으로 시작 값을 정한다.
  useEffect(() => {
    let initial: T = spec.defaults
    if (hasAnyKey(spec, params)) {
      initial = spec.parse(params)
    } else {
      try {
        const raw = window.localStorage.getItem(storageKey)
        if (raw) initial = filtersFromStored(spec, JSON.parse(raw)) ?? spec.defaults
      } catch {
        // 못 읽으면 기본값
      }
    }
    filtersRef.current = initial
    setLocal(initial)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 주소가 바뀔 때: 우리가 바꾼 것이면 무시, 바깥(뒤로 가기/링크)에서 온 것이면 화면 필터를 맞춘다.
  useEffect(() => {
    if (!ready) return
    const cur = params.toString()
    const idx = issuedRef.current.indexOf(cur)
    if (idx >= 0) {
      issuedRef.current.splice(0, idx + 1)
      return
    }
    issuedRef.current = []
    if (hasAnyKey(spec, params)) {
      const fromUrl = spec.parse(params)
      if (sig(fromUrl) !== sig(filtersRef.current)) {
        filtersRef.current = fromUrl
        setLocal(fromUrl)
      }
    } else if (!isDefaultFilters(spec, filtersRef.current)) {
      // 필터 없는 주소로 들어왔지만 기억해 둔 필터가 있다 → 주소에도 보이게 맞춘다(공유할 수 있게).
      goto(mergeQuery(cur, spec.keys, spec.serialize(filtersRef.current)))
    }
  }, [params, ready, spec, sig, goto])

  const setFilters = useCallback(
    (patch: Partial<T> | ((prev: T) => T)) => {
      const prev = filtersRef.current
      const next = typeof patch === 'function' ? (patch as (p: T) => T)(prev) : ({ ...prev, ...patch } as T)
      if (sig(next) === sig(prev)) return
      filtersRef.current = next
      setLocal(next)
      writeStored(next)
      goto(mergeQuery(paramsRef.current.toString(), spec.keys, spec.serialize(next)))
    },
    [goto, sig, spec, writeStored]
  )

  const reset = useCallback(() => setFilters(spec.defaults), [setFilters, spec])

  // 한 번만 쓰는 주소 값(new=1, video=… 등)을 지운다. 필터 값은 그대로 주소에 남긴다.
  const stripParams = useCallback(
    (names: string[]) => {
      goto(mergeQuery(paramsRef.current.toString(), spec.keys, spec.serialize(filtersRef.current), names))
    },
    [goto, spec]
  )

  // "이 화면 링크 복사"에 쓸 주소: 필터만 담긴 깨끗한 주소
  const shareUrl = useCallback(() => buildShareUrl(pathname, mergeQuery('', spec.keys, spec.serialize(filtersRef.current))), [pathname, spec])

  return { filters, setFilters, reset, ready, isDefault: isDefaultFilters(spec, filters), params, stripParams, shareUrl }
}
