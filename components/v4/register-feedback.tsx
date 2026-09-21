'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { secondsLeft, type UndoState } from '@/components/v4/undo-state'
import { loginHrefWithNext } from '@/components/v4/safe-next'
import { needsRelogin, type RegisterErrorKind } from '@/components/v4/register-logic'
import { LOGIN_HREF } from '@/lib/v4/menu'

// 되돌리기 카운트다운용 현재 시각. 이 작은 칸만 다시 그려서, 카운트다운 동안 등록 화면 전체가 다시 그려지지 않게 한다.
function useNowWhile(active: boolean, syncKey: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [active, syncKey])
  return now
}

export type FeedbackStatus = { tone: 'ok' | 'error'; text: string; kind?: RegisterErrorKind; retry?: boolean } | null

// 로그인이 풀렸을 때: 새 창에서 로그인하면 이 화면에 적어 둔 내용이 사라지지 않는다.
function ReloginLink() {
  return (
    <a className="button secondary v4-mini v4-touch v4-relogin" href={loginHrefWithNext(LOGIN_HREF, '/v4/register')} target="_blank" rel="noopener noreferrer">
      다시 로그인 (새 창)
    </a>
  )
}

// 등록 화면 아래의 "결과 칸". 높이가 늘 같아서 등록할 때마다 화면이 출렁이지 않는다.
//  1) 오류 → 무슨 일인지 + 뭘 하면 되는지 + [다시 시도] (+ [다시 로그인])
//  2) 방금 등록한 영상 → [되돌리기 · N초] + 종목 바로 고치기
//  3) 짧은 안내(되돌렸어요 등)
//  4) 아무 일도 없을 때 → 사용법 한 줄
export const RegisterFeedback = memo(function RegisterFeedback({
  status,
  undo,
  busy,
  onUndo,
  onRetry,
  onQuickFix,
  idleHint
}: {
  status: FeedbackStatus
  undo: UndoState
  busy: boolean
  onUndo: () => void
  onRetry: () => void
  onQuickFix: (stock: string) => Promise<{ ok: boolean; message: string }>
  idleHint: React.ReactNode
}) {
  const recent = undo.recent
  const nowMs = useNowWhile(undo.phase === 'open' || undo.phase === 'working', undo.expiresAt)

  let body: React.ReactNode
  if (status && status.tone === 'error') {
    body = (
      <div className="v4-fb error" role="alert">
        <div className="v4-fb-line">
          <strong>{status.text}</strong>
        </div>
        <div className="v4-fb-actions">
          {status.retry ? (
            <button type="button" className="button v4-mini v4-touch" onClick={onRetry} disabled={busy}>
              {busy ? '다시 시도하는 중…' : '다시 시도'}
            </button>
          ) : null}
          {status.kind === 'auth' || needsRelogin(status.text) ? <ReloginLink /> : null}
        </div>
      </div>
    )
  } else if (status) {
    body = (
      <div className="v4-fb ok">
        <div className="v4-fb-line">
          <strong>✓ {status.text}</strong>
        </div>
      </div>
    )
  } else if (recent) {
    const secs = secondsLeft(undo, nowMs)
    const canUndo = Boolean(recent.id) && (undo.phase === 'open' || undo.phase === 'working')
    const undoLabel = undo.phase === 'working' ? '되돌리는 중…' : recent.mode === 'restore' ? '이전 종목으로 되돌리기' : '되돌리기'
    body = (
      <div className="v4-fb ok">
        <div className="v4-fb-line">
          <strong>{recent.mode === 'restore' ? '✓ 종목을 바꿨어요' : '✓ 방금 등록한 영상'}</strong>
          <span className="v4-fb-detail">
            {recent.mode === 'restore' && recent.prevStock ? `${recent.prevStock} → ${recent.stock}` : recent.stock}
            {recent.title ? ` · ${recent.title}` : ''}
            {recent.ordinal ? ` · 오늘 ${recent.ordinal}번째` : ''}
          </span>
          {canUndo ? (
            <button type="button" className="button secondary v4-mini v4-touch v4-undo" onClick={onUndo} disabled={undo.phase === 'working'}>
              {undoLabel}
              {undo.phase === 'open' ? (
                <span aria-hidden="true"> · {secs}초</span>
              ) : null}
            </button>
          ) : recent.id ? (
            <span className="v4-fb-quiet">되돌리기 시간이 지났어요</span>
          ) : null}
        </div>
        {undo.error ? (
          <div className="v4-fb-err" role="alert">
            {undo.error} {needsRelogin(undo.error) ? <ReloginLink /> : null}
          </div>
        ) : null}
        {recent.id ? <QuickFix key={recent.id} initial={recent.stock} onSave={onQuickFix} /> : null}
      </div>
    )
  } else {
    body = <div className="v4-fb idle">{idleHint}</div>
  }

  return (
    <div className="v4-reg-feedback" aria-live="polite" aria-atomic="false">
      {body}
    </div>
  )
})

// 방금 등록한 영상의 종목이 틀렸을 때 그 자리에서 바로 고친다 (Enter 로 저장).
function QuickFix({ initial, onSave }: { initial: string; onSave: (stock: string) => Promise<{ ok: boolean; message: string }> }) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!msg?.ok) return
    const timer = window.setTimeout(() => setMsg(null), 2500)
    return () => window.clearTimeout(timer)
  }, [msg])

  const changed = value.replace(/\s+/g, ' ').trim() !== initial
  const save = async () => {
    if (saving || !changed) return
    setSaving(true)
    setMsg(null)
    const res = await onSave(value)
    if (!aliveRef.current) return
    setSaving(false)
    setMsg(res.message ? { ok: res.ok, text: res.message } : null)
  }

  return (
    <div className="v4-fb-fix" data-v4-quickfix>
      <label className="v4-fb-fix-label" htmlFor="v4-quickfix-stock">
        종목이 틀렸나요?
      </label>
      <input
        id="v4-quickfix-stock"
        className="input v4-fb-fix-input"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        value={value}
        disabled={saving}
        onChange={(e) => {
          setValue(e.target.value)
          setMsg(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault()
            e.stopPropagation()
            void save()
          }
        }}
      />
      <button type="button" className="button v4-mini v4-touch" disabled={saving || !changed} onClick={() => void save()}>
        {saving ? '고치는 중…' : '종목 고치기'}
      </button>
      {msg ? (
        <span className={`v4-fb-fix-msg ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </span>
      ) : null}
    </div>
  )
}
