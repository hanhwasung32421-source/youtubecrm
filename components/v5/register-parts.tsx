'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/v5/widget'
import { progressCopy, undoSecondsLeft, type StockCount, type UndoEntry, type UndoState } from '@/components/v5/register-logic'
import type { RegisterErrorInfo } from '@/components/v5/register-errors'

// 영상 등록 화면의 작은 조각들(진행 막대 · 오늘 종목 · 결과 자리 · 단축키 안내).
// 상태는 모두 page.tsx 가 들고 있고, 여기서는 그리기와 아주 작은 입력 상태만 다룬다.

// ---- 오늘 진행 막대 ------------------------------------------------------------------

export function TodayGoal({ count, goal }: { count: number; goal: number }) {
  const copy = progressCopy(count, goal)
  return (
    <div className="v5-goal" role="group" aria-label="오늘 등록 진행">
      <div className="v5-goal-top">
        <strong>{copy.headline}</strong>
        <span className="v5-goal-sub">{copy.sub}</span>
      </div>
      <div
        className="v5-goal-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(count, goal)}
        aria-valuetext={`목표 ${goal}개 중 ${count}개 등록`}
      >
        <div className={`v5-goal-bar ${copy.full ? 'full' : ''}`} style={{ width: `${copy.pct}%` }} />
      </div>
    </div>
  )
}

// ---- 오늘 등록한 종목별 개수 ----------------------------------------------------------------

export const TodayStocks = memo(function TodayStocks({ stocks }: { stocks: StockCount[] }) {
  if (stocks.length === 0) return null
  const total = stocks.reduce((sum, s) => sum + s.count, 0)
  return (
    <section className="v5-today" aria-label="오늘 등록한 종목">
      <div className="v5-today-head">
        오늘 등록한 종목 <Badge tone="plain">{total.toLocaleString('ko-KR')}개</Badge>
      </div>
      <ul className="v5-today-list">
        {stocks.map((s) => (
          <li key={s.stock}>
            {s.stock}
            <b aria-label={`${s.count}개`}>{s.count}</b>
          </li>
        ))}
      </ul>
    </section>
  )
})

// ---- 단축키 안내(키보드가 없는 기기에서는 CSS 가 숨긴다) ---------------------------------------------

export const KeyboardHint = memo(function KeyboardHint() {
  return (
    <div className="v5-kbd-hint">
      <kbd>Enter</kbd> 등록 · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 어느 칸에서든 등록 · <kbd>/</kbd> 주소칸으로 이동 · <kbd>Esc</kbd> 주소 지우기
    </div>
  )
})

// ---- 결과 자리(높이 고정) --------------------------------------------------------------------

export type Feedback =
  | { kind: 'ok'; key: string; id: string; headline: string; detail: string; stock: string }
  | { kind: 'info'; key: string; message: string }
  | { kind: 'error'; key: string; error: RegisterErrorInfo; loginHref?: string }

// 남은 시간을 1초마다 세는 되돌리기 버튼. 다 되면 onExpire 로 알린다(화면 전체를 매초 다시 그리지 않는다).
function UndoButton({ entry, state, onUndo, onExpire }: { entry: UndoEntry; state: UndoState; onUndo: () => void; onExpire: () => void }) {
  const [seconds, setSeconds] = useState(() => undoSecondsLeft(entry, Date.now()))
  const expireRef = useRef(onExpire)
  useEffect(() => {
    expireRef.current = onExpire
  })

  useEffect(() => {
    if (state.phase === 'busy') return
    const tick = () => {
      const left = undoSecondsLeft(entry, Date.now())
      setSeconds(left)
      if (left <= 0) expireRef.current()
    }
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [entry, state.phase])

  const busy = state.phase === 'busy'
  return (
    <button
      className="button secondary sm"
      type="button"
      disabled={busy || seconds <= 0}
      aria-label={state.phase === 'failed' ? '되돌리기 다시 시도' : '방금 등록한 영상 되돌리기'}
      onClick={onUndo}
    >
      {busy ? '되돌리는 중...' : state.phase === 'failed' ? '되돌리기 다시 시도' : '되돌리기'}
      {!busy ? (
        <span className="v5-undo-count" aria-hidden="true">
          {' '}
          · {seconds}초
        </span>
      ) : null}
    </button>
  )
}

export function FeedbackSlot({
  feedback,
  undo,
  onUndo,
  onUndoExpire,
  onQuickFix,
  onRetry
}: {
  feedback: Feedback | null
  undo: UndoState
  onUndo: () => void
  onUndoExpire: () => void
  // 종목 고치기. 성공하면 null, 실패하면 화면에 보여 줄 한 문장을 돌려준다.
  onQuickFix: (id: string, stock: string) => Promise<string | null>
  onRetry: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const editBtnRef = useRef<HTMLButtonElement | null>(null)
  const key = feedback?.key

  // 새 결과가 나오면 편집 상태는 처음으로.
  useEffect(() => {
    setEditing(false)
    setErr('')
    setBusy(false)
  }, [key])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const save = async () => {
    if (!feedback || feedback.kind !== 'ok' || busy) return
    const next = value.trim()
    if (!next) {
      setErr('종목명을 적어 주세요.')
      inputRef.current?.focus()
      return
    }
    if (next === feedback.stock) {
      setEditing(false)
      return
    }
    setBusy(true)
    setErr('')
    const message = await onQuickFix(feedback.id, next)
    setBusy(false)
    if (message) {
      setErr(message)
      inputRef.current?.focus()
      return
    }
    setEditing(false)
  }

  const undoEntry = undo.phase !== 'idle' ? undo.entry : null

  let body: React.ReactNode = null
  if (feedback?.kind === 'ok') {
    const canUndo = undoEntry && undoEntry.id === feedback.id
    body = (
      <div className="v5-confirm" role="status">
        <div className="v5-confirm-text">
          {editing ? (
            <div
              className="v5-quickfix"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.stopPropagation()
                  setEditing(false)
                  setErr('')
                  editBtnRef.current?.focus()
                } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.stopPropagation() // 화면 전체의 Ctrl+Enter 등록으로 번지지 않게
                  void save()
                }
              }}
            >
              <label className="v5-sr-only" htmlFor="v5-quickfix-stock">
                고칠 종목
              </label>
              <input
                id="v5-quickfix-stock"
                ref={inputRef}
                className="input"
                autoComplete="off"
                spellCheck={false}
                value={value}
                readOnly={busy}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={Boolean(err)}
              />
              <button className="button sm" type="button" disabled={busy} onClick={() => void save()}>
                {busy ? '저장 중...' : '저장'}
              </button>
              <button
                className="button secondary sm"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setErr('')
                  editBtnRef.current?.focus()
                }}
              >
                취소
              </button>
              {err ? (
                <div className="v5-quickfix-err" role="alert">
                  {err}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <span>{feedback.headline}</span>
              <span className="v5-confirm-detail">{feedback.detail}</span>
            </>
          )}
        </div>
        {!editing ? (
          <div className="v5-confirm-actions">
            <button
              ref={editBtnRef}
              className="button ghost sm"
              type="button"
              aria-label={`${feedback.stock} 종목 고치기`}
              onClick={() => {
                setValue(feedback.stock)
                setEditing(true)
              }}
            >
              종목 고치기
            </button>
            {canUndo ? <UndoButton entry={undoEntry} state={undo} onUndo={onUndo} onExpire={onUndoExpire} /> : null}
          </div>
        ) : null}
        {undo.phase === 'failed' && canUndo && !editing ? (
          <div className="v5-quickfix-err" role="alert">
            {undo.message}
          </div>
        ) : null}
      </div>
    )
  } else if (feedback?.kind === 'info') {
    body = (
      <div className="v5-confirm info" role="status">
        <div className="v5-confirm-text">
          <span className="v5-confirm-msg">{feedback.message}</span>
        </div>
      </div>
    )
  } else if (feedback?.kind === 'error') {
    body = (
      <div className="v5-confirm error" role="alert">
        <div className="v5-confirm-text">
          <span>등록하지 못했어요</span>
          <span className="v5-confirm-msg">{feedback.error.message}</span>
        </div>
        <div className="v5-confirm-actions">
          {feedback.error.retry ? (
            <button className="button secondary sm" type="button" onClick={onRetry}>
              다시 시도
            </button>
          ) : null}
          {feedback.error.kind === 'auth' && feedback.loginHref ? (
            <a className="button sm" href={feedback.loginHref}>
              다시 로그인
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  return <div className="v5-feedback">{body}</div>
}
