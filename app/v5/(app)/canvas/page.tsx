'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Badge, Segment } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { authedDeleteJson, authedPatchJson, errorText, v5Post } from '@/lib/v5/client'
import { daysRunningFrom, formatDate, formatDayShort, formatSignedPercent, todayYmd } from '@/lib/v5/format'
import { AnswerBanner, EmptyBlock, ErrorText, FormField, LoadError, RelTime, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import { BoardSkeleton } from '@/lib/v5/skeleton'
import { useV5Query } from '@/lib/v5/swr'
import { ConfirmDelete, FormDrawer, useEscape, usePref, useSingleFlight } from '@/lib/v5/ui'
import { VideoPicker, type PickedVideo } from '@/lib/v5/video-picker'
import {
  EXPERIMENT_DIMENSIONS,
  EXPERIMENT_DIMENSION_LABEL,
  EXPERIMENT_STATUS_LABEL,
  EXPERIMENT_STATUS_ORDER,
  type ExperimentDimension,
  type ExperimentStatus,
  type GrowthExperiment
} from '@/lib/v5/types'

const STATUS_TONE: Record<ExperimentStatus, 'indigo' | 'green' | 'red' | 'amber'> = {
  running: 'indigo',
  won: 'green',
  lost: 'red',
  paused: 'amber'
}

const COLUMN_HINT: Record<ExperimentStatus, string> = {
  running: '지금 테스트 중',
  won: '효과가 있었어요',
  lost: '효과가 없었어요',
  paused: '잠시 멈춘 실험'
}

const COLUMN_EMPTY: Record<ExperimentStatus, string> = {
  running: '진행 중인 실험이 없어요',
  won: '아직 없어요',
  lost: '아직 없어요',
  paused: '아직 없어요'
}

const MOVE_LABEL: Record<ExperimentStatus, string> = {
  running: '다시 진행',
  won: '성공으로 기록',
  lost: '실패로 기록',
  paused: '보류'
}

const DIMENSION_HINT = '여러 개 골라도 돼요. 예: 썸네일 + 제목'
// 이 일수를 넘게 진행 중이면 "결과 확인할 때예요"로 알려 준다.
const OVERDUE_DAYS = 14
const MAX_TARGETS = 30

// 진행 일수(D+N): 시작일 당일이 D+0.
const daysRunning = (startedOn: string) => daysRunningFrom(startedOn, todayYmd())
const isOverdue = (exp: GrowthExperiment) => exp.status === 'running' && daysRunning(exp.started_on) > OVERDUE_DAYS

const videoName = (v: { title: string | null; stock_name: string }) => v.title || v.stock_name

function targetSummary(exp: GrowthExperiment) {
  const list = exp.videos || []
  if (list.length === 0) return exp.missing_videos ? '대상 영상이 지워졌어요' : '대상 영상 없음'
  const first = videoName(list[0])
  return list.length > 1 ? `${first} 외 ${list.length - 1}개` : first
}

function makeEmptyForm() {
  return {
    dimensions: [] as ExperimentDimension[],
    videos: [] as PickedVideo[],
    hypothesis: '',
    metricDefinition: '',
    startedOn: todayYmd(),
    endedOn: '',
    nextAction: ''
  }
}

type FormState = ReturnType<typeof makeEmptyForm>
type FormErrors = Partial<Record<'dimensions' | 'videos' | 'hypothesis' | 'startedOn' | 'endedOn', string>>

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (form.dimensions.length === 0) errors.dimensions = '무엇을 바꿔 볼지 1개 이상 골라 주세요.'
  if (!form.hypothesis.trim()) errors.hypothesis = '가설을 한 줄로 적어 주세요.'
  if (form.videos.length === 0) errors.videos = '실험할 영상을 1개 이상 골라 주세요.'
  if (!form.startedOn) errors.startedOn = '시작일을 골라 주세요.'
  if (form.endedOn && form.startedOn && form.endedOn < form.startedOn) errors.endedOn = '종료일은 시작일보다 빠를 수 없어요.'
  return errors
}

// "32", "+32", "-8", "12.5%" 를 숫자로. 빈 칸이면 null, 숫자가 아니면 undefined.
function parseEffect(text: string): number | null | undefined {
  const t = text.trim().replace(/[%\s,]/g, '')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < -1000 || n > 1000) return undefined
  return Math.round(n * 100) / 100
}

const effectText = (n: number | null) => (n === null ? '' : String(n))
const effectLabel = (n: number | null) => (n === null ? '' : formatSignedPercent(n))

type CardMode = 'view' | 'edit' | 'record'

function ExperimentCard({
  exp,
  canEdit,
  busy,
  onPatch,
  onDelete
}: {
  exp: GrowthExperiment
  canEdit: boolean
  busy: boolean
  // 실패하면 사람이 읽을 오류 문장, 성공하면 null
  onPatch: (body: Record<string, unknown>) => Promise<string | null>
  onDelete: () => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CardMode>('view')
  const [recordStatus, setRecordStatus] = useState<'won' | 'lost'>('won')
  const [hypoDraft, setHypoDraft] = useState(exp.hypothesis)
  const [metricDraft, setMetricDraft] = useState(exp.metric_definition)
  const [nextDraft, setNextDraft] = useState(exp.next_action || '')
  const [effectDraft, setEffectDraft] = useState(effectText(exp.effect_size))
  const [fieldError, setFieldError] = useState<{ hypo?: string; effect?: string }>({})
  const [error, setError] = useState('')

  useEscape(mode !== 'view', () => setMode('view'))

  const overdue = isOverdue(exp)
  const tone = exp.status === 'won' ? 'good' : exp.status === 'lost' ? 'bad' : 'neutral'

  const startEdit = () => {
    setHypoDraft(exp.hypothesis)
    setMetricDraft(exp.metric_definition)
    setNextDraft(exp.next_action || '')
    setEffectDraft(effectText(exp.effect_size))
    setFieldError({})
    setError('')
    setMode('edit')
  }

  const startRecord = (status: 'won' | 'lost') => {
    setRecordStatus(status)
    setNextDraft(exp.next_action || '')
    setEffectDraft(effectText(exp.effect_size))
    setFieldError({})
    setError('')
    setOpen(true)
    setMode('record')
  }

  const saveEdit = async () => {
    const hypo = hypoDraft.trim()
    if (!hypo) {
      setFieldError({ hypo: '가설을 비워 둘 수 없어요.' })
      return
    }
    const body: Record<string, unknown> = {}
    if (hypo !== exp.hypothesis) body.hypothesis = hypo
    if (metricDraft.trim() !== exp.metric_definition) body.metricDefinition = metricDraft.trim()
    if (nextDraft.trim() !== (exp.next_action || '')) body.nextAction = nextDraft.trim()
    if (exp.status !== 'running') {
      const parsed = parseEffect(effectDraft)
      if (parsed === undefined) {
        setFieldError({ effect: '숫자만 적어 주세요. 예: 32 또는 -8' })
        return
      }
      if (parsed !== exp.effect_size) body.effectSize = parsed
    }
    setFieldError({})
    if (Object.keys(body).length === 0) {
      setMode('view')
      return
    }
    const message = await onPatch(body)
    if (message) setError(message)
    else {
      setError('')
      setMode('view')
    }
  }

  const saveRecord = async () => {
    const parsed = parseEffect(effectDraft)
    if (parsed === undefined) {
      setFieldError({ effect: '숫자만 적어 주세요. 예: 32 또는 -8' })
      return
    }
    setFieldError({})
    const body: Record<string, unknown> = { status: recordStatus }
    if (parsed !== null || exp.effect_size !== null) body.effectSize = parsed
    if (nextDraft.trim() !== (exp.next_action || '')) body.nextAction = nextDraft.trim()
    const message = await onPatch(body)
    if (message) setError(message)
    // 성공하면 카드가 다른 칸으로 옮겨가므로 여기서 할 일이 없다.
  }

  const changeStatus = async (status: ExperimentStatus) => {
    const message = await onPatch({ status })
    setError(message || '')
  }

  const remove = async () => {
    const message = await onDelete()
    if (message) setError(message)
  }

  return (
    <div className={`v5p-card ${tone} ${open ? 'open' : ''} ${overdue ? 'due' : ''}`}>
      <button type="button" className="v5p-card-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {exp.status === 'running' ? (
          <span className="v5p-card-flags">
            <span className="v5p-dday" title={`시작일 ${formatDate(exp.started_on)} 부터 ${fmtNum(daysRunning(exp.started_on))}일째`}>D+{fmtNum(daysRunning(exp.started_on))}</span>
            {overdue ? <span className="v5p-due">결과 확인할 때예요</span> : null}
          </span>
        ) : null}
        <span className="v5p-card-hypo">{exp.hypothesis}</span>
        <span className="v5p-card-line">
          <span className="v5p-card-key">대상 영상</span>
          <span className="v5p-card-val" title={targetSummary(exp)}>{targetSummary(exp)}</span>
        </span>
        {exp.status === 'won' || exp.status === 'lost' ? (
          <span className="v5p-card-line">
            <span className="v5p-card-key">결과</span>
            <span className={`v5p-card-val ${exp.effect_size === null ? 'faint' : ''}`}>{exp.effect_size === null ? '숫자를 아직 안 적었어요' : effectLabel(exp.effect_size)}</span>
          </span>
        ) : null}
        <span className="v5p-card-line">
          <span className="v5p-card-key">다음 할 일</span>
          <span className={`v5p-card-val ${exp.next_action ? '' : 'faint'}`} title={exp.next_action || undefined}>{exp.next_action || (exp.status === 'running' && canEdit ? '아직 없어요 · 눌러서 적기' : '없음')}</span>
        </span>
        <span className="v5p-card-more" aria-hidden>
          {open ? '접기 ▲' : '자세히 ▼'}
        </span>
      </button>

      {/* 진행 중인 카드는 펼치지 않고도 바로 결과를 남길 수 있게 */}
      {exp.status === 'running' && canEdit && mode !== 'record' ? (
        <div className={`v5p-quick ${overdue ? 'due' : ''}`}>
          <span className="small muted">{overdue ? '충분히 지났어요. 결과는?' : '결과가 나왔나요?'}</span>
          <button type="button" className="button xs secondary" disabled={busy} onClick={() => startRecord('won')}>
            성공
          </button>
          <button type="button" className="button xs secondary" disabled={busy} onClick={() => startRecord('lost')}>
            실패
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="v5p-card-body">
          {mode === 'record' ? (
            <form
              className="v5p-record"
              onSubmit={(e) => {
                e.preventDefault()
                if (!busy) void saveRecord()
              }}
            >
              <div className="v5p-record-title">{recordStatus === 'won' ? '성공으로 기록' : '실패로 기록'}</div>
              <FormField
                label="얼마나 달라졌나요? (%)"
                optional
                hint={recordStatus === 'won' ? '좋아졌으면 + 숫자로 적어요. 예: 32 (모르면 비워도 돼요)' : '나빠졌으면 - 숫자로 적어요. 예: -8 (모르면 비워도 돼요)'}
                error={fieldError.effect}
                htmlFor={`v5p-rec-effect-${exp.id}`}
              >
                <input
                  id={`v5p-rec-effect-${exp.id}`}
                  className="input"
                  inputMode="decimal"
                  autoFocus
                  value={effectDraft}
                  onChange={(e) => setEffectDraft(e.target.value)}
                  placeholder={recordStatus === 'won' ? '예: 32' : '예: -8'}
                />
              </FormField>
              <FormField label="다음 할 일" optional htmlFor={`v5p-rec-next-${exp.id}`}>
                <input
                  id={`v5p-rec-next-${exp.id}`}
                  className="input"
                  maxLength={200}
                  value={nextDraft}
                  onChange={(e) => setNextDraft(e.target.value)}
                  placeholder={recordStatus === 'won' ? '예: 다른 종목 영상에도 같은 썸네일 써 보기' : '예: 제목 대신 첫 3초를 바꿔 다시 해 보기'}
                />
              </FormField>
              {error ? (
                <div className="v5p-field-error" role="alert">
                  <ErrorText message={error} />
                </div>
              ) : null}
              <div className="row" style={{ gap: 8 }}>
                <button className="button sm" type="submit" disabled={busy}>
                  {busy ? '저장 중…' : recordStatus === 'won' ? '성공으로 기록' : '실패로 기록'}
                </button>
                <button className="button sm secondary" type="button" disabled={busy} onClick={() => setMode('view')}>
                  취소
                </button>
              </div>
            </form>
          ) : (
            <>
              <dl className="v5p-kv">
                <dt>바꿔 본 것</dt>
                <dd>
                  {exp.dimensions.map((d) => (
                    <span className="v5-tag" key={d} style={{ marginRight: 4 }}>
                      {EXPERIMENT_DIMENSION_LABEL[d]}
                    </span>
                  ))}
                </dd>
                <dt>판단 기준</dt>
                <dd>{exp.metric_definition}</dd>
                <dt>기간</dt>
                <dd className="v5p-num" title={`${formatDate(exp.started_on)} ~ ${exp.ended_on ? formatDate(exp.ended_on) : '진행 중'}`}>
                  {formatDayShort(exp.started_on)} ~ {exp.ended_on ? formatDayShort(exp.ended_on) : '진행 중'}
                </dd>
                {exp.videos && exp.videos.length > 1 ? (
                  <>
                    <dt>전체 대상</dt>
                    <dd title={exp.videos.map(videoName).join(', ')}>{exp.videos.map(videoName).join(', ')}</dd>
                  </>
                ) : null}
                {exp.missing_videos ? (
                  <>
                    <dt>참고</dt>
                    <dd className="muted">지워진 영상 {fmtNum(exp.missing_videos)}개는 목록에서 빠졌어요.</dd>
                  </>
                ) : null}
                <dt>만든 사람</dt>
                <dd>
                  {exp.author_name || '알 수 없음'} · <RelTime value={exp.created_at} absolute /> 에 만듦
                </dd>
              </dl>

              {mode === 'edit' ? (
                <form
                  className="v5p-card-edit"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!busy) void saveEdit()
                  }}
                >
                  <FormField label="가설" error={fieldError.hypo} htmlFor={`v5p-e-hypo-${exp.id}`}>
                    <input id={`v5p-e-hypo-${exp.id}`} className="input" autoFocus maxLength={500} value={hypoDraft} onChange={(e) => setHypoDraft(e.target.value)} />
                  </FormField>
                  <FormField label="판단 기준" optional htmlFor={`v5p-e-metric-${exp.id}`}>
                    <input id={`v5p-e-metric-${exp.id}`} className="input" maxLength={200} value={metricDraft} onChange={(e) => setMetricDraft(e.target.value)} />
                  </FormField>
                  {exp.status !== 'running' ? (
                    <FormField label="결과 (%)" optional hint="좋아졌으면 +, 나빠졌으면 - 로 적어요. 예: 32" error={fieldError.effect} htmlFor={`v5p-e-effect-${exp.id}`}>
                      <input id={`v5p-e-effect-${exp.id}`} className="input" inputMode="decimal" value={effectDraft} onChange={(e) => setEffectDraft(e.target.value)} placeholder="예: 32" />
                    </FormField>
                  ) : null}
                  <FormField label="다음 할 일" optional htmlFor={`v5p-e-next-${exp.id}`}>
                    <input id={`v5p-e-next-${exp.id}`} className="input" maxLength={200} value={nextDraft} onChange={(e) => setNextDraft(e.target.value)} placeholder="예: 3일 뒤 클릭률 다시 확인하기" />
                  </FormField>
                  {error ? (
                    <div className="v5p-field-error" role="alert">
                      <ErrorText message={error} />
                    </div>
                  ) : null}
                  <div className="row" style={{ gap: 8 }}>
                    <button className="button sm" type="submit" disabled={busy}>
                      {busy ? '저장 중…' : '저장'}
                    </button>
                    <button className="button sm secondary" type="button" disabled={busy} onClick={() => setMode('view')}>
                      취소
                    </button>
                  </div>
                </form>
              ) : null}

              {canEdit && mode === 'view' ? (
                <div className="v5p-card-actions">
                  <button type="button" className="button xs secondary" disabled={busy} onClick={startEdit}>
                    내용 고치기
                  </button>
                  {EXPERIMENT_STATUS_ORDER.filter((s) => s !== exp.status).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="button xs secondary"
                      disabled={busy}
                      onClick={() => (s === 'won' || s === 'lost' ? startRecord(s) : void changeStatus(s))}
                    >
                      {MOVE_LABEL[s]}
                    </button>
                  ))}
                  <span className="v5p-spacer" />
                  <ConfirmDelete busy={busy} onConfirm={remove} />
                </div>
              ) : null}
              {mode === 'view' && error ? (
                <div className="v5p-field-error" role="alert">
                  <ErrorText message={error} />
                </div>
              ) : null}
              {!canEdit ? <div className="small muted">다른 사람이 만든 실험이라 볼 수만 있어요.</div> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function CanvasPage() {
  const me = useV5Me()
  const { toast, showSuccess } = useToast()
  const q = useV5Query<{ sample?: boolean; items: GrowthExperiment[]; truncated?: boolean }>('/api/v5/growth-experiments', { errorFallback: '실험 목록을 불러오지 못했어요.' })
  const { update: updateData, reload } = q
  const items = useMemo(() => q.data?.items || [], [q.data])
  const sample = Boolean(q.data?.sample)
  const [view, setView, viewReady] = usePref<'kanban' | 'list'>('v5.canvas.view', 'kanban', (v): v is 'kanban' | 'list' => v === 'kanban' || v === 'list')
  const [authorFilter, setAuthorFilter, authorReady] = usePref<string>('v5.canvas.author', '', (v): v is string => typeof v === 'string')
  const [mobileStatus, setMobileStatus] = useState<ExperimentStatus | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<FormState>(makeEmptyForm)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const once = useSingleFlight()

  // 저장 결과를 화면과 캐시에 함께 반영한다(다른 화면을 다녀와도 옛 값으로 돌아가지 않게).
  const setItems = useCallback((fn: (prev: GrowthExperiment[]) => GrowthExperiment[]) => updateData((d) => ({ ...d, items: fn(d.items || []) })), [updateData])

  const authors = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) if (it.created_by) map.set(it.created_by, it.author_name || '이름 없음')
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [items])
  const activeAuthor = authors.some((a) => a.id === authorFilter) ? authorFilter : ''
  const visibleItems = useMemo(() => (activeAuthor ? items.filter((it) => it.created_by === activeAuthor) : items), [items, activeAuthor])

  const grouped = useMemo(() => {
    const map = new Map<ExperimentStatus, GrowthExperiment[]>()
    for (const status of EXPERIMENT_STATUS_ORDER) map.set(status, [])
    for (const item of visibleItems) map.get(item.status)?.push(item)
    // 진행 중은 오래된 것부터: 결과 확인이 급한 실험이 위로 온다.
    map.get('running')?.sort((a, b) => a.started_on.localeCompare(b.started_on))
    return map
  }, [visibleItems])

  const focus = useMemo(() => {
    const running = grouped.get('running') || []
    return { count: running.length, oldest: running[0] || null, overdue: running.filter(isOverdue) }
  }, [grouped])

  // 좁은 화면에서 보여 줄 칸: 직접 고른 칸, 없으면 진행 중 → 처음으로 카드가 있는 칸.
  const activeStatus: ExperimentStatus =
    mobileStatus ?? ((grouped.get('running') || []).length > 0 ? 'running' : EXPERIMENT_STATUS_ORDER.find((s) => (grouped.get(s) || []).length > 0) || 'running')

  const errors = useMemo(() => validate(form), [form])
  const showErr = <K extends keyof FormErrors>(key: K) => (submitted ? errors[key] : undefined)
  const formDirty = form.dimensions.length > 0 || form.videos.length > 0 || form.hypothesis.trim() !== '' || form.nextAction.trim() !== '' || form.metricDefinition.trim() !== '' || form.endedOn !== ''

  const canEditItem = (exp: GrowthExperiment) => !sample && (exp.can_edit ?? Boolean(me?.isAdmin || (me && exp.created_by === me.crmUserId)))

  const openDrawer = () => {
    setForm(makeEmptyForm())
    setSubmitted(false)
    setFormError('')
    setMoreOpen(false)
    setDrawerOpen(true)
  }

  const toggleDimension = (dim: ExperimentDimension) => {
    setForm((f) => ({ ...f, dimensions: f.dimensions.includes(dim) ? f.dimensions.filter((d) => d !== dim) : [...f.dimensions, dim] }))
  }

  const onCreate = () =>
    once(async () => {
      setSubmitted(true)
      setFormError('')
      const errs = validate(form)
      if (Object.keys(errs).length > 0) {
        if (errs.endedOn) setMoreOpen(true)
        return
      }

      setSaving(true)
      try {
        const res = await v5Post<{ item: GrowthExperiment }>('/api/v5/growth-experiments', {
          dimensions: form.dimensions,
          videoIds: form.videos.map((v) => v.id),
          hypothesis: form.hypothesis.trim(),
          metricDefinition: form.metricDefinition.trim() || undefined,
          startedOn: form.startedOn,
          endedOn: form.endedOn || undefined,
          nextAction: form.nextAction.trim() || undefined
        })
        if (!res.ok) {
          setFormError(errorText(res, '실험을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.'))
          return
        }
        setDrawerOpen(false)
        showSuccess('새 실험을 “진행중” 칸에 추가했어요.')
        setMobileStatus('running')
        setItems((prev) => [res.data.item, ...prev])
      } finally {
        setSaving(false)
      }
    }, 'create')

  // 카드 하나당 한 번에 하나만(더블클릭/연타로 같은 저장이 두 번 나가지 않게). 이미 처리 중이면 조용히 무시한다.
  const onPatch = async (id: string, body: Record<string, unknown>): Promise<string | null> => {
    const result = await once(async () => {
      setBusyId(id)
      try {
        const res = await authedPatchJson<{ item: GrowthExperiment }>(`/api/v5/growth-experiments/${id}`, body)
        if (!res.ok) {
          if (res.status === 404) setItems((prev) => prev.filter((it) => it.id !== id)) // 이미 지워진 카드
          return errorText(res, '저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
        }
        const updated = res.data.item
        setItems((prev) => prev.map((it) => (it.id === id ? updated : it)))
        if (typeof body.status === 'string' && body.status !== 'running') {
          showSuccess(`실험을 “${EXPERIMENT_STATUS_LABEL[body.status as ExperimentStatus]}” 칸으로 옮겼어요.`)
        }
        return null
      } finally {
        setBusyId(null)
      }
    }, id)
    return result ?? null
  }

  const onDelete = async (id: string): Promise<string | null> => {
    const result = await once(async () => {
      setBusyId(id)
      try {
        const res = await authedDeleteJson(`/api/v5/growth-experiments/${id}`)
        if (!res.ok) return errorText(res, '지우지 못했어요. 잠시 뒤 다시 해 주세요.')
        setItems((prev) => prev.filter((it) => it.id !== id))
        return null
      } finally {
        setBusyId(null)
      }
    }, id)
    return result ?? null
  }

  const ready = Boolean(q.data) && viewReady && authorReady
  const showSkeleton = !ready && !q.error

  return (
    <>
      <PageHeader
        title="성장 실험"
        subtitle="조회수를 늘리려고 무엇을 바꿔 보는지, 결과가 어땠는지 한눈에 관리해요."
        actions={
          <button className="button" onClick={openDrawer}>
            + 새 실험
          </button>
        }
      />

      <SampleNote show={sample} />

      {q.error ? <LoadError message={q.error} status={q.status} onRetry={reload} /> : null}
      {showSkeleton ? <BoardSkeleton /> : null}

      {ready ? (
        <div className={q.validating ? 'v5p-refreshing' : undefined} aria-busy={q.validating}>
          <AnswerBanner
            label="오늘의 한 줄"
            tone={focus.overdue.length > 0 ? 'bad' : 'neutral'}
            aside={
              focus.oldest ? (
                <span className="small muted" title={focus.oldest.hypothesis}>
                  가장 오래된 실험 · D+{fmtNum(daysRunning(focus.oldest.started_on))} · “{focus.oldest.hypothesis.slice(0, 40)}
                  {focus.oldest.hypothesis.length > 40 ? '…' : ''}”
                </span>
              ) : null
            }
          >
            {items.length === 0 ? (
              <>아직 실험이 없어요. 첫 실험을 시작해 보세요.</>
            ) : focus.count === 0 ? (
              <>진행 중인 실험이 없어요 · 새 실험을 하나 시작해 볼까요?</>
            ) : focus.overdue.length > 0 ? (
              <>
                결과를 확인할 실험 <strong>{fmtNum(focus.overdue.length)}개</strong>
                <span className="v5p-answer-sub">{OVERDUE_DAYS}일 넘게 진행 중이에요. 카드에서 “성공 / 실패”로 결과를 남겨 주세요. (진행 중 {fmtNum(focus.count)}개)</span>
              </>
            ) : (
              <>
                지금 진행 중인 실험 <strong>{fmtNum(focus.count)}개</strong> · 다음에 확인할 것:{' '}
                <strong>{focus.oldest?.next_action || '아직 정해지지 않았어요 (카드를 눌러 적어 두세요)'}</strong>
              </>
            )}
          </AnswerBanner>

          {items.length === 0 ? (
            <EmptyBlock
              title="실험이란, 하나만 바꿔 보고 결과를 비교하는 거예요"
              action={
                <button className="button" onClick={openDrawer}>
                  첫 실험 만들기
                </button>
              }
            >
              <ol className="v5p-steps">
                <li>무엇을 바꿀지 고르기 (썸네일, 제목 등)</li>
                <li>“이렇게 하면 더 나을 것 같다”는 가설 한 줄 적기</li>
                <li>실험할 영상 고르기 → 며칠 뒤 성공 / 실패 표시</li>
              </ol>
            </EmptyBlock>
          ) : (
            <>
              <div className="v5p-toolbar">
                <span className="small muted">카드를 누르면 자세한 내용을 보고 고칠 수 있어요.</span>
                <span className="v5p-toolbar-right">
                  {authors.length > 1 ? (
                    <select className="select v5p-owner-select" value={activeAuthor} onChange={(e) => setAuthorFilter(e.target.value)} aria-label="만든 사람별로 보기">
                      <option value="">모든 사람</option>
                      {authors.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <Segment
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'kanban', label: '보드' },
                      { value: 'list', label: '목록' }
                    ]}
                  />
                </span>
              </div>

              {view === 'kanban' ? (
                <>
                  {/* 좁은 화면에서는 네 칸을 가로로 늘어놓는 대신, 상태 탭으로 한 칸씩 본다 */}
                  <div className="v5p-tabs" role="group" aria-label="상태별로 보기">
                    {EXPERIMENT_STATUS_ORDER.map((status) => (
                      <button key={status} type="button" className="v5p-tab" aria-pressed={activeStatus === status} onClick={() => setMobileStatus(status)}>
                        {EXPERIMENT_STATUS_LABEL[status]}
                        <span>{fmtNum((grouped.get(status) || []).length)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="v5p-board">
                    {EXPERIMENT_STATUS_ORDER.map((status) => {
                      const list = grouped.get(status) || []
                      return (
                        <div className={`v5p-col ${activeStatus === status ? 'is-active' : ''}`} key={status}>
                          <div className="v5p-col-head">
                            <div className="v5p-col-title">
                              {EXPERIMENT_STATUS_LABEL[status]}
                              <span>{fmtNum(list.length)}</span>
                            </div>
                            <div className="v5p-col-hint">{COLUMN_HINT[status]}</div>
                          </div>
                          {list.length === 0 ? <div className="v5p-col-empty">{COLUMN_EMPTY[status]}</div> : null}
                          {list.map((exp) => (
                            <ExperimentCard
                              key={exp.id}
                              exp={exp}
                              canEdit={canEditItem(exp)}
                              busy={busyId === exp.id}
                              onPatch={(body) => onPatch(exp.id, body)}
                              onDelete={() => onDelete(exp.id)}
                            />
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="v5-table-wrap v5p-cardwrap panel" style={{ padding: 0 }}>
                  <table className="v5-table v5p-cardtable">
                    <thead>
                      <tr>
                        <th>가설</th>
                        <th>바꿔 본 것</th>
                        <th>대상 영상</th>
                        <th>기간</th>
                        <th>상태</th>
                        <th className="num">결과</th>
                        <th>다음 할 일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((exp) => (
                        <tr key={exp.id}>
                          <td className="v5p-td-clip" data-label="가설" title={exp.hypothesis}>
                            {exp.hypothesis}
                          </td>
                          <td data-label="바꿔 본 것">{exp.dimensions.map((d) => EXPERIMENT_DIMENSION_LABEL[d]).join(', ')}</td>
                          <td className="small muted v5p-td-clip" data-label="대상 영상" title={targetSummary(exp)}>
                            {targetSummary(exp)}
                          </td>
                          <td className="small v5p-num" data-label="기간" title={`${formatDate(exp.started_on)} ~ ${exp.ended_on ? formatDate(exp.ended_on) : '진행 중'}`}>
                            {formatDayShort(exp.started_on)} ~ {exp.ended_on ? formatDayShort(exp.ended_on) : '진행 중'}
                          </td>
                          <td data-label="상태">
                            <span>
                              <Badge tone={STATUS_TONE[exp.status]}>{EXPERIMENT_STATUS_LABEL[exp.status]}</Badge>
                              {exp.status === 'running' ? <span className="v5p-dday inline">D+{fmtNum(daysRunning(exp.started_on))}</span> : null}
                              {isOverdue(exp) ? <span className="v5p-due inline">결과 확인할 때예요</span> : null}
                            </span>
                          </td>
                          <td className="num" data-label="결과">
                            {exp.effect_size !== null ? effectLabel(exp.effect_size) : '-'}
                          </td>
                          <td className="small muted v5p-td-clip" data-label="다음 할 일" title={exp.next_action || undefined}>
                            {exp.next_action || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="v5p-list-note small muted">고치거나 지우려면 “보드”에서 카드를 눌러 주세요.</div>
                </div>
              )}
              {q.data?.truncated ? (
                <div className="v5p-note" style={{ marginTop: 12 }} role="note">
                  실험이 너무 많아 최근 것만 보여요.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {drawerOpen ? (
        <FormDrawer
          title="새 실험 만들기"
          formId="v5p-exp-form"
          dirty={formDirty}
          saving={saving}
          submitLabel="실험 시작하기"
          onSubmit={onCreate}
          onClose={() => setDrawerOpen(false)}
        >
          {formError ? (
            <div className="v5p-error" role="alert" style={{ marginTop: 0 }}>
              <ErrorText message={formError} />
            </div>
          ) : null}

          <FormField label="1. 무엇을 바꿔 보나요?" required hint={DIMENSION_HINT} error={showErr('dimensions')}>
            <div className="v5p-chips">
              {EXPERIMENT_DIMENSIONS.map((dim, i) => (
                <button
                  key={dim}
                  type="button"
                  data-autofocus={i === 0 ? '' : undefined}
                  aria-pressed={form.dimensions.includes(dim)}
                  className={`v5p-chip ${form.dimensions.includes(dim) ? 'on' : ''}`}
                  onClick={() => toggleDimension(dim)}
                >
                  {EXPERIMENT_DIMENSION_LABEL[dim]}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="2. 가설" required hint="“이렇게 바꾸면 이렇게 될 것이다”를 한 줄로 적어요." error={showErr('hypothesis')} htmlFor="v5p-hypo">
            <input
              id="v5p-hypo"
              className="input"
              maxLength={500}
              value={form.hypothesis}
              onChange={(e) => setForm((f) => ({ ...f, hypothesis: e.target.value }))}
              placeholder="예: 썸네일에 큰 숫자를 넣으면 클릭이 더 늘 것이다"
            />
          </FormField>

          <FormField label="3. 대상 영상" required hint={`실험할 영상을 골라요. ${fmtNum(form.videos.length)}개 선택됨`} error={showErr('videos')} htmlFor="v5p-exp-video-search">
            <VideoPicker
              selected={form.videos}
              onChange={(videos) => setForm((f) => ({ ...f, videos }))}
              max={MAX_TARGETS}
              searchId="v5p-exp-video-search"
              emptyHint={
                <>
                  아직 등록된 영상이 없어요. <Link href="/v5/register">영상 등록</Link>에서 먼저 영상을 넣어 주세요.
                </>
              }
            />
          </FormField>

          <FormField label="4. 시작일" required error={showErr('startedOn')} htmlFor="v5p-start">
            <input id="v5p-start" className="input" type="date" value={form.startedOn} onChange={(e) => setForm((f) => ({ ...f, startedOn: e.target.value }))} />
          </FormField>

          <details className="v5p-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>자세히 적기 (선택)</summary>
            <div className="v5p-more-body">
              <FormField label="다음 할 일" optional hint="예: 3일 뒤 클릭률 다시 확인하기" htmlFor="v5p-next">
                <input id="v5p-next" className="input" maxLength={200} value={form.nextAction} onChange={(e) => setForm((f) => ({ ...f, nextAction: e.target.value }))} placeholder="예: 3일 뒤 클릭률 다시 확인하기" />
              </FormField>
              <FormField label="무엇으로 성공을 판단하나요?" optional hint="비워 두면 “조회수 변화”로 기록돼요." htmlFor="v5p-metric">
                <input id="v5p-metric" className="input" maxLength={200} value={form.metricDefinition} onChange={(e) => setForm((f) => ({ ...f, metricDefinition: e.target.value }))} placeholder="예: 올린 뒤 48시간 동안의 클릭률" />
              </FormField>
              <FormField label="종료일" optional error={showErr('endedOn')} htmlFor="v5p-end">
                <input id="v5p-end" className="input" type="date" value={form.endedOn} onChange={(e) => setForm((f) => ({ ...f, endedOn: e.target.value }))} />
              </FormField>
            </div>
          </details>
        </FormDrawer>
      ) : null}

      <Toast toast={toast} />
    </>
  )
}
