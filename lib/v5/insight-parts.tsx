'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { GLOSSARY, type GlossaryKey } from '@/lib/v5/glossary'
import { copyText } from '@/lib/v5/share'
import './pages.css'
import './pages-r3.css'

// 성장 관리 4개 화면이 함께 쓰는 "다음 행동" 조각들: 되돌리기 알림, 적용 중인 필터 칩, "이게 뭐예요?", 링크 복사, CSV 저장 버튼.
// 스타일은 pages-r3.css(.v5-theme 하위 v5p- 접두어)에 있다.

// 지금 시각(밀리초). 상대 시간("방금", "3분 전")이 화면을 다시 그리지 않아도 갱신되게 30초마다 올린다.
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

// ---------------------------------------------------------------------------
// 되돌리기(5초): 상태를 옮기거나 "써봤어요"를 누른 직후 잠깐 나타나는 알림
// ---------------------------------------------------------------------------
export type UndoSlot = { id: number; text: string; undo: () => void | Promise<void> }
export const UNDO_MS = 5000

export function useUndoSlot(ms = UNDO_MS) {
  const [slot, setSlot] = useState<UndoSlot | null>(null)
  const timer = useRef<number | null>(null)
  const seq = useRef(0)

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const dismiss = useCallback(() => {
    clearTimer()
    setSlot(null)
  }, [])
  const show = useCallback(
    (text: string, undo: () => void | Promise<void>) => {
      clearTimer()
      const id = ++seq.current
      setSlot({ id, text, undo })
      timer.current = window.setTimeout(() => setSlot((cur) => (cur && cur.id === id ? null : cur)), ms)
    },
    [ms]
  )
  useEffect(() => clearTimer, [])
  return { slot, show, dismiss }
}

export function UndoBar({ slot, onDismiss }: { slot: UndoSlot | null; onDismiss: () => void }) {
  if (!slot) return null
  return (
    <div className="v5p-undo" role="status" aria-live="polite" key={slot.id}>
      <span className="v5p-undo-text">{slot.text}</span>
      <button
        type="button"
        className="v5p-undo-btn"
        onClick={() => {
          const undo = slot.undo
          onDismiss()
          void undo()
        }}
      >
        되돌리기
      </button>
      <button type="button" className="v5p-undo-x" aria-label="알림 닫기" onClick={onDismiss}>
        ×
      </button>
      <span className="v5p-undo-timer" aria-hidden style={{ animationDuration: `${UNDO_MS}ms` }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 적용 중인 필터 칩 + "필터 초기화"
// ---------------------------------------------------------------------------
export type FilterChip = { key: string; label: string; onClear: () => void }

export function ActiveFilters({ chips, onReset }: { chips: FilterChip[]; onReset: () => void }) {
  if (chips.length === 0) return null
  return (
    <div className="v5p-active" role="group" aria-label="적용 중인 필터">
      <span className="small muted">적용 중</span>
      {chips.map((c) => (
        <button key={c.key} type="button" className="v5p-fchip" onClick={c.onClear} aria-label={`${c.label} 필터 끄기`} title="누르면 이 필터를 꺼요">
          {c.label}
          <span aria-hidden> ×</span>
        </button>
      ))}
      <button type="button" className="button xs ghost" onClick={onReset}>
        필터 초기화
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// "이게 뭐예요?" — 눌러서 펼치는 쉬운 설명(마우스 없이도, 휴대폰에서도 동작)
// ---------------------------------------------------------------------------
export function GlossaryTip({ term, label = '이게 뭐예요?' }: { term: GlossaryKey; label?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const g = GLOSSARY[term]
  return (
    <span className="v5p-gloss">
      <button type="button" className="v5p-gloss-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="v5p-sr-only">{g.term} </span>
        {label}
      </button>
      {open ? (
        <span id={id} className="v5p-gloss-pop" role="note">
          <strong>{g.term}</strong> {g.short}
          <span className="v5p-gloss-detail">{g.detail}</span>
        </span>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 링크 복사 / CSV 저장 버튼
// ---------------------------------------------------------------------------
export function CopyLinkButton({ getUrl }: { getUrl: () => string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )
  const onClick = async () => {
    const ok = await copyText(getUrl())
    setState(ok ? 'ok' : 'fail')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2400)
  }
  return (
    <button type="button" className="button xs secondary" onClick={() => void onClick()} title="지금 보는 필터가 담긴 주소를 복사해요. 붙여 넣으면 같은 화면이 열려요.">
      {state === 'ok' ? '복사했어요 ✓' : state === 'fail' ? '복사하지 못했어요' : '이 화면 링크 복사'}
      <span className="v5p-sr-only" role="status">
        {state === 'ok' ? '링크를 복사했어요' : state === 'fail' ? '링크를 복사하지 못했어요' : ''}
      </span>
    </button>
  )
}

export function ExportCsvButton({ onExport, disabled, children }: { onExport: () => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <button type="button" className="button xs secondary" disabled={disabled} onClick={onExport} title="엑셀에서 열 수 있는 CSV 파일로 저장해요">
      {children || '표를 CSV로 저장'}
    </button>
  )
}
