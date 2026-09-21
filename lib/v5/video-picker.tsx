'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { v5Get, errorText } from '@/lib/v5/client'
import { formatDate } from '@/lib/v5/format'

// 영상 고르기(실험 대상 영상 / 플레이북 예시 영상).
// 하루 60~90편씩 쌓이므로 전체 목록을 받지 않고, 종목명·제목으로 서버에서 찾는다(입력 후 0.3초 뒤).

export type PickedVideo = { id: string; title: string | null; stock_name: string }

type Option = PickedVideo & { owner_name?: string | null; created_at?: string }

const nameOf = (v: { title: string | null; stock_name: string }) => v.title || v.stock_name || '(제목 없음)'

export function VideoPicker({
  selected,
  onChange,
  max,
  searchId,
  emptyHint
}: {
  selected: PickedVideo[]
  onChange: (next: PickedVideo[]) => void
  max: number
  searchId?: string
  emptyHint?: React.ReactNode
}) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const selectedIds = new Set(selected.map((v) => v.id))
  const single = max === 1

  const search = useCallback(async (q: string) => {
    const mine = ++seq.current
    setLoading(true)
    setError('')
    const res = await v5Get<{ items: Option[] }>(`/api/v5/videos?q=${encodeURIComponent(q)}`)
    if (mine !== seq.current) return // 더 새로운 검색이 있으면 이 결과는 버린다
    if (res.ok) setOptions(res.data.items || [])
    else setError(errorText(res, '영상 목록을 불러오지 못했어요.'))
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => void search(query.trim()), query ? 300 : 0)
    return () => window.clearTimeout(t)
  }, [query, search])

  const toggle = (opt: Option) => {
    const pick: PickedVideo = { id: opt.id, title: opt.title, stock_name: opt.stock_name }
    if (selectedIds.has(opt.id)) onChange(selected.filter((v) => v.id !== opt.id))
    else if (single) onChange([pick])
    else if (selected.length < max) onChange([...selected, pick])
  }

  const full = !single && selected.length >= max

  return (
    <div className="v5p-vpick">
      {selected.length > 0 ? (
        <div className="v5p-vpick-selected" aria-label="고른 영상">
          {selected.map((v) => (
            <span className="v5p-vchip" key={v.id}>
              <span className="v5p-vchip-name">{nameOf(v)}</span>
              <button type="button" className="v5p-vchip-x" aria-label={`${nameOf(v)} 빼기`} onClick={() => onChange(selected.filter((s) => s.id !== v.id))}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input
        id={searchId}
        className="input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // 검색칸에서 Enter 를 눌러도 폼이 저장되지 않게 막는다.
          if (e.key === 'Enter') e.preventDefault()
        }}
        placeholder="종목명이나 제목으로 찾기 (예: 삼성전자)"
        aria-label="영상 찾기"
      />

      <div className={`v5p-picker ${loading ? 'busy' : ''}`} role="group" aria-label="영상 목록">
        {error ? (
          <div className="v5p-pick-empty">
            {error}{' '}
            <button type="button" className="button xs secondary" onClick={() => void search(query.trim())}>
              다시 시도
            </button>
          </div>
        ) : null}
        {!error && !loading && options.length === 0 ? <div className="v5p-pick-empty">{query ? '찾는 영상이 없어요.' : emptyHint || '아직 등록된 영상이 없어요.'}</div> : null}
        {options.map((v) => {
          const on = selectedIds.has(v.id)
          return (
            <label key={v.id} className={`v5p-pick-row ${on ? 'on' : ''}`}>
              <input
                type={single ? 'radio' : 'checkbox'}
                name={single ? 'v5p-single-video' : undefined}
                checked={on}
                disabled={!on && full}
                onChange={() => toggle(v)}
                onClick={() => {
                  // 라디오는 같은 걸 다시 눌러도 해제되도록
                  if (single && on) toggle(v)
                }}
              />
              <span className="v5p-pick-stock">{v.stock_name}</span>
              <span className="v5p-pick-title">
                {v.title || '(제목 없음)'}
                <span className="v5p-pick-sub">
                  {v.created_at ? ` · ${formatDate(v.created_at).slice(5)}` : ''}
                  {v.owner_name ? ` · ${v.owner_name}` : ''}
                </span>
              </span>
            </label>
          )
        })}
        {!error && options.length >= 60 ? <div className="v5p-pick-empty">최근 60개까지만 보여요. 종목명이나 제목으로 찾아보세요.</div> : null}
      </div>
      {full ? <div className="v5p-hint">영상은 최대 {max}개까지 고를 수 있어요.</div> : null}
    </div>
  )
}
