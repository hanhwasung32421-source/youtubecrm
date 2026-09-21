'use client'

import type { Failure, UndoState } from './register-logic'

// 등록 결과를 보여 주는 "고정 높이" 칸. 성공·실패·되돌리기·대기 문구가 모두 같은 자리에서 바뀌므로
// 결과가 나타나거나 사라져도 아래 화면이 위아래로 밀리지 않는다.

export type RegStatus =
  | { id: number; kind: 'ok'; title: string; detail: string; count?: number; note?: string }
  | { id: number; kind: 'error'; failure: Failure }

export function StatusSlot({
  status,
  undo,
  secondsLeft,
  busy,
  loginHref,
  onUndo,
  onRetry
}: {
  status: RegStatus | null
  undo: UndoState
  secondsLeft: number
  busy: boolean
  loginHref: string
  onUndo: () => void
  onRetry: () => void
}) {
  // 알림 영역(aria-live / role=alert)은 항상 화면에 있어야 내용이 바뀔 때 스크린리더가 읽어 준다.
  let tone: 'idle' | 'ok' | 'error' = 'idle'
  let okMain = ''
  let errorMain = ''
  let sub = '주소를 붙여넣고 Enter를 누르면 등록돼요. 다음 영상도 바로 이어서 넣으세요.'
  let actions: React.ReactNode = null

  if (status && status.kind === 'error') {
    const { failure } = status
    tone = 'error'
    errorMain = failure.message
    sub = ''
    actions = (
      <>
        {failure.kind === 'auth' ? (
          <a className="button xs" href={loginHref}>
            다시 로그인
          </a>
        ) : null}
        {failure.retry ? (
          <button type="button" className="button xs" disabled={busy} onClick={onRetry}>
            {busy ? '다시 시도 중…' : '다시 시도'}
          </button>
        ) : null}
      </>
    )
  } else if (status) {
    tone = 'ok'
    const count = status.count ? ` · 오늘 ${status.count}번째` : ''
    okMain = `${status.title}${count} · ${status.detail}`
    sub = status.note ?? '종목이 틀렸다면 아래 목록의 첫 줄에서 바로 고칠 수 있어요.'

    if (undo.phase === 'open') {
      sub = '방금 등록한 영상이 잘못됐나요? 지금 되돌릴 수 있어요.'
      actions = (
        <button type="button" className="button secondary xs" onClick={onUndo} aria-label="방금 등록한 영상 되돌리기">
          되돌리기 ({secondsLeft}초)
        </button>
      )
    } else if (undo.phase === 'working') {
      sub = '되돌리는 중이에요…'
      actions = (
        <button type="button" className="button secondary xs" disabled>
          되돌리는 중…
        </button>
      )
    } else if (undo.phase === 'failed') {
      sub = `${undo.message} 아래 목록의 삭제·수정으로도 고칠 수 있어요.`
      actions = (
        <button type="button" className="button secondary xs" onClick={onUndo}>
          다시 되돌리기
        </button>
      )
    }
  }

  return (
    <div className={`v3-reg-slot ${tone}`}>
      <div className="v3-reg-slot-text">
        <span className="v3-reg-slot-main" aria-live="polite" aria-atomic="true">
          {okMain}
        </span>
        <span className="v3-reg-slot-main" role="alert">
          {errorMain}
        </span>
        <span className="v3-reg-slot-sub">{sub}</span>
      </div>
      {actions ? <div className="v3-reg-slot-actions">{actions}</div> : null}
    </div>
  )
}
