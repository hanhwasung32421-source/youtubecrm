'use client'

// V3 분석 화면(참여 현황·급상승·조회수 성장·시리즈)이 함께 쓰는 "도구 줄" 부품들.
//   FilterBar   : 기간/직원/형식/정렬 고르기 + 적용 중인 필터 칩 + 필터 초기화
//   ShareTools  : 이 화면 링크 복사 / 표를 CSV로 저장
//   Term        : 용어 위에 마우스를 올리거나 누르면 한 줄 설명
//   GlossaryHelp: "이게 뭐예요?" 펼침 목록(화면마다 처음 방문할 때만 자동으로 펼쳐진다)

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { GLOSSARY, GLOSSARY_STORAGE_PREFIX, type GlossaryKey } from '@/lib/v3/glossary'
import { csvFilename } from '@/lib/v3/csv'
import type { FilterChip, Filters } from '@/lib/v3/filters'

// ── 필터 줄 ────────────────────────────────────────────────────
export type FilterField = {
  key: string
  label: string
  options: { value: string; label: string }[]
}

export function FilterBar({
  fields,
  filters,
  defaults,
  chips,
  onChange,
  onReset,
  disabled,
  children
}: {
  fields: FilterField[]
  filters: Filters
  defaults: Filters
  chips: FilterChip[]
  onChange: (key: string, value: string) => void
  onReset: () => void
  disabled?: boolean
  // 오른쪽에 둘 도구(링크 복사·CSV 등)
  children?: ReactNode
}) {
  const uid = useId()
  return (
    <div className="v3a-filterbar" role="group" aria-label="보는 조건">
      <div className="v3a-filter-row">
        {fields.map((f) => (
          <div className="v3a-filter" key={f.key}>
            <label className="v3a-filter-label" htmlFor={`${uid}-${f.key}`}>
              {f.label}
            </label>
            <select id={`${uid}-${f.key}`} className="select v3a-filter-select" value={filters[f.key] ?? ''} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value)}>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        {children ? <div className="v3a-filter-tools">{children}</div> : null}
      </div>
      {chips.length > 0 ? (
        <div className="v3a-chips" aria-label="적용 중인 필터">
          <span className="v3a-chips-title">적용 중</span>
          {chips.map((c) => (
            <button key={c.key} type="button" className="v3a-chip" onClick={() => onChange(c.key, defaults[c.key] ?? '')} aria-label={`${c.label} 조건 빼기`} title="누르면 이 조건을 빼요">
              {c.label}
              <span aria-hidden> ✕</span>
            </button>
          ))}
          <button type="button" className="v3i-linkbtn v3a-chips-reset" onClick={onReset}>
            필터 초기화
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ── 링크 복사 / CSV 저장 ───────────────────────────────────────
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 권한이 없거나 http 주소이면 아래 방법으로
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '0'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.focus()
    area.select()
    area.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export type Notify = { success: (text: string) => void; error: (text: string) => void }

export function ShareTools({
  getLink,
  csv,
  notify
}: {
  getLink: () => string
  // build 는 눌렀을 때 부른다(최신 화면 값으로 만들기 위해). rows 가 0이면 버튼이 꺼진다.
  // 비동기여도 된다: CSV 만드는 코드는 버튼을 누를 때 처음 내려받는다.
  csv?: { baseName: string; rowCount: number; build: () => string | Promise<string> }
  notify: Notify
}) {
  const csvEmpty = !!csv && csv.rowCount === 0
  return (
    <>
      <button
        type="button"
        className="button secondary xs"
        onClick={async () => {
          const ok = await copyText(getLink())
          if (ok) notify.success('이 화면 링크를 복사했어요. 붙여넣으면 같은 조건으로 열려요.')
          else notify.error('복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.')
        }}
      >
        이 화면 링크 복사
      </button>
      {csv ? (
        <button
          type="button"
          className="button secondary xs"
          disabled={csvEmpty}
          title={csvEmpty ? '저장할 표가 비어 있어요' : '엑셀에서 열 수 있는 파일로 저장해요'}
          onClick={async () => {
            try {
              const text = await csv.build()
              downloadTextFile(csvFilename(csv.baseName), text)
              notify.success(`표 ${csv.rowCount.toLocaleString('ko-KR')}줄을 파일로 저장했어요. 엑셀에서 열 수 있어요.`)
            } catch {
              notify.error('파일로 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
            }
          }}
        >
          표를 엑셀용 파일(CSV)로 저장
        </button>
      ) : null}
    </>
  )
}

// ── 용어 설명 ──────────────────────────────────────────────────
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const entry = GLOSSARY[k]
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className={`v3a-term-wrap ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="v3a-term" aria-describedby={tipId} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {children ?? entry.term}
      </button>
      <span role="tooltip" id={tipId} className="v3a-term-tip">
        {entry.short}
      </span>
    </span>
  )
}

// 이 화면에서 처음 만난 사람에게는 자동으로 펼쳐 주고, 그 뒤로는 접어 둔다(눌러서 언제든 다시 볼 수 있다).
export function GlossaryHelp({ page, keys }: { page: string; keys: GlossaryKey[] }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const flag = `${GLOSSARY_STORAGE_PREFIX}${page}`
      if (!window.localStorage.getItem(flag)) {
        window.localStorage.setItem(flag, '1')
        setOpen(true)
      }
    } catch {
      // 저장소를 못 쓰면 처음 한 번 자동으로 펼치는 것만 못 한다.
    }
  }, [page])

  return (
    <details className="v3a-fold v3a-gloss" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>이게 뭐예요? ({keys.map((k) => GLOSSARY[k].term).join(' · ')})</summary>
      <div className="v3a-fold-body">
        <dl className="v3a-gloss-list">
          {keys.map((k) => (
            <div key={k}>
              <dt>{GLOSSARY[k].term}</dt>
              <dd>{GLOSSARY[k].long}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  )
}
