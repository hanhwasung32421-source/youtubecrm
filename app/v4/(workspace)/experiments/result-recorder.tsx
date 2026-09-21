'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { ExperimentItem } from '@/lib/v4/sample-data'
import { REOPEN_CONSEQUENCE, validateResult } from '@/lib/v4/experiment-view'
import { FormError } from '@/lib/v4/analysis-ui'
import { Field } from './field'

export type Winner = 'a' | 'b' | 'tie'
export type ResultValues = { winner: Winner; learning: string; endedOn: string }
// 저장에 실패해서 되돌아온 입력: 쓰던 내용을 그대로 채워 다시 열고 이유를 보여준다.
export type ResultDraft = { winner: Winner | ''; learning: string; endedOn: string; message: string }

const CHOICES: Array<[Winner, string]> = [
  ['a', 'A가 더 좋았어요 (지금 방식)'],
  ['b', 'B가 더 좋았어요 (새 방식)'],
  ['tie', '차이가 없었어요 (무승부)']
]

// 실험이 끝났을 때 "결과 기록": 승자 + 배운 점 + 종료일을 카드 안에서 바로 남긴다.
// 저장은 위(page)에서 "화면 먼저 바꾸고 → 서버에 저장 → 실패하면 되돌리기" 로 처리한다. 여기서는 입력만 받는다.
// Esc = 취소, Ctrl/⌘+Enter = 저장, 종료일 칸에서 Enter = 저장.
export function ResultRecorder({
  item,
  today,
  focus = 'winner',
  draft,
  onSubmit,
  onReopen,
  onCancel
}: {
  item: ExperimentItem
  today: string
  focus?: 'winner' | 'learning'
  draft?: ResultDraft | null
  onSubmit: (values: ResultValues) => void
  onReopen: () => void
  onCancel: () => void
}) {
  const [winner, setWinner] = useState<Winner | ''>(draft ? draft.winner : item.winner ?? '')
  const [learning, setLearning] = useState(draft ? draft.learning : item.learning ?? '')
  const [endedOn, setEndedOn] = useState(draft ? draft.endedOn : item.endedOn ?? (today < item.startedOn ? item.startedOn : today))
  const [submitted, setSubmitted] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const firstRef = useRef<HTMLButtonElement | null>(null)
  const learningRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (focus === 'learning') learningRef.current?.focus()
    else firstRef.current?.focus()
    // 처음 열릴 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const errors = validateResult(winner, endedOn, item.startedOn)
  const winnerError = submitted ? errors.winner : ''
  const endError = errors.endedOn

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (!winner || errors.endedOn) return
    onSubmit({ winner, learning, endedOn })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (confirmReopen) setConfirmReopen(false)
      else onCancel()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
  }

  const id = `rec-${item.id}`
  const title = !item.winner ? '결과 기록하기' : !(item.learning && item.learning.trim()) && focus === 'learning' ? '배운 점 적기' : '결과 고치기'
  return (
    <form className="v4p-rec" onSubmit={save} onKeyDown={onKeyDown} noValidate aria-label="실험 결과 기록">
      <h4 className="v4p-rec-title">{title}</h4>
      <p className="v4p-req-legend">
        <span className="v4p-req">*</span> 표시는 꼭 골라야 해요.
      </p>
      <Field id={`${id}-winner`} label="어느 쪽이 더 좋았나요?" required error={winnerError}>
        <div className={`v4p-choice ${winnerError ? 'invalid' : ''}`} role="radiogroup" aria-label="어느 쪽이 더 좋았나요?" id={`${id}-winner`}>
          {CHOICES.map(([key, text], index) => (
            <button
              key={key}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              role="radio"
              aria-checked={winner === key}
              className={`v4p-choice-item ${winner === key ? 'on' : ''}`}
              onClick={() => setWinner(key)}
            >
              {text}
            </button>
          ))}
        </div>
      </Field>
      <Field id={`${id}-learning`} label="배운 점" optional hint="다음 영상에 어떻게 쓸지 적어 두면 좋아요. 나중에 언제든 적을 수 있어요.">
        <textarea
          id={`${id}-learning`}
          ref={learningRef}
          className="textarea"
          value={learning}
          onChange={(e) => setLearning(e.target.value)}
          placeholder="예: 종목명을 크게 하니 조회수가 1.4배 나왔다. 앞으로 크게 쓰자"
          maxLength={4000}
        />
      </Field>
      <div className="v4p-form-grid">
        <Field id={`${id}-end`} label="끝난 날" hint="비워 두면 오늘로 저장돼요." error={endError}>
          <input
            id={`${id}-end`}
            className={`input ${endError ? 'invalid' : ''}`}
            type="date"
            value={endedOn}
            min={item.startedOn}
            onChange={(e) => setEndedOn(e.target.value)}
          />
        </Field>
      </div>
      {draft?.message ? <FormError message={`저장하지 못해서 원래대로 되돌렸어요. ${draft.message} 적어 둔 내용은 그대로 남아 있으니 다시 저장해 보세요.`} /> : null}
      {confirmReopen ? (
        <div className="v4p-confirm" role="alertdialog" aria-label="진행 중으로 되돌리기 확인">
          <p>{REOPEN_CONSEQUENCE}</p>
          <div className="v4p-form-actions">
            <button type="button" className="button danger" onClick={onReopen} autoFocus>
              진행 중으로 되돌리기
            </button>
            <button type="button" className="button secondary" onClick={() => setConfirmReopen(false)}>
              그만두기
            </button>
          </div>
        </div>
      ) : (
        <div className="v4p-form-actions">
          <button type="submit" className="button">
            {item.winner ? '고친 내용 저장' : '결과 저장'}
          </button>
          <button type="button" className="button secondary" onClick={onCancel}>
            취소
          </button>
          {item.winner ? (
            <button type="button" className="button secondary" onClick={() => setConfirmReopen(true)}>
              진행 중으로 되돌리기
            </button>
          ) : null}
          <span className="v4p-keyhint">Esc 취소 · Ctrl+Enter 저장</span>
        </div>
      )}
    </form>
  )
}
