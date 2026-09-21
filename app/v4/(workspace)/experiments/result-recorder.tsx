'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { v4Json } from '@/lib/v4/client'
import type { ExperimentItem } from '@/lib/v4/sample-data'
import { Field } from './field'

type Winner = 'a' | 'b' | 'tie'

const CHOICES: Array<[Winner, string]> = [
  ['a', 'A가 더 좋았어요 (지금 방식)'],
  ['b', 'B가 더 좋았어요 (새 방식)'],
  ['tie', '차이가 없었어요 (무승부)']
]

// 실험이 끝났을 때 "결과 기록": 승자 + 배운 점 + 종료일을 카드 안에서 바로 남긴다.
// Esc = 취소, Ctrl/⌘+Enter = 저장, 종료일 칸에서 Enter = 저장.
export function ResultRecorder({
  item,
  today,
  onSaved,
  onCancel
}: {
  item: ExperimentItem
  today: string
  onSaved: (item: ExperimentItem, message: string) => void
  onCancel: () => void
}) {
  const [winner, setWinner] = useState<Winner | ''>(item.winner ?? '')
  const [learning, setLearning] = useState(item.learning ?? '')
  const [endedOn, setEndedOn] = useState(item.endedOn ?? (today < item.startedOn ? item.startedOn : today))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const firstRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  const winnerError = submitted && !winner ? '어느 쪽이 더 좋았는지 골라 주세요.' : ''
  const endError = endedOn && endedOn < item.startedOn ? '종료일은 시작일보다 빠를 수 없어요.' : ''

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSubmitted(true)
    if (!winner || endError) return
    setSaving(true)
    setError('')
    const result = await v4Json<{ item: ExperimentItem }>(
      'PATCH',
      `/api/v4/experiments/${item.id}`,
      { winner, learning: learning.trim() || null, endedOn: endedOn || today },
      '결과를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
    )
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSaved(result.data.item, item.winner ? '결과를 고쳤어요.' : '결과를 기록했어요. 끝난 실험으로 옮겼어요.')
  }

  // 결과를 비우고 다시 "진행 중"으로 되돌린다 (두 번 눌러야 실행)
  const reopen = async () => {
    if (!confirmReopen) {
      setConfirmReopen(true)
      return
    }
    if (saving) return
    setSaving(true)
    setError('')
    const result = await v4Json<{ item: ExperimentItem }>(
      'PATCH',
      `/api/v4/experiments/${item.id}`,
      { winner: null, endedOn: null },
      '진행 중으로 되돌리지 못했어요. 잠시 후 다시 시도해 주세요.'
    )
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      setConfirmReopen(false)
      return
    }
    onSaved(result.data.item, '진행 중인 실험으로 되돌렸어요.')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!saving) onCancel()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void save()
    }
  }

  const id = `rec-${item.id}`
  return (
    <form className="v4p-rec" onSubmit={save} onKeyDown={onKeyDown} noValidate aria-label="실험 결과 기록">
      <h4 className="v4p-rec-title">{item.winner ? '결과 고치기' : '결과 기록'}</h4>
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
              disabled={saving}
            >
              {text}
            </button>
          ))}
        </div>
      </Field>
      <Field id={`${id}-learning`} label="배운 점" optional hint="다음 영상에 어떻게 쓸지 적어 두면 좋아요.">
        <textarea
          id={`${id}-learning`}
          className="textarea"
          value={learning}
          onChange={(e) => setLearning(e.target.value)}
          placeholder="예: 종목명을 크게 하니 조회수가 1.4배 나왔다. 앞으로 크게 쓰자"
          disabled={saving}
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
            disabled={saving}
          />
        </Field>
      </div>
      {error ? (
        <div className="v4p-form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="v4p-form-actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? '저장 중…' : item.winner ? '고친 내용 저장' : '결과 저장'}
        </button>
        <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>
          취소
        </button>
        {item.winner ? (
          <button type="button" className={confirmReopen ? 'button danger' : 'button secondary'} onClick={() => void reopen()} disabled={saving} onBlur={() => setConfirmReopen(false)}>
            {confirmReopen ? '정말 되돌리기' : '진행 중으로 되돌리기'}
          </button>
        ) : null}
        <span className="v4p-keyhint">Esc 취소 · Ctrl+Enter 저장</span>
      </div>
    </form>
  )
}
