'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/v5/app-shell'
import { Toast, useToast } from '@/components/toast'
import { authedDeleteJson, authedPatchJson, errorText, v5Post } from '@/lib/v5/client'
import { formatDayShort, isoWeekRangeText } from '@/lib/v5/format'
import { AnswerBanner, EmptyBlock, ErrorText, FormField, LoadError, RelTime, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import { RetroSkeleton } from '@/lib/v5/skeleton'
import { useV5Query } from '@/lib/v5/swr'
import { ConfirmDelete, useBeforeUnload, useEscape } from '@/lib/v5/ui'
import type { RetroActionItem, WeeklyRetro } from '@/lib/v5/types'

const MAX_ACTIONS = 20

type EditorValues = { wentWell: string; toImprove: string; actionItems: RetroActionItem[] }
type SubmitResult = { message: string; extra?: ReactNode } | null

// ---------------------------------------------------------------------------
// 회고 작성/수정 폼(새로 쓸 때와 고칠 때 같은 모양). 저장 중 잠금, Enter 로 할 일 추가,
// Ctrl+Enter 로 저장, Esc 로 취소(수정 중일 때).
// ---------------------------------------------------------------------------
function RetroEditor({
  idPrefix,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSuccess,
  header
}: {
  idPrefix: string
  initial: EditorValues
  submitLabel: string
  onSubmit: (values: EditorValues) => Promise<SubmitResult>
  onCancel?: () => void
  resetOnSuccess?: boolean
  header?: ReactNode
}) {
  const [wentWell, setWentWell] = useState(initial.wentWell)
  const [toImprove, setToImprove] = useState(initial.toImprove)
  const [actionItems, setActionItems] = useState<RetroActionItem[]>(initial.actionItems)
  const [actionDraft, setActionDraft] = useState('')
  const [error, setError] = useState<SubmitResult>(null)
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const savingRef = useRef(false)
  const firstRef = useRef<HTMLTextAreaElement>(null)

  // 실제로 바뀐 것이 있을 때만 "쓰던 내용이 사라져요"를 묻는다.
  const dirty =
    wentWell.trim() !== initial.wentWell.trim() ||
    toImprove.trim() !== initial.toImprove.trim() ||
    actionDraft.trim() !== '' ||
    JSON.stringify(actionItems) !== JSON.stringify(initial.actionItems)
  useBeforeUnload(dirty)

  const requestCancel = () => {
    if (savingRef.current) return
    if (dirty) setAsking(true)
    else onCancel?.()
  }

  useEscape(Boolean(onCancel), () => {
    if (asking) setAsking(false)
    else requestCancel()
  })

  // 고치기를 누르면 바로 쓸 수 있게(처음 열릴 때 한 번만)
  useEffect(() => {
    if (onCancel) firstRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addActionItem = () => {
    const text = actionDraft.trim()
    if (!text) return
    if (actionItems.length >= MAX_ACTIONS) {
      setError({ message: `할 일은 ${MAX_ACTIONS}개까지 적을 수 있어요.` })
      return
    }
    setActionItems((prev) => [...prev, { text, done: false }])
    setActionDraft('')
    setError(null)
  }

  const submit = async () => {
    if (savingRef.current) return
    // 입력 중이던 할 일도 놓치지 않게 함께 저장한다.
    const draft = actionDraft.trim()
    const finalActions = draft ? [...actionItems, { text: draft, done: false }] : actionItems
    if (finalActions.length > MAX_ACTIONS) {
      setError({ message: `할 일은 ${MAX_ACTIONS}개까지 적을 수 있어요.` })
      return
    }
    if (!wentWell.trim() && !toImprove.trim() && finalActions.length === 0) {
      setError({ message: '한 줄이라도 적어 주세요. 예: “숏폼 조회수가 늘었어요.”' })
      return
    }
    setError(null)
    savingRef.current = true
    setSaving(true)
    try {
      const result = await onSubmit({ wentWell: wentWell.trim(), toImprove: toImprove.trim(), actionItems: finalActions })
      if (result) {
        setError(result)
        return
      }
      if (resetOnSuccess) {
        setWentWell('')
        setToImprove('')
        setActionDraft('')
        setActionItems([])
        firstRef.current?.focus()
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const onTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form
      className="v5p-editor"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {header}
      <div className="v5p-form-cols">
        <FormField label="잘된 점" hint="이번 주 반응이 좋았던 것" htmlFor={`${idPrefix}-well`}>
          <textarea
            id={`${idPrefix}-well`}
            ref={firstRef}
            className="textarea"
            rows={3}
            maxLength={2000}
            value={wentWell}
            onChange={(e) => {
              setWentWell(e.target.value)
              setError(null)
            }}
            onKeyDown={onTextareaKey}
            placeholder="예: 반도체 종목 영상 조회수가 평소보다 컸어요"
          />
        </FormField>
        <FormField label="고칠 점" hint="아쉬웠던 것" htmlFor={`${idPrefix}-imp`}>
          <textarea
            id={`${idPrefix}-imp`}
            className="textarea"
            rows={3}
            maxLength={2000}
            value={toImprove}
            onChange={(e) => {
              setToImprove(e.target.value)
              setError(null)
            }}
            onKeyDown={onTextareaKey}
            placeholder="예: 숏폼은 앞 3초에 시선을 못 잡았어요"
          />
        </FormField>
      </div>
      <FormField label="다음 주 할 일" optional hint="하나 쓰고 Enter 키를 누르면 목록에 추가돼요." htmlFor={`${idPrefix}-act`}>
        <div className="row">
          <input
            id={`${idPrefix}-act`}
            className="input"
            value={actionDraft}
            maxLength={300}
            onChange={(e) => setActionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                addActionItem()
              }
            }}
            placeholder="예: 숏폼 첫 3초 훅 다시 만들어 보기"
          />
          <button className="button secondary nowrap" type="button" onClick={addActionItem}>
            추가
          </button>
        </div>
        {actionItems.length > 0 ? (
          <ul className="v5p-todo added">
            {actionItems.map((item, idx) => (
              <li key={idx}>
                <label className={item.done ? 'done' : ''}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => setActionItems((prev) => prev.map((a, i) => (i === idx ? { ...a, done: !a.done } : a)))}
                    aria-label={`“${item.text}” 끝냈어요`}
                  />
                  <span>{item.text}</span>
                </label>
                <button type="button" className="button xs ghost" onClick={() => setActionItems((prev) => prev.filter((_, i) => i !== idx))} aria-label={`“${item.text}” 빼기`}>
                  빼기
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </FormField>
      {error ? (
        <div className="v5p-field-error" role="alert">
          <ErrorText message={error.message} />
          {error.extra ? <span className="v5p-inline-action">{error.extra}</span> : null}
        </div>
      ) : null}
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="button" type="submit" disabled={saving}>
          {saving ? '저장 중…' : submitLabel}
        </button>
        {onCancel && !asking ? (
          <button className="button secondary" type="button" disabled={saving} onClick={requestCancel}>
            취소
          </button>
        ) : null}
        {onCancel && asking ? (
          <>
            <span className="small v5p-discard-inline">쓰던 내용이 사라져요. 닫을까요?</span>
            <button className="button secondary" type="button" onClick={() => setAsking(false)}>
              계속 쓰기
            </button>
            <button className="button danger" type="button" onClick={onCancel}>
              닫기
            </button>
          </>
        ) : null}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 저장해 둔 지표(KPI) 한 줄
// ---------------------------------------------------------------------------
function kpiLine(retro: WeeklyRetro) {
  const k = retro.kpi_snapshot
  if (!k || k.totalVideos === undefined) return null
  const range = k.weekStart && k.weekEnd ? `${formatDayShort(k.weekStart)} ~ ${formatDayShort(k.weekEnd)} 등록 영상` : '쓸 당시 최근 7일 기록: 영상'
  const parts = [`${range} ${fmtNum(k.totalVideos)}편`, `조회수 합계 ${fmtNum(k.totalViews)}`]
  if (k.unsyncedVideos) parts.push(`조회수 미확인 ${fmtNum(k.unsyncedVideos)}편 포함`)
  if (k.truncated) parts.push('일부만 집계')
  return parts.join(' · ')
}

function mergeValues(retro: WeeklyRetro, draft: EditorValues | null): EditorValues {
  const base: EditorValues = { wentWell: retro.went_well || '', toImprove: retro.to_improve || '', actionItems: retro.action_items }
  if (!draft) return base
  const join = (a: string, b: string) => (a && b ? `${a}\n${b}` : a || b)
  const seen = new Set(base.actionItems.map((a) => a.text))
  return {
    wentWell: join(base.wentWell, draft.wentWell),
    toImprove: join(base.toImprove, draft.toImprove),
    actionItems: [...base.actionItems, ...draft.actionItems.filter((a) => !seen.has(a.text))].slice(0, MAX_ACTIONS)
  }
}

function RetroCard({
  retro,
  weekBadge,
  highlight,
  editOnMount,
  editRequest,
  editable,
  onToggle,
  onSave,
  onDelete
}: {
  retro: WeeklyRetro
  weekBadge?: string
  highlight?: boolean
  editOnMount?: EditorValues | null
  editRequest: boolean
  editable: boolean
  onToggle: (idx: number) => void
  onSave: (values: EditorValues) => Promise<SubmitResult>
  onDelete: () => Promise<string | null>
}) {
  const [editing, setEditing] = useState<EditorValues | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const done = retro.action_items.filter((a) => a.done).length
  const kpi = kpiLine(retro)

  // "기존 회고에 이어서 쓰기"로 들어온 경우 바로 수정 모드로 연다.
  useEffect(() => {
    if (editRequest) setEditing(mergeValues(retro, editOnMount || null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])

  const startEdit = () => setEditing(mergeValues(retro, null))

  return (
    <article className={`v5p-retro-card ${highlight ? 'current' : ''}`} id={`retro-${retro.id}`}>
      <header className="v5p-retro-head">
        <h3>
          {isoWeekRangeText(retro.week_label)}
          {weekBadge ? <span className="v5p-week-badge">{weekBadge}</span> : null}
        </h3>
        <span className="small muted">
          {retro.author_name || '관리자'} · <RelTime value={retro.created_at} /> 작성
        </span>
      </header>

      {editing ? (
        <RetroEditor
          idPrefix={`v5p-edit-${retro.id}`}
          initial={editing}
          submitLabel="저장"
          onCancel={() => setEditing(null)}
          onSubmit={async (values) => {
            const result = await onSave(values)
            if (!result) setEditing(null)
            return result
          }}
        />
      ) : (
        <>
          {retro.went_well ? (
            <div className="v5p-retro-block">
              <div className="v5p-card-key">잘된 점</div>
              <div className="v5p-prewrap">{retro.went_well}</div>
            </div>
          ) : null}
          {retro.to_improve ? (
            <div className="v5p-retro-block">
              <div className="v5p-card-key">고칠 점</div>
              <div className="v5p-prewrap">{retro.to_improve}</div>
            </div>
          ) : null}
          {retro.action_items.length > 0 ? (
            <div className="v5p-retro-block">
              <div className="v5p-card-key">
                다음 주 할 일 · {fmtNum(done)}/{fmtNum(retro.action_items.length)} 완료
              </div>
              <ul className="v5p-todo">
                {retro.action_items.map((item, idx) => (
                  <li key={idx}>
                    <label className={item.done ? 'done' : ''}>
                      <input type="checkbox" checked={item.done} disabled={!editable} onChange={() => onToggle(idx)} />
                      <span>{item.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!retro.went_well && !retro.to_improve && retro.action_items.length === 0 ? <div className="small muted">적힌 내용이 없어요.</div> : null}
        </>
      )}

      {kpi ? <footer className="v5p-retro-foot small muted">{kpi}</footer> : null}

      {editable && !editing ? (
        <div className="v5p-retro-manage">
          <button type="button" className="button xs secondary" onClick={startEdit}>
            고치기
          </button>
          <ConfirmDelete
            busy={deleting}
            question="이 회고를 지울까요?"
            onConfirm={async () => {
              setDeleting(true)
              setDeleteError('')
              const message = await onDelete()
              if (message) setDeleteError(message)
              setDeleting(false)
            }}
          />
          {deleteError ? (
            <span className="v5p-field-error" role="alert">
              <ErrorText message={deleteError} />
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export default function RetrosPage() {
  const { toast, showSuccess, showError } = useToast()
  const q = useV5Query<{ sample?: boolean; items: WeeklyRetro[]; thisWeekLabel?: string; lastWeekLabel?: string }>('/api/v5/retros', { errorFallback: '주간 회고를 불러오지 못했어요.' })
  const { update: updateData, reload, rev } = q
  const items = useMemo(() => q.data?.items || [], [q.data])
  const sample = Boolean(q.data?.sample)
  const thisWeek = q.data?.thisWeekLabel || ''
  const lastWeek = q.data?.lastWeekLabel || ''
  // showError 는 렌더마다 바뀔 수 있으므로 큐(비동기) 안에서는 ref 로만 쓴다.
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError
  // 저장 결과를 화면과 캐시에 함께 반영한다.
  const setItems = (fn: (prev: WeeklyRetro[]) => WeeklyRetro[]) => updateData((d) => ({ ...d, items: fn(d.items || []) }))
  // 새로 쓰는 주. 기본은 이번 주, "지난주 회고 쓰기"를 누르면 지난주.
  const [target, setTarget] = useState<'this' | 'last'>('this')
  const [showLastForm, setShowLastForm] = useState(false)
  // 이미 있는 회고에 이어 쓰기 요청(동시 저장 충돌 시)
  const [continueReq, setContinueReq] = useState<{ id: string; draft: EditorValues } | null>(null)

  const itemsRef = useRef<WeeklyRetro[]>([])
  itemsRef.current = items
  // 서버가 마지막으로 확인해 준 액션 아이템(체크 저장에 실패했을 때 되돌릴 기준)
  const confirmedRef = useRef(new Map<string, RetroActionItem[]>())
  const queueRef = useRef(new Map<string, Promise<void>>())

  // 서버가 확인해 준 값(새로 받을 때마다)을 "되돌릴 기준"으로 삼는다. 체크를 눌러 화면만 바꾼 것은 여기 포함되지 않는다.
  useEffect(() => {
    if (rev === 0) return
    confirmedRef.current = new Map((q.data?.items || []).map((r) => [r.id, r.action_items]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev])

  const current = useMemo(() => items.find((r) => r.week_label === thisWeek) || null, [items, thisWeek])
  const lastRetroOfLastWeek = useMemo(() => items.find((r) => r.week_label === lastWeek) || null, [items, lastWeek])
  const previous = useMemo(() => items.filter((r) => r.week_label !== thisWeek), [items, thisWeek])
  const lastRetro = previous[0] || null
  const carryOver = useMemo(() => (lastRetro ? lastRetro.action_items.map((a, idx) => ({ ...a, idx })).filter((a) => !a.done) : []), [lastRetro])

  const weekLabelOf = (which: 'this' | 'last') => (which === 'this' ? thisWeek : lastWeek)

  const weekBadgeOf = (label: string) => (label === thisWeek ? '이번 주' : label === lastWeek ? '지난주' : undefined)

  // 새 회고 저장
  const onCreate = async (values: EditorValues, which: 'this' | 'last'): Promise<SubmitResult> => {
    const res = await v5Post<{ item: WeeklyRetro; code?: string; existingId?: string }>('/api/v5/retros', {
      weekLabel: weekLabelOf(which),
      wentWell: values.wentWell,
      toImprove: values.toImprove,
      actionItems: values.actionItems
    })
    if (!res.ok) {
      const message = errorText(res, '저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
      if (res.status === 409 && res.data?.code === 'exists' && res.data.existingId) {
        const existingId = res.data.existingId
        return {
          message,
          extra: (
            <button
              type="button"
              className="button xs secondary"
              onClick={async () => {
                setContinueReq({ id: existingId, draft: values })
                reload()
              }}
            >
              쓰던 내용을 그 회고에 이어 쓰기
            </button>
          )
        }
      }
      return { message }
    }
    const saved = res.data.item
    confirmedRef.current.set(saved.id, saved.action_items)
    setItems((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)].sort((a, b) => b.week_label.localeCompare(a.week_label)))
    setShowLastForm(false)
    setTarget('this')
    showSuccess(`${weekBadgeOf(saved.week_label) || isoWeekRangeText(saved.week_label)} 회고를 저장했어요.`)
    return null
  }

  // 회고 내용 고치기
  const onSave = async (retroId: string, values: EditorValues): Promise<SubmitResult> => {
    const res = await authedPatchJson<{ item: WeeklyRetro }>(`/api/v5/retros/${retroId}`, {
      wentWell: values.wentWell,
      toImprove: values.toImprove,
      actionItems: values.actionItems
    })
    if (!res.ok) {
      if (res.status === 404) reload()
      return { message: errorText(res, '저장하지 못했어요. 잠시 뒤 다시 해 주세요.') }
    }
    const saved = res.data.item
    confirmedRef.current.set(saved.id, saved.action_items)
    setItems((prev) => prev.map((r) => (r.id === retroId ? saved : r)))
    setContinueReq(null)
    return null
  }

  const onDelete = async (retroId: string): Promise<string | null> => {
    const res = await authedDeleteJson(`/api/v5/retros/${retroId}`)
    if (!res.ok) return errorText(res, '지우지 못했어요. 잠시 뒤 다시 해 주세요.')
    confirmedRef.current.delete(retroId)
    setItems((prev) => prev.filter((r) => r.id !== retroId))
    return null
  }

  // 할 일 체크: 화면에 먼저 반영하고(낙관적), 저장은 회고별로 한 줄로 세워서 순서가 꼬이지 않게 한다.
  // 저장이 실패하면 서버가 마지막으로 확인해 준 상태로 되돌린다.
  const onToggle = (retroId: string, idx: number) => {
    const target = itemsRef.current.find((r) => r.id === retroId)
    if (!target || !target.action_items[idx]) return
    const nextItems = target.action_items.map((item, i) => (i === idx ? { ...item, done: !item.done } : item))
    setItems((prev) => prev.map((r) => (r.id === retroId ? { ...r, action_items: nextItems } : r)))
    itemsRef.current = itemsRef.current.map((r) => (r.id === retroId ? { ...r, action_items: nextItems } : r))

    const previousTask = queueRef.current.get(retroId) || Promise.resolve()
    const task = previousTask.then(async () => {
      // 대기하는 사이에 또 눌렀다면 가장 최신 상태를 한 번에 저장한다.
      const latest = itemsRef.current.find((r) => r.id === retroId)
      if (!latest) return
      const res = await authedPatchJson<{ item: WeeklyRetro }>(`/api/v5/retros/${retroId}`, { actionItems: latest.action_items })
      if (res.ok) {
        confirmedRef.current.set(retroId, res.data.item.action_items)
        return
      }
      const confirmed = confirmedRef.current.get(retroId)
      if (confirmed) {
        itemsRef.current = itemsRef.current.map((r) => (r.id === retroId ? { ...r, action_items: confirmed } : r))
        setItems((prev) => prev.map((r) => (r.id === retroId ? { ...r, action_items: confirmed } : r)))
      }
      showErrorRef.current(`체크를 저장하지 못해서 원래대로 돌려놨어요. ${errorText(res, '')}`.trim())
    })
    queueRef.current.set(retroId, task)
  }

  const weekRange = thisWeek ? isoWeekRangeText(thisWeek) : ''
  const doneCount = current ? current.action_items.filter((a) => a.done).length : 0
  const showThisForm = !current
  const showLastFormNow = showLastForm && !lastRetroOfLastWeek && Boolean(lastWeek) && lastWeek !== thisWeek
  const canOfferLast = Boolean(current) && !lastRetroOfLastWeek && Boolean(lastWeek) && items.length > 0
  const shownList = current ? items : previous
  const ready = Boolean(q.data)

  const createHeader = (which: 'this' | 'last', title: string) => (
    <div className="v5p-section-head">
      <h2>{title}</h2>
      <span className="small muted">한 줄이면 충분해요 · 그 주의 조회수·영상 수는 저장할 때 자동으로 함께 남아요</span>
      {which === 'this' && !current && lastWeek && !lastRetroOfLastWeek && items.length > 0 ? (
        <button type="button" className="button xs ghost" onClick={() => setTarget('last')}>
          지난주 회고를 쓰려면 여기
        </button>
      ) : null}
    </div>
  )

  return (
    <>
      <PageHeader title="주간 회고" subtitle="한 주를 돌아보며 잘된 점, 고칠 점, 다음 주 할 일을 남겨요." />

      <SampleNote show={sample} />

      {q.error ? <LoadError message={q.error} status={q.status} onRetry={reload} /> : null}
      {!ready && !q.error ? <RetroSkeleton /> : null}

      {ready ? (
        <div className={q.validating ? 'v5p-refreshing' : undefined} aria-busy={q.validating}>
          <AnswerBanner
            label={`이번 주 (${weekRange})`}
            tone={current ? 'good' : 'neutral'}
            aside={
              !current && lastRetro ? (
                <span className="small muted">
                  지난 회고 ({isoWeekRangeText(lastRetro.week_label)}){lastRetro.went_well ? ` · 잘된 점: ${lastRetro.went_well.slice(0, 50)}${lastRetro.went_well.length > 50 ? '…' : ''}` : ''}
                </span>
              ) : null
            }
          >
            {current ? (
              <>
                이번 주 회고를 <strong>이미 썼어요</strong>
                {current.action_items.length > 0 ? ` · 다음 주 할 일 ${fmtNum(doneCount)}/${fmtNum(current.action_items.length)} 완료` : ''}
              </>
            ) : items.length === 0 ? (
              <>아직 쓴 회고가 없어요. 이번 주 것부터 한 줄만 적어 볼까요?</>
            ) : (
              <>
                이번 주 회고를 <strong>아직 안 썼어요</strong>
                {carryOver.length > 0 ? ` · 지난주에 못 끝낸 할 일 ${fmtNum(carryOver.length)}개` : ''}
              </>
            )}
          </AnswerBanner>

          {!current && carryOver.length > 0 && lastRetro ? (
            <section className="v5p-carry" aria-label="지난주에 못 끝낸 할 일">
              <div className="v5p-section-head">
                <h2>지난주에 못 끝낸 할 일</h2>
                <span className="small muted">끝냈다면 체크해 두세요</span>
              </div>
              <ul className="v5p-todo">
                {carryOver.map((a) => (
                  <li key={a.idx}>
                    <label>
                      <input type="checkbox" checked={false} onChange={() => onToggle(lastRetro.id, a.idx)} />
                      <span>{a.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {showThisForm && !sample ? (
            <section className="v5p-retro-form" aria-label="회고 쓰기">
              {target === 'last' && lastWeek && !lastRetroOfLastWeek ? (
                <>
                  {createHeader('last', `지난주 회고 쓰기 (${isoWeekRangeText(lastWeek)})`)}
                  <RetroEditor key="last" idPrefix="v5p-new-last" initial={{ wentWell: '', toImprove: '', actionItems: [] }} submitLabel="지난주 회고 저장" resetOnSuccess onSubmit={(v) => onCreate(v, 'last')} />
                  <button type="button" className="button xs ghost" style={{ marginTop: 8 }} onClick={() => setTarget('this')}>
                    이번 주 회고 쓰기로 돌아가기
                  </button>
                </>
              ) : (
                <>
                  {createHeader('this', '이번 주 회고 쓰기')}
                  <RetroEditor key="this" idPrefix="v5p-new" initial={{ wentWell: '', toImprove: '', actionItems: [] }} submitLabel="이번 주 회고 저장" resetOnSuccess onSubmit={(v) => onCreate(v, 'this')} />
                </>
              )}
            </section>
          ) : null}

          {canOfferLast && !sample ? (
            showLastFormNow ? (
              <section className="v5p-retro-form" aria-label="지난주 회고 쓰기">
                {createHeader('last', `지난주 회고 쓰기 (${isoWeekRangeText(lastWeek)})`)}
                <RetroEditor idPrefix="v5p-new-last2" initial={{ wentWell: '', toImprove: '', actionItems: [] }} submitLabel="지난주 회고 저장" resetOnSuccess onSubmit={(v) => onCreate(v, 'last')} onCancel={() => setShowLastForm(false)} />
              </section>
            ) : (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="button xs secondary" onClick={() => setShowLastForm(true)}>
                  지난주({isoWeekRangeText(lastWeek)}) 회고도 쓰기
                </button>
              </div>
            )
          ) : null}

          <section style={{ marginTop: 24 }} aria-label="회고 기록">
            <div className="v5p-section-head">
              <h2>{current ? '회고 기록' : '지난 회고'}</h2>
            </div>
            {shownList.length === 0 ? (
              <EmptyBlock title="아직 지난 회고가 없어요">회고를 저장하면 여기에 주마다 쌓여요.</EmptyBlock>
            ) : (
              <div className="v5p-retro-grid">
                {shownList.map((retro) => (
                  <RetroCard
                    key={retro.id}
                    retro={retro}
                    weekBadge={weekBadgeOf(retro.week_label)}
                    highlight={retro.week_label === thisWeek}
                    editable={!sample}
                    editRequest={continueReq?.id === retro.id}
                    editOnMount={continueReq?.id === retro.id ? continueReq.draft : null}
                    onToggle={(idx) => onToggle(retro.id, idx)}
                    onSave={(values) => onSave(retro.id, values)}
                    onDelete={() => onDelete(retro.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      <Toast toast={toast} />
    </>
  )
}
