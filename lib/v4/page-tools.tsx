'use client'

// 분석 화면 5곳이 함께 쓰는 도구 조각: 켜 둔 필터 요약(칩), 링크 복사, CSV 저장 버튼, 조회수 받기 버튼, 용어 설명.
// 스타일은 app/v4/(workspace)/pages.css (v4p- 접두어).

import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { v4Json } from '@/lib/v4/client'
import { copyText } from '@/lib/v4/download'
import { GLOSSARY, type GlossaryKey } from '@/lib/v4/glossary'
import { fmtNumber } from '@/lib/v4/format'

// ------------------------------------------------------------------ 켜 둔 필터 요약

export type FilterChip = { key: string; label: string; onRemove: () => void }

export function ActiveFilters({ chips, onReset }: { chips: FilterChip[]; onReset: () => void }) {
  if (chips.length === 0) return null
  return (
    <div className="v4p-chips" role="group" aria-label="지금 걸려 있는 필터">
      <span className="v4p-chips-label">지금 보는 조건</span>
      {chips.map((chip) => (
        <span className="v4p-chip" key={chip.key}>
          {chip.label}
          <button type="button" className="v4p-chip-x" onClick={chip.onRemove} aria-label={`${chip.label} 조건 빼기`} title="이 조건 빼기">
            ×
          </button>
        </span>
      ))}
      <button type="button" className="v4p-link-btn" onClick={onReset}>
        필터 초기화
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ 이 화면 링크 복사

export function CopyLinkButton({ getUrl, onResult }: { getUrl: () => string; onResult: (ok: boolean) => void }) {
  return (
    <button
      type="button"
      className="button secondary v4p-tool-btn"
      onClick={async () => onResult(await copyText(getUrl()))}
      title="지금 보고 있는 조건 그대로 열리는 링크를 복사해요"
    >
      이 화면 링크 복사
    </button>
  )
}

// ------------------------------------------------------------------ 표를 CSV 로 저장

// 저장 중에는 진행 상황(n / total)과 취소 버튼을 보여준다. 실제 저장 동작은 onExport 가 한다.
export type ExportProgress = { done: number; total: number } | null

export function CsvButton({
  onExport,
  onCancel,
  progress,
  disabled,
  label = '표를 CSV로 저장'
}: {
  onExport: () => void
  onCancel?: () => void
  progress?: ExportProgress
  disabled?: boolean
  label?: string
}) {
  const running = Boolean(progress)
  return (
    <span className="v4p-csv">
      <button type="button" className="button secondary v4p-tool-btn" onClick={onExport} disabled={disabled || running} title="엑셀에서 바로 열 수 있는 파일로 저장해요">
        {running ? '저장 준비 중…' : label}
      </button>
      {progress ? (
        <span className="v4p-csv-progress" role="status" aria-live="polite">
          {fmtNumber(progress.done)} / {fmtNumber(progress.total)}개
          {onCancel ? (
            <button type="button" className="v4p-link-btn" onClick={onCancel}>
              취소
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}

// ------------------------------------------------------------------ 유튜브에서 조회수 받기 (관리자만)

export function SyncStatsButton({
  onDone,
  onMessage,
  label = '유튜브에서 조회수 받기'
}: {
  onDone: () => void
  onMessage: (message: string, tone: 'success' | 'error') => void
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const run = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const res = await v4Json<{ updated: number; failed: number; total: number }>('POST', '/api/v4/sync-stats', {}, '조회수를 새로 받지 못했어요. 잠시 후 다시 시도해 주세요.')
    busyRef.current = false
    setBusy(false)
    if (!res.ok) {
      onMessage(res.message, 'error')
      return
    }
    const { total, updated, failed } = res.data
    onMessage(`영상 ${fmtNumber(total)}개 중 ${fmtNumber(updated)}개의 조회수를 새로 받았어요.${failed ? ` (실패 ${fmtNumber(failed)}개)` : ''}`, 'success')
    onDone()
  }
  return (
    <button type="button" className="button" onClick={() => void run()} disabled={busy}>
      {busy ? '받아오는 중… (최대 1분)' : label}
    </button>
  )
}

// ------------------------------------------------------------------ 용어 설명 ("이게 뭐예요?")

// 한 용어를 작은 버튼으로. 눌러서 열고(키보드·터치 모두 가능) 다시 누르거나 Esc 를 누르면 닫힌다. 본문 흐름 안에서 펼쳐져 잘리지 않는다.
// <p> 나 <h4> 안에도 쓸 수 있게 글줄(phrasing) 요소(span/button)만 쓴다.
export function GlossaryHint({ term }: { term: GlossaryKey }) {
  const entry = GLOSSARY[term]
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <span className="v4p-gloss">
      <button
        type="button"
        className="v4p-gloss-btn"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        aria-label={`${entry.term}이(가) 뭐예요?`}
        title={`${entry.term}이(가) 뭐예요?`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      >
        ?
      </button>
      {open ? (
        <span className="v4p-gloss-body" id={bodyId} role="note">
          <strong>{entry.term}</strong> — {entry.short}. {entry.long}
        </span>
      ) : null}
    </span>
  )
}

// 화면 아래에 용어를 모아 보여주는 접이식 (Formula 와 같은 모양)
export function GlossaryList({ terms, summary = '이게 뭐예요? (용어 설명)' }: { terms: GlossaryKey[]; summary?: string }) {
  return (
    <details className="v4p-details">
      <summary>{summary}</summary>
      <div className="v4p-details-body">
        {terms.map((key) => (
          <p key={key}>
            <strong>{GLOSSARY[key].term}</strong> — {GLOSSARY[key].short}. {GLOSSARY[key].long}
          </p>
        ))}
      </div>
    </details>
  )
}

// 낯선 말이 들어간 제목 옆에 붙이는 작은 도우미: 제목 + ? 버튼
export function TermLabel({ term, children }: { term: GlossaryKey; children: ReactNode }) {
  return (
    <span className="v4p-termlabel">
      {children}
      <GlossaryHint term={term} />
    </span>
  )
}
