'use client'

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/v5/app-shell'
import { Toast, useToast } from '@/components/toast'
import { authedDeleteJson, authedPatchJson, errorText, v5Post } from '@/lib/v5/client'
import { RETRO_SPEC } from '@/lib/v5/filters'
import { formatDayShort, formatRelative, isoWeekRangeText, todayYmd } from '@/lib/v5/format'
import { CopyLinkButton, ExportCsvButton, useNow } from '@/lib/v5/insight-parts'
import { AnswerBanner, EmptyBlock, ErrorText, FormField, LoadError, RelTime, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import {
  buildRetroDraft,
  parseStoredDraft,
  retroDraftKey,
  sameDraftValues,
  serializeDraft,
  weekSwitch,
  weekWord,
  type DraftValues,
  type RetroDraftData
} from '@/lib/v5/retro-draft'
import { RetroSkeleton } from '@/lib/v5/skeleton'
import { useV5Query } from '@/lib/v5/swr'
import { ConfirmDelete, useBeforeUnload, useEscape, useKstToday } from '@/lib/v5/ui'
import { useUrlFilters } from '@/lib/v5/use-filters'
import type { RetroActionItem, WeeklyRetro } from '@/lib/v5/types'

const MAX_ACTIONS = 20
const FILTER_KEY = 'v5.retros.filters.v1'

type EditorValues = { wentWell: string; toImprove: string; actionItems: RetroActionItem[] }
// extra: 오류 옆에 붙이는 버튼. discard() 를 부르면 이 편집기의 임시 저장본을 지우고 화면을 떠날 때 다시 저장하지 않는다.
type SubmitResult = { message: string; extra?: (discard: () => void) => ReactNode } | null

// "방금" / "3분 전"
const agoText = (ts: number, now: number) => (now - ts < 60_000 ? '방금' : formatRelative(ts, now))
const toDraftValues = (v: EditorValues, actionDraft = ''): DraftValues => ({ wentWell: v.wentWell, toImprove: v.toImprove, actionItems: v.actionItems, actionDraft })

function loadStoredDraft(draftKey: string | undefined, initial: EditorValues) {
  if (!draftKey || typeof window === 'undefined') return null
  try {
    const parsed = parseStoredDraft(window.localStorage.getItem(draftKey))
    if (!parsed) return null
    // 저장해 둔 것이 처음 값과 같다면 물어볼 필요가 없다.
    if (sameDraftValues(parsed.values, toDraftValues(initial))) {
      window.localStorage.removeItem(draftKey)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function clearStoredDraft(draftKey: string | undefined) {
  if (!draftKey) return
  try {
    window.localStorage.removeItem(draftKey)
  } catch {
    // 저장소를 못 써도 화면은 정상 동작
  }
}

// ---------------------------------------------------------------------------
// 회고 작성/수정 폼(새로 쓸 때와 고칠 때 같은 모양). 저장 중 잠금, Enter 로 할 일 추가,
// Ctrl+Enter 로 저장, Esc 로 취소(수정 중일 때). draftKey 가 있으면 쓰는 대로 브라우저에 임시 저장한다.
// ---------------------------------------------------------------------------
function RetroEditor({
  idPrefix,
  initial: initialProp,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSuccess,
  header,
  draftKey,
  autoFilled
}: {
  idPrefix: string
  initial: EditorValues
  submitLabel: string
  onSubmit: (values: EditorValues) => Promise<SubmitResult>
  onCancel?: () => void
  resetOnSuccess?: boolean
  header?: ReactNode
  // 이 값이 있으면 쓰는 내용을 브라우저에 임시 저장하고, 다음에 열 때 이어 쓸지 묻는다.
  draftKey?: string
  // 처음 값이 데이터로 자동으로 채운 초안인가(되돌리기 버튼을 보여 준다)
  autoFilled?: boolean
}) {
  // 처음 값은 열 때 한 번만 정한다(뒤에서 숫자를 다시 받아 와도 쓰던 내용·"바뀐 게 있나" 기준이 흔들리지 않게).
  const [initial] = useState(initialProp)
  const [wentWell, setWentWell] = useState(initial.wentWell)
  const [toImprove, setToImprove] = useState(initial.toImprove)
  const [actionItems, setActionItems] = useState<RetroActionItem[]>(initial.actionItems)
  const [actionDraft, setActionDraft] = useState('')
  const [error, setError] = useState<SubmitResult>(null)
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const [restore, setRestore] = useState(() => loadStoredDraft(draftKey, initial))
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [serverSavedAt, setServerSavedAt] = useState<number | null>(null)
  const [storageFailed, setStorageFailed] = useState(false)
  const now = useNow()
  const savingRef = useRef(false)
  const firstRef = useRef<HTMLTextAreaElement>(null)
  // 언마운트할 때 마지막 입력을 놓치지 않게 최신 값을 들고 있는다.
  const latestRef = useRef<DraftValues>(toDraftValues(initial))
  latestRef.current = { wentWell, toImprove, actionItems, actionDraft }
  const restoreRef = useRef(restore)
  restoreRef.current = restore
  const skipFlushRef = useRef(false)

  // 실제로 바뀐 것이 있을 때만 "쓰던 내용이 사라져요"를 묻는다.
  const dirty =
    wentWell.trim() !== initial.wentWell.trim() ||
    toImprove.trim() !== initial.toImprove.trim() ||
    actionDraft.trim() !== '' ||
    JSON.stringify(actionItems) !== JSON.stringify(initial.actionItems)
  useBeforeUnload(dirty)

  // 쓰는 대로 임시 저장(0.7초 쉬면). 이어 쓸지 묻는 중에는 저장해 둔 것을 덮어쓰지 않는다.
  useEffect(() => {
    if (!draftKey || restore) return
    const t = window.setTimeout(() => {
      try {
        const values = latestRef.current
        if (sameDraftValues(values, toDraftValues(initial))) {
          window.localStorage.removeItem(draftKey)
          setDraftSavedAt(null)
          return
        }
        const at = Date.now()
        window.localStorage.setItem(draftKey, serializeDraft(values, at))
        setDraftSavedAt(at)
        setStorageFailed(false)
      } catch {
        setStorageFailed(true)
      }
    }, 700)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wentWell, toImprove, actionItems, actionDraft, restore, draftKey])

  // 화면을 떠나는 순간 아직 저장 안 된 마지막 입력도 저장한다(저장 성공 뒤에는 하지 않는다).
  useEffect(() => {
    return () => {
      if (!draftKey || skipFlushRef.current || restoreRef.current) return
      try {
        const values = latestRef.current
        if (sameDraftValues(values, toDraftValues(initial))) return
        window.localStorage.setItem(draftKey, serializeDraft(values, Date.now()))
      } catch {
        // 저장소를 못 써도 화면은 정상 동작
      }
    }
  }, [draftKey])

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

  // 이 편집기의 글을 다른 곳(이미 있는 회고)으로 옮길 때: 임시 저장본을 지우고, 화면이 바뀔 때 다시 저장하지 않게 한다.
  const discardDraft = () => {
    skipFlushRef.current = true
    clearStoredDraft(draftKey)
    setDraftSavedAt(null)
  }

  const acceptRestore = () => {
    if (!restore) return
    setWentWell(restore.values.wentWell)
    setToImprove(restore.values.toImprove)
    setActionItems(restore.values.actionItems)
    setActionDraft(restore.values.actionDraft || '')
    setRestore(null)
  }
  const discardRestore = () => {
    clearStoredDraft(draftKey)
    setRestore(null)
  }
  const revertToInitial = () => {
    setWentWell(initial.wentWell)
    setToImprove(initial.toImprove)
    setActionItems(initial.actionItems)
    setActionDraft('')
    setError(null)
  }

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
    // 이어 쓸지 묻는 중이면 먼저 고르게 한다(저장해 둔 내용을 실수로 버리지 않게).
    if (restore) {
      setError({ message: '쓰다 만 내용이 있어요. “이어서 쓰기” 또는 “버리기”를 먼저 골라 주세요.' })
      return
    }
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
    // 저장 요청 중에 화면이 바뀌어도(폼이 카드로 바뀜) 임시 저장본을 다시 쓰지 않는다. 실패하면 다시 켠다.
    skipFlushRef.current = true
    let saved = false
    try {
      const result = await onSubmit({ wentWell: wentWell.trim(), toImprove: toImprove.trim(), actionItems: finalActions })
      if (result) {
        setError(result)
        return
      }
      saved = true
      // 서버에 저장됐으니 임시 저장본은 지운다.
      clearStoredDraft(draftKey)
      setDraftSavedAt(null)
      setServerSavedAt(Date.now())
      if (resetOnSuccess) {
        setWentWell('')
        setToImprove('')
        setActionDraft('')
        setActionItems([])
        firstRef.current?.focus()
      }
    } finally {
      if (!saved) skipFlushRef.current = false
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

  const statusText = (() => {
    if (saving) return ''
    if (error && draftSavedAt) return '저장하지 못했지만, 쓴 내용은 이 브라우저에 임시 저장돼 있어요.'
    if (serverSavedAt && !dirty) return `저장됨 · ${agoText(serverSavedAt, now)}`
    if (storageFailed) return '이 브라우저에서는 임시 저장을 할 수 없어요. 쓴 뒤 바로 저장해 주세요.'
    if (draftSavedAt) return `임시 저장됨 · ${agoText(draftSavedAt, now)}`
    if (draftKey && dirty) return '쓰는 대로 이 브라우저에 임시 저장돼요.'
    return ''
  })()
  const savedTone = serverSavedAt && !dirty && !error ? 'saved' : ''

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
      {restore ? (
        <div className="v5p-restore" role="status">
          <span>
            쓰다 만 내용이 있어요{restore.savedAt ? ` (${agoText(restore.savedAt, now)} 임시 저장)` : ''}. 이어서 쓸까요?
          </span>
          <span className="v5p-restore-actions">
            <button className="button xs" type="button" onClick={acceptRestore}>
              이어서 쓰기
            </button>
            <button className="button xs secondary" type="button" onClick={discardRestore}>
              버리기
            </button>
          </span>
        </div>
      ) : null}
      <div className="v5p-form-cols">
        <FormField label="잘된 점" hint="이번 주 반응이 좋았던 것" htmlFor={`${idPrefix}-well`}>
          <textarea
            id={`${idPrefix}-well`}
            ref={firstRef}
            className="textarea"
            rows={autoFilled ? 6 : 3}
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
            rows={autoFilled ? 6 : 3}
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
      {autoFilled && dirty ? (
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="button xs ghost" onClick={revertToInitial}>
            자동 초안으로 되돌리기
          </button>
        </div>
      ) : null}
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
          {error.extra ? <span className="v5p-inline-action">{error.extra(discardDraft)}</span> : null}
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
            <button
              className="button danger"
              type="button"
              onClick={() => {
                // 일부러 닫는 것이니 임시 저장본도 지운다.
                skipFlushRef.current = true
                clearStoredDraft(draftKey)
                onCancel()
              }}
            >
              닫기
            </button>
          </>
        ) : null}
        <span className={`v5p-draftnote ${savedTone}`} role="status" aria-live="polite">
          {statusText}
        </span>
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
  onEditRequestHandled,
  editable,
  savedAt,
  onToggle,
  onSave,
  onDelete
}: {
  retro: WeeklyRetro
  weekBadge?: string
  highlight?: boolean
  editOnMount?: EditorValues | null
  editRequest: boolean
  // 이어 쓰기 요청을 편집기로 넘겼다(다음에 이 카드를 다시 열 때 또 열리지 않게 부모가 요청을 지운다)
  onEditRequestHandled: () => void
  editable: boolean
  // 이 세션에서 서버에 저장된 시각(있으면 "저장됨" 표시)
  savedAt?: number
  onToggle: (idx: number) => void
  onSave: (values: EditorValues) => Promise<SubmitResult>
  onDelete: () => Promise<string | null>
}) {
  const [editing, setEditing] = useState<EditorValues | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const now = useNow()
  const done = retro.action_items.filter((a) => a.done).length
  const kpi = kpiLine(retro)

  // "기존 회고에 이어서 쓰기"로 들어온 경우 바로 수정 모드로 연다.
  useEffect(() => {
    if (editRequest) {
      setEditing(mergeValues(retro, editOnMount || null))
      onEditRequestHandled()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])

  const startEdit = () => setEditing(mergeValues(retro, null))

  return (
    <article className={`v5p-retro-card ${highlight ? 'current' : ''}`} id={`retro-${retro.id}`}>
      <header className="v5p-retro-head">
        <h3>
          {isoWeekRangeText(retro.week_label)}
          {weekBadge ? <span className="v5p-week-badge">{weekBadge}</span> : null}
          {savedAt ? (
            <span className="v5p-saved" role="status">
              ✓ 저장됨 · {agoText(savedAt, now)}
            </span>
          ) : null}
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
          draftKey={retroDraftKey(retro.week_label)}
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

const EMPTY_VALUES: EditorValues = { wentWell: '', toImprove: '', actionItems: [] }

function RetrosView() {
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

  const { filters, setFilters, ready: filtersReady, shareUrl } = useUrlFilters(RETRO_SPEC, FILTER_KEY)
  // 화면을 켜 둔 채 자정(한국 시간)이 지나 "이번 주"가 바뀔 수 있으니, 날짜가 바뀌면 서버가 알려 주는 이번 주·지난주를 다시 받는다.
  const today = useKstToday()
  const lastTodayRef = useRef(today)
  useEffect(() => {
    if (lastTodayRef.current === today) return
    lastTodayRef.current = today
    reload()
  }, [today, reload])
  // 보고 있는 주(빈 값 = 이번 주). 이번 주보다 미래거나 형식이 틀리면 이번 주.
  const sw = useMemo(() => (thisWeek ? weekSwitch(filters.week || thisWeek, thisWeek) : null), [filters.week, thisWeek])
  const selectedWeek = sw?.current || ''

  // 이미 있는 회고에 이어 쓰기 요청(동시 저장 충돌 시)
  const [continueReq, setContinueReq] = useState<{ id: string; draft: EditorValues } | null>(null)
  const clearContinueReq = () => setContinueReq(null)
  // 이 화면에서 서버에 저장된 시각(회고 id → 시각). "저장됨" 표시용
  const [savedAtMap, setSavedAtMap] = useState<Record<string, number>>({})
  const markSaved = (id: string) => setSavedAtMap((m) => ({ ...m, [id]: Date.now() }))

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

  const thisRetro = useMemo(() => items.find((r) => r.week_label === thisWeek) || null, [items, thisWeek])
  const selectedRetro = useMemo(() => items.find((r) => r.week_label === selectedWeek) || null, [items, selectedWeek])
  // 이번 주 회고를 쓰기 전에 보여 주는 "지난 회고"(이번 주 것 빼고 가장 최근)
  const lastRetro = useMemo(() => items.find((r) => r.week_label !== thisWeek) || null, [items, thisWeek])
  // 보고 있는 주 바로 앞의 회고에서 못 끝낸 할 일
  const prevRetro = useMemo(() => items.reduce<WeeklyRetro | null>((best, r) => (r.week_label < selectedWeek && (!best || r.week_label > best.week_label) ? r : best), null), [items, selectedWeek])
  const carryOver = useMemo(() => (prevRetro ? prevRetro.action_items.map((a, idx) => ({ ...a, idx })).filter((a) => !a.done) : []), [prevRetro])
  const otherRetros = useMemo(() => items.filter((r) => r.week_label !== selectedWeek), [items, selectedWeek])

  const writable = Boolean(selectedWeek) && (selectedWeek === thisWeek || selectedWeek === lastWeek)
  const wantForm = !sample && !selectedRetro && writable && filtersReady
  const word = selectedWeek ? weekWord(selectedWeek, thisWeek) : ''
  const prevWord = selectedWeek === thisWeek ? '지난주' : '그 전 주'

  // 자동 초안 재료(그 주 영상 수·조회수·가장 잘 나간 영상). 실패해도 빈 폼으로 쓸 수 있다.
  const draftQ = useV5Query<{ draft: RetroDraftData }>(wantForm ? `/api/v5/retros/draft?week=${encodeURIComponent(selectedWeek)}` : null, { errorFallback: '이번 주 숫자를 모으지 못했어요.' })
  const draftData = draftQ.data?.draft && draftQ.data.draft.week === selectedWeek ? draftQ.data.draft : null
  const draftPending = wantForm && !draftData && !draftQ.error
  const built = useMemo(() => (draftData ? buildRetroDraft(draftData, word, prevWord) : null), [draftData, word, prevWord])
  const prefill: EditorValues = built && (built.wentWell || built.toImprove) ? { wentWell: built.wentWell, toImprove: built.toImprove, actionItems: [] } : EMPTY_VALUES
  const autoFilled = prefill !== EMPTY_VALUES

  const goWeek = (label: string | null) => {
    if (!label) return
    setFilters({ week: label === thisWeek ? '' : label })
  }

  // 새 회고 저장
  const onCreate = async (values: EditorValues, week: string): Promise<SubmitResult> => {
    const res = await v5Post<{ item: WeeklyRetro; code?: string; existingId?: string }>('/api/v5/retros', {
      weekLabel: week,
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
          extra: (discard) => (
            <button
              type="button"
              className="button xs secondary"
              onClick={() => {
                // 쓰던 내용은 그 회고 안으로 합쳐지므로 임시 저장본은 지운다(화면이 바뀔 때 다시 저장되지도 않게).
                discard()
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
    markSaved(saved.id)
    showSuccess(`${weekWord(saved.week_label, thisWeek)} 회고를 저장했어요.`)
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
    markSaved(retroId)
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
        markSaved(retroId)
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

  // 파일 저장 도구는 버튼을 눌렀을 때 처음 불러온다.
  const exportCsv = async () => {
    if (items.length === 0) return
    try {
      const [{ csvFileName, retrosCsv }, { downloadCsv }] = await Promise.all([import('@/lib/v5/csv'), import('@/lib/v5/share')])
      const ok = downloadCsv(csvFileName('주간회고', todayYmd()), retrosCsv(items))
      if (ok) showSuccess(`회고 ${fmtNum(items.length)}개를 엑셀 파일로 저장했어요.`)
      else showErrorRef.current('파일을 저장하지 못했어요. 브라우저 설정을 확인해 주세요.')
    } catch {
      showErrorRef.current('파일을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')
    }
  }

  const thisWeekRange = thisWeek ? isoWeekRangeText(thisWeek) : ''
  const thisDone = thisRetro ? thisRetro.action_items.filter((a) => a.done).length : 0
  const ready = Boolean(q.data) && filtersReady && Boolean(sw)
  const weekBadgeOf = (label: string) => (label === thisWeek ? '이번 주' : label === lastWeek ? '지난주' : undefined)

  return (
    <>
      <PageHeader title="주간 회고" subtitle="한 주를 돌아보며 잘된 점, 고칠 점, 다음 주 할 일을 남겨요." />

      <SampleNote show={sample} />

      {q.error ? <LoadError message={q.error} status={q.status} onRetry={reload} /> : null}
      {!ready && !q.error ? <RetroSkeleton /> : null}

      {ready && sw ? (
        <div className={q.validating ? 'v5p-refreshing' : undefined} aria-busy={q.validating}>
          <AnswerBanner
            label={`이번 주 (${thisWeekRange})`}
            tone={thisRetro ? 'good' : 'neutral'}
            aside={
              !thisRetro && lastRetro ? (
                <span className="small muted">
                  지난 회고 ({isoWeekRangeText(lastRetro.week_label)}){lastRetro.went_well ? ` · 잘된 점: ${lastRetro.went_well.slice(0, 50)}${lastRetro.went_well.length > 50 ? '…' : ''}` : ''}
                </span>
              ) : null
            }
          >
            {thisRetro ? (
              <>
                이번 주 회고를 <strong>이미 썼어요</strong>
                {thisRetro.action_items.length > 0 ? ` · 다음 주 할 일 ${fmtNum(thisDone)}/${fmtNum(thisRetro.action_items.length)} 완료` : ''}
              </>
            ) : items.length === 0 ? (
              <>아직 쓴 회고가 없어요. 이번 주 것부터 한 줄만 적어 볼까요?</>
            ) : (
              <>
                이번 주 회고를 <strong>아직 안 썼어요</strong>
                {lastRetro && lastRetro.action_items.some((a) => !a.done) ? ` · 지난 회고에서 못 끝낸 할 일 ${fmtNum(lastRetro.action_items.filter((a) => !a.done).length)}개` : ''}
              </>
            )}
          </AnswerBanner>

          {/* 주 넘기기: 지난주로 돌아가거나 다음 주로 넘겨 봐요(이번 주보다 앞으로는 못 가요) */}
          <nav className="v5p-weeknav" aria-label="주 넘기기">
            <button type="button" className="button xs secondary" disabled={!sw.prev} onClick={() => goWeek(sw.prev)} aria-label={sw.prev ? `지난주로 (${isoWeekRangeText(sw.prev)})` : '더 이전 주는 없어요'}>
              ← 지난주
            </button>
            <div className="v5p-weeknav-now" aria-live="polite">
              <strong>{isoWeekRangeText(selectedWeek)}</strong>
              {weekBadgeOf(selectedWeek) ? <span className="v5p-week-badge">{weekBadgeOf(selectedWeek)}</span> : null}
              <span className={`v5p-weeknav-state ${selectedRetro ? 'done' : ''}`}>{selectedRetro ? '회고 있음' : '회고 없음'}</span>
            </div>
            <button
              type="button"
              className="button xs secondary"
              disabled={!sw.next}
              onClick={() => goWeek(sw.next)}
              aria-label={sw.next ? `다음주로 (${isoWeekRangeText(sw.next)})` : '이번 주보다 앞으로는 넘길 수 없어요'}
              title={sw.next ? undefined : '이번 주가 마지막이에요'}
            >
              다음주 →
            </button>
            {!sw.isThisWeek ? (
              <button type="button" className="button xs ghost" onClick={() => goWeek(thisWeek)}>
                이번 주로
              </button>
            ) : null}
            <span className="v5p-toolbar-right">
              <CopyLinkButton getUrl={shareUrl} />
            </span>
          </nav>

          {!selectedRetro && writable && carryOver.length > 0 && prevRetro && !sample ? (
            <section className="v5p-carry" aria-label="지난 회고에서 못 끝낸 할 일">
              <div className="v5p-section-head">
                <h2>지난 회고에서 못 끝낸 할 일</h2>
                <span className="small muted">끝냈다면 체크해 두세요</span>
              </div>
              <ul className="v5p-todo">
                {carryOver.map((a) => (
                  <li key={a.idx}>
                    <label>
                      <input type="checkbox" checked={false} onChange={() => onToggle(prevRetro.id, a.idx)} />
                      <span>{a.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {selectedRetro ? (
            <section aria-label={`${word} 회고`} className="v5p-selected">
              <RetroCard
                key={selectedRetro.id}
                retro={selectedRetro}
                weekBadge={weekBadgeOf(selectedRetro.week_label)}
                highlight
                editable={!sample}
                savedAt={savedAtMap[selectedRetro.id]}
                editRequest={continueReq?.id === selectedRetro.id}
                onEditRequestHandled={clearContinueReq}
                editOnMount={continueReq?.id === selectedRetro.id ? continueReq.draft : null}
                onToggle={(idx) => onToggle(selectedRetro.id, idx)}
                onSave={(values) => onSave(selectedRetro.id, values)}
                onDelete={() => onDelete(selectedRetro.id)}
              />
            </section>
          ) : sample ? null : writable ? (
            <section className="v5p-retro-form" aria-label={`${word} 회고 쓰기`}>
              <div className="v5p-section-head">
                <h2>{word} 회고 쓰기</h2>
                <span className="small muted">한 줄이면 충분해요 · 그 주의 조회수·영상 수는 저장할 때 자동으로 함께 남아요</span>
              </div>
              {draftPending ? (
                <div className="v5p-facts loading" role="status" aria-busy="true">
                  {word} 숫자를 모으는 중이에요…
                </div>
              ) : (
                <>
                  {draftData ? (
                    <div className="v5p-facts" aria-label={`${word} 숫자`}>
                      <div className="v5p-facts-title">{word} 숫자 (자동으로 모았어요)</div>
                      <ul>
                        {(built?.facts || []).map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                      {draftData.current.unsynced > 0 ? (
                        <div className="small muted">
                          조회수를 아직 받아 오지 못한 영상이 {fmtNum(draftData.current.unsynced)}개 있어요. <Link href="/v5/scoreboard">점수판</Link>에서 “유튜브에서 조회수 받기”를 누르면 더 정확해져요.
                        </div>
                      ) : null}
                      {draftData.truncated ? <div className="small muted">영상이 너무 많아 일부만 세었어요.</div> : null}
                      {autoFilled ? <div className="small muted">아래 칸에 이 숫자로 초안을 채워 뒀어요. 마음대로 고쳐 쓰세요.</div> : null}
                    </div>
                  ) : draftQ.error ? (
                    <div className="v5p-note" role="note">
                      이번 주 숫자를 불러오지 못해서 빈 칸으로 열었어요. 직접 적어도 저장할 때 숫자는 자동으로 남아요.
                    </div>
                  ) : null}
                  <RetroEditor
                    key={`${selectedWeek}:${draftData ? 'd' : 'n'}`}
                    idPrefix="v5p-new"
                    initial={prefill}
                    autoFilled={autoFilled}
                    draftKey={retroDraftKey(selectedWeek)}
                    submitLabel={`${word} 회고 저장`}
                    resetOnSuccess
                    onSubmit={(v) => onCreate(v, selectedWeek)}
                  />
                </>
              )}
            </section>
          ) : (
            <EmptyBlock
              title="이 주에는 쓴 회고가 없어요"
              action={
                <button type="button" className="button" onClick={() => goWeek(thisWeek)}>
                  이번 주로 가기
                </button>
              }
            >
              새 회고는 이번 주와 지난주 것만 쓸 수 있어요. 오래된 주는 이미 쓴 회고만 볼 수 있어요.
            </EmptyBlock>
          )}

          <section style={{ marginTop: 24 }} aria-label="다른 주 회고">
            <div className="v5p-section-head">
              <h2>{selectedRetro ? '다른 주 회고' : '지난 회고'}</h2>
              <span className="v5p-toolbar-right">
                <ExportCsvButton onExport={() => void exportCsv()} disabled={items.length === 0} />
              </span>
            </div>
            {otherRetros.length === 0 ? (
              <EmptyBlock title="아직 지난 회고가 없어요">
                회고를 저장하면 그 주에 등록한 영상 수·조회수와 함께 여기에 주마다 쌓여요. 그래서 나중에 “지난달보다 나아졌나?”를 바로 비교할 수 있어요. 영상을 아직 등록하지 않았다면 <Link href="/v5/register">영상 등록</Link>부터 해 주세요.
              </EmptyBlock>
            ) : (
              <div className="v5p-retro-grid">
                {otherRetros.map((retro) => (
                  <RetroCard
                    key={retro.id}
                    retro={retro}
                    weekBadge={weekBadgeOf(retro.week_label)}
                    highlight={retro.week_label === thisWeek}
                    editable={!sample}
                    savedAt={savedAtMap[retro.id]}
                    editRequest={continueReq?.id === retro.id}
                    onEditRequestHandled={clearContinueReq}
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

export default function RetrosPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 로 감싸야 한다(Next 16).
  return (
    <Suspense fallback={<RetroSkeleton />}>
      <RetrosView />
    </Suspense>
  )
}
