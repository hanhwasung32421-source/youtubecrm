'use client'

import { useEffect, useRef, useState } from 'react'
import { CONTENT_TYPE_LABELS } from '@/lib/v2/types'
import { UNDO_WINDOW_MS, undoSecondsLeft, type UndoState } from './register-flow'

export type RegisterErrorView = { text: string; retry: boolean; relogin: boolean }

type Props = {
  error: RegisterErrorView | null
  info: string
  undo: UndoState
  now: number
  saving: boolean
  loginHref: string
  stockListId: string
  onRetry: () => void
  onUndo: () => void
  onFixStock: (next: string) => Promise<string>
  onBeforeRelogin: () => void
  onFocusUrl: () => void
}

// 등록 결과가 나오는 "고정 높이" 칸. 성공·오류·안내가 바뀌어도 아래 화면이 위아래로 출렁이지 않는다.
export function RegisterStatus({ error, info, undo, now, saving, loginHref, stockListId, onRetry, onUndo, onFixStock, onBeforeRelogin, onFocusUrl }: Props) {
  const entry = undo.entry
  const [fixing, setFixing] = useState(false)
  const [fixValue, setFixValue] = useState('')
  const [fixBusy, setFixBusy] = useState(false)
  const [fixError, setFixError] = useState('')
  const fixRef = useRef<HTMLInputElement | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // 다음 영상을 등록해 "방금 등록한 영상"이 바뀌면 열려 있던 종목 고치기 칸은 닫는다.
  const entryId = entry?.videoId
  useEffect(() => {
    setFixing(false)
    setFixError('')
  }, [entryId])

  useEffect(() => {
    if (fixing) {
      fixRef.current?.focus()
      fixRef.current?.select()
    }
  }, [fixing])

  const closeFix = (returnFocus: boolean) => {
    setFixing(false)
    setFixError('')
    if (returnFocus) onFocusUrl()
  }

  const saveFix = async () => {
    if (fixBusy) return
    setFixBusy(true)
    setFixError('')
    const problem = await onFixStock(fixValue)
    if (!alive.current) return
    setFixBusy(false)
    if (problem) {
      setFixError(problem)
      fixRef.current?.focus()
      return
    }
    closeFix(true)
  }

  const secondsLeft = undoSecondsLeft(undo.expiresAt, now)
  const undoLabel = entry?.updatedFrom ? '이전 종목으로 되돌리기' : '되돌리기'

  let body: React.ReactNode
  if (error) {
    body = (
      <div className="v2-slot-error" role="alert">
        <div className="v2-hint">{error.text}</div>
        <div className="v2-slot-actions">
          {error.retry ? (
            <button type="button" className="button secondary xs" disabled={saving} onClick={onRetry}>
              {saving ? '다시 시도 중…' : '다시 시도'}
            </button>
          ) : null}
          {error.relogin ? (
            <a className="button xs v2-relogin" href={loginHref} onClick={onBeforeRelogin}>
              다시 로그인
            </a>
          ) : null}
        </div>
      </div>
    )
  } else if (info) {
    body = <div className="v2-hint quiet v2-slot-info">{info}</div>
  } else if (entry) {
    const typeLabel = CONTENT_TYPE_LABELS[entry.type]
    body = (
      <div className="v2-last">
        <div className="v2-confirm v2-last-line">
          <span aria-hidden="true">✓</span>{' '}
          {entry.updatedFrom ? (
            <>
              종목을 바꿨어요
              <span className="muted">
                {' '}
                · {entry.updatedFrom.stock} → {entry.stock}
              </span>
            </>
          ) : (
            <>
              등록됨 · 오늘 {entry.nth}번째
              <span className="muted">
                {' '}
                · {entry.stock} · {typeLabel}
              </span>
            </>
          )}
        </div>

        {fixing ? (
          <div className="v2-slot-actions v2-fix-form" role="group" aria-label="종목 고치기">
            <label className="v2-sr-only" htmlFor="v2-fix-stock">
              방금 등록한 영상의 종목명
            </label>
            <input
              id="v2-fix-stock"
              ref={fixRef}
              className="input compact v2-fix-input"
              autoComplete="off"
              spellCheck={false}
              list={stockListId}
              value={fixValue}
              disabled={fixBusy}
              onChange={(e) => {
                setFixValue(e.target.value)
                setFixError('')
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                // 이 칸은 등록 폼 안에 있으므로 Enter가 등록 폼으로 번지지 않게 여기서 멈춘다
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  void saveFix()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.nativeEvent.stopPropagation()
                  closeFix(true)
                }
              }}
            />
            <button type="button" className="button xs" disabled={fixBusy} onClick={() => void saveFix()}>
              {fixBusy ? '저장 중…' : '종목 저장'}
            </button>
            <button type="button" className="button secondary xs" disabled={fixBusy} onClick={() => closeFix(true)}>
              취소
            </button>
            {fixError ? (
              <span className="v2-hint" role="alert">
                {fixError}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="v2-slot-actions">
            {undo.phase === 'open' || undo.phase === 'busy' ? (
              <button type="button" className="button secondary xs v2-undo-btn" disabled={undo.phase === 'busy'} onClick={onUndo}>
                <span className="v2-undo-fill" key={entry.videoId + ':' + undo.expiresAt} style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }} aria-hidden="true" />
                <span className="v2-undo-text">
                  {undo.phase === 'busy' ? '되돌리는 중…' : undoLabel}
                  {undo.phase === 'open' ? <span aria-hidden="true"> · {secondsLeft}초</span> : null}
                </span>
              </button>
            ) : (
              <span className="v2-hint quiet v2-undo-gone">
                되돌리기 시간이 지났어요. 잘못 등록했다면 아래 목록에서 「삭제」를 눌러 주세요.
              </span>
            )}
            {undo.phase !== 'busy' ? (
              <button
                type="button"
                className="v2-text-btn"
                onClick={() => {
                  setFixValue(entry.stock)
                  setFixError('')
                  setFixing(true)
                }}
              >
                종목 고치기
              </button>
            ) : null}
            {undo.error ? (
              <span className="v2-hint" role="alert">
                {undo.error}
              </span>
            ) : null}
          </div>
        )}
      </div>
    )
  } else {
    body = <div className="v2-hint quiet v2-slot-idle">등록하면 이 자리에 확인 표시와 「되돌리기」 버튼이 10초 동안 나와요.</div>
  }

  return (
    <div className="v2-status v2-slot" aria-live="polite" aria-atomic="false">
      {body}
    </div>
  )
}
