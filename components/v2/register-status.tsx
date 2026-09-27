'use client'

import { CONTENT_TYPE_LABELS } from '@/lib/v2/types'
import { UNDO_WINDOW_MS, undoKindOf, undoSecondsLeft, type UndoState } from './register-flow'

export type RegisterErrorView = { text: string; retry: boolean; relogin: boolean }

type Props = {
  error: RegisterErrorView | null
  info: string
  undo: UndoState
  now: number
  saving: boolean
  loginHref: string
  onRetry: () => void
  onUndo: () => void
  onBeforeRelogin: () => void
}

// 등록 결과가 나오는 "고정 높이" 칸. 성공·오류·안내가 바뀌어도 아래 화면이 위아래로 출렁이지 않는다.
export function RegisterStatus({ error, info, undo, now, saving, loginHref, onRetry, onUndo, onBeforeRelogin }: Props) {
  const entry = undo.entry

  const secondsLeft = undoSecondsLeft(undo.expiresAt, now)
  const kind = entry ? undoKindOf(entry) : 'none'
  const undoLabel = kind === 'restore' ? '이전 종목으로 되돌리기' : '되돌리기'

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
    // 형식은 서버가 실제 영상 길이로 정한 값을 그대로 보여 준다(화면에서 고르지 않는다).
    const typeLabel = `형식: ${CONTENT_TYPE_LABELS[entry.type]} (자동)`
    // 종목명이 어디서 왔는지(서버가 알려 준 값)에 따라 안내 문구를 다르게 보여 준다.
    const stockNote =
      entry.stockSource === 'title'
        ? `종목명을 제목에서 자동으로 가져왔어요: ${entry.stock}`
        : entry.stockSource === 'placeholder'
          ? '제목에서 종목명을 찾지 못했어요. 목록에서 나중에 입력해 주세요.'
          : null
    body = (
      <div className="v2-last">
        <div className="v2-confirm v2-last-line">
          <span aria-hidden="true">✓</span>{' '}
          {entry.updatedFrom && entry.updatedFrom.stock !== entry.stock ? (
            <>
              종목을 바꿨어요
              <span className="muted">
                {' '}
                · {entry.updatedFrom.stock} → {entry.stock}
              </span>
            </>
          ) : entry.origin === 'created' ? (
            <>
              등록됨 · 오늘 {entry.nth}번째
              <span className="muted">
                {' '}
                · {entry.stock} · {typeLabel}
              </span>
            </>
          ) : (
            <>
              등록했어요 · 이미 있던 영상이에요
              <span className="muted">
                {' '}
                · {entry.stock} · {typeLabel}
              </span>
            </>
          )}
        </div>

        {stockNote ? (
          <div className="v2-hint quiet" role="status">
            {stockNote}
          </div>
        ) : null}

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
              {kind === 'none'
                ? entry.origin === 'existing'
                  ? '이미 등록돼 있던 영상이라 새로 만들어진 것은 없어요. 종목을 고치려면 아래 목록에서 「수정」을 눌러 주세요.'
                  : '새 영상인지 확인하지 못해서 되돌리기는 열지 않았어요. 종목을 고치려면 아래 목록에서 「수정」을 눌러 주세요.'
                : '되돌리기 시간이 지났어요. 잘못 등록했다면 아래 목록에서 「삭제」를 눌러 주세요.'}
            </span>
          )}
          {undo.error ? (
            <span className="v2-hint" role="alert">
              {undo.error}
            </span>
          ) : null}
        </div>
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
