'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { getKstYmd } from '@/lib/attendance/time'
import { v4Json } from '@/lib/v4/client'
import { DEFAULT_METRIC } from '@/lib/v4/experiment-consts'
import type { VideoOption } from '@/lib/v4/experiments'
import { fmtDateKst } from '@/lib/v4/format'
import type { ExperimentItem } from '@/lib/v4/sample-data'
import { Field } from './field'

type FieldKey = 'hypothesis' | 'variantA' | 'variantB' | 'startedOn'

type FormState = {
  videoId: string
  hypothesis: string
  variantA: string
  variantB: string
  metric: string
  startedOn: string
}

const emptyForm = (): FormState => ({ videoId: '', hypothesis: '', variantA: '', variantB: '', metric: '', startedOn: getKstYmd() })

function fromItem(item: ExperimentItem): FormState {
  return {
    videoId: item.videoId || '',
    hypothesis: item.hypothesis,
    variantA: item.variantA,
    variantB: item.variantB,
    metric: item.metric === DEFAULT_METRIC ? '' : item.metric,
    startedOn: item.startedOn
  }
}

// 새 실험 만들기 / 실험 내용 고치기 폼. (결과 기록은 카드 안의 ResultRecorder 에서 한다.)
// - 라벨은 칸 위, 필수는 *, 오류는 칸 아래. 저장 중에는 버튼이 "저장 중…" 으로 잠긴다.
// - 만들기 성공: 폼을 비우고 첫 칸에 커서를 둔다(이어서 등록 가능). 고치기 성공: 폼을 닫는다.
// - Esc = 닫기, Ctrl/⌘+Enter = 저장 (글이 여러 줄이라 Enter 는 줄바꿈), 한 줄 칸에서 Enter = 저장.
export function ExperimentForm({
  editing,
  videoOptions,
  onSaved,
  onClose
}: {
  editing: ExperimentItem | null
  videoOptions: VideoOption[]
  onSaved: (item: ExperimentItem, mode: 'create' | 'edit') => void
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(() => (editing ? fromItem(editing) : emptyForm()))
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [formError, setFormError] = useState('')
  const [moreOpen, setMoreOpen] = useState(() => Boolean(editing && (editing.videoId || editing.metric !== DEFAULT_METRIC)))
  const firstRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  const errors: Partial<Record<FieldKey, string>> = {}
  if (!form.hypothesis.trim()) errors.hypothesis = '무엇을 확인하고 싶은지 적어 주세요.'
  if (!form.variantA.trim()) errors.variantA = '지금 하던 방식(A)을 적어 주세요.'
  if (!form.variantB.trim()) errors.variantB = '새로 해볼 방식(B)을 적어 주세요.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startedOn)) errors.startedOn = '시작일을 선택해 주세요.'
  else if (editing?.endedOn && form.startedOn > editing.endedOn) errors.startedOn = '시작일이 끝난 날보다 늦을 수 없어요.'

  const showErr = (key: FieldKey) => (submitted || touched[key] ? errors[key] : undefined)
  const touch = (key: FieldKey) => setTouched((prev) => ({ ...prev, [key]: true }))
  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }))
    if (formError) setFormError('')
  }

  // 연결된 영상이 최근 목록(300개)에 없어도 고르기 칸에 보이도록 현재 값을 끼워 넣는다.
  const choices = [...videoOptions]
  if (editing?.videoId && !choices.some((v) => v.id === editing.videoId)) {
    choices.unshift({ id: editing.videoId, title: editing.videoTitle, stockName: editing.stockName === '-' ? '' : editing.stockName, contentType: 'longform', createdAt: '' })
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSubmitted(true)
    if (Object.keys(errors).length > 0) {
      // 첫 오류 칸으로 커서를 옮긴다.
      const first = (['hypothesis', 'variantA', 'variantB', 'startedOn'] as FieldKey[]).find((k) => errors[k])
      const ids: Record<FieldKey, string> = { hypothesis: 'exp-hypothesis', variantA: 'exp-a', variantB: 'exp-b', startedOn: 'exp-start' }
      if (first) document.getElementById(ids[first])?.focus()
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      videoId: form.videoId || null,
      hypothesis: form.hypothesis.trim(),
      variantA: form.variantA.trim(),
      variantB: form.variantB.trim(),
      metric: form.metric.trim() || DEFAULT_METRIC,
      startedOn: form.startedOn
    }
    const result = editing
      ? await v4Json<{ item: ExperimentItem }>('PATCH', `/api/v4/experiments/${editing.id}`, payload, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
      : await v4Json<{ item: ExperimentItem }>('POST', '/api/v4/experiments', payload, '실험을 등록하지 못했어요. 잠시 후 다시 시도해 주세요.')
    setSaving(false)
    if (!result.ok) {
      setFormError(result.message)
      return
    }
    onSaved(result.data.item, editing ? 'edit' : 'create')
    if (!editing) {
      setForm(emptyForm())
      setSubmitted(false)
      setTouched({})
      setMoreOpen(false)
      window.setTimeout(() => firstRef.current?.focus(), 0)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!saving) onClose()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form className="v4p-form" onSubmit={submit} onKeyDown={onKeyDown} noValidate aria-label={editing ? '실험 고치기' : '새 실험 만들기'}>
      <p className="v4p-req-legend">
        <span className="v4p-req">*</span> 표시는 꼭 적어야 해요.
      </p>
      <Field id="exp-hypothesis" label="무엇을 확인하고 싶나요?" required error={showErr('hypothesis')} hint="한 문장이면 충분해요.">
        <textarea
          id="exp-hypothesis"
          ref={firstRef}
          className={`textarea ${showErr('hypothesis') ? 'invalid' : ''}`}
          value={form.hypothesis}
          onChange={(e) => update({ hypothesis: e.target.value })}
          onBlur={() => touch('hypothesis')}
          placeholder="예: 썸네일에 종목명을 크게 넣으면 조회수가 더 잘 나온다"
          aria-invalid={Boolean(showErr('hypothesis'))}
          aria-required="true"
          maxLength={2000}
          disabled={saving}
        />
      </Field>
      <div className="v4p-form-grid">
        <Field id="exp-a" label="A · 지금 하던 방식" required error={showErr('variantA')}>
          <textarea
            id="exp-a"
            className={`textarea ${showErr('variantA') ? 'invalid' : ''}`}
            value={form.variantA}
            onChange={(e) => update({ variantA: e.target.value })}
            onBlur={() => touch('variantA')}
            placeholder="예: 종목명을 작은 글씨로"
            aria-invalid={Boolean(showErr('variantA'))}
            aria-required="true"
            maxLength={2000}
            disabled={saving}
          />
        </Field>
        <Field id="exp-b" label="B · 새로 해볼 방식" required error={showErr('variantB')}>
          <textarea
            id="exp-b"
            className={`textarea ${showErr('variantB') ? 'invalid' : ''}`}
            value={form.variantB}
            onChange={(e) => update({ variantB: e.target.value })}
            onBlur={() => touch('variantB')}
            placeholder="예: 종목명을 크게, 노란 배경으로"
            aria-invalid={Boolean(showErr('variantB'))}
            aria-required="true"
            maxLength={2000}
            disabled={saving}
          />
        </Field>
      </div>
      <div className="v4p-form-grid">
        <Field id="exp-start" label="시작일" required error={showErr('startedOn')}>
          <input
            id="exp-start"
            className={`input ${showErr('startedOn') ? 'invalid' : ''}`}
            type="date"
            value={form.startedOn}
            onChange={(e) => update({ startedOn: e.target.value })}
            onBlur={() => touch('startedOn')}
            aria-invalid={Boolean(showErr('startedOn'))}
            aria-required="true"
            disabled={saving}
          />
        </Field>
      </div>

      <details className="v4p-details" style={{ marginTop: 0 }} open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>더 적기 (선택) — 비교 기준, 대상 영상</summary>
        <div className="v4p-form" style={{ marginTop: 12 }}>
          <div className="v4p-form-grid">
            <Field id="exp-metric" label="무엇으로 비교하나요?" optional hint={`비워 두면 “${DEFAULT_METRIC}”로 저장돼요.`}>
              <input id="exp-metric" className="input" value={form.metric} onChange={(e) => update({ metric: e.target.value })} placeholder="예: 올린 지 48시간 뒤 조회수" maxLength={500} disabled={saving} />
            </Field>
            <Field id="exp-video" label="대상 영상" optional hint="특정 영상에 한 실험이면 골라 주세요.">
              <select id="exp-video" className="select" value={form.videoId} onChange={(e) => update({ videoId: e.target.value })} disabled={saving}>
                <option value="">연결 안 함 (채널 전체 실험 등)</option>
                {choices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.stockName ? `[${v.stockName}] ` : ''}
                    {v.title}
                    {v.createdAt ? ` · ${fmtDateKst(v.createdAt)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </details>

      {formError ? (
        <div className="v4p-form-error" role="alert">
          {formError}
        </div>
      ) : null}
      <div className="v4p-form-actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? '저장 중…' : editing ? '저장하기' : '실험 등록하기'}
        </button>
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
          {editing ? '취소' : '닫기'}
        </button>
        <span className="v4p-keyhint">Esc 닫기 · Ctrl+Enter 저장</span>
      </div>
    </form>
  )
}
