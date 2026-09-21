'use client'

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Badge, Segment, StatusTabs, tabPanelProps } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { authedDeleteJson, authedPatchJson, errorText, v5Get, v5Post } from '@/lib/v5/client'
import { compareRunning, elapsedDays, experimentTiming, nextRequiredAction } from '@/lib/v5/experiment-status'
import { CANVAS_SPEC, type CanvasStatusFilter } from '@/lib/v5/filters'
import { formatDate, formatDayShort, formatSignedPercent, todayYmd } from '@/lib/v5/format'
import { ActiveFilters, CopyLinkButton, GlossaryTip, UndoBar, useUndoSlot, type FilterChip } from '@/lib/v5/insight-parts'
import { AnswerBanner, EmptyBlock, ErrorText, FormField, LoadError, RelTime, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import { BoardSkeleton } from '@/lib/v5/skeleton'
import { experimentPrefill, playbookLink } from '@/lib/v5/suggest'
import { useV5Query } from '@/lib/v5/swr'
import { ConfirmDelete, FormDrawer, useEscape, useKstToday, usePref, useSingleFlight } from '@/lib/v5/ui'
import { useUrlFilters } from '@/lib/v5/use-filters'
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
  paused: '보관해 둔 실험'
}

const COLUMN_EMPTY: Record<ExperimentStatus, string> = {
  running: '진행 중인 실험이 없어요',
  won: '아직 없어요',
  lost: '아직 없어요',
  paused: '아직 없어요'
}

const FILTER_KEY = 'v5.canvas.filters.v1'
const DIMENSION_HINT = '여러 개 골라도 돼요. 예: 썸네일 + 제목'
const MAX_TARGETS = 30
// 한 칸에 처음 그리는 카드 수(그 이상은 "더 보기"). 성공·실패 카드가 몇 달 쌓여도 화면이 느려지지 않게 한다.
const COLUMN_PAGE = 20
// 주소로 들어오는 "새 실험 만들기" 미리 채우기 값(한 번 쓰고 주소에서 지운다)
const ONE_SHOT_PARAMS = ['new', 'video', 'focus']

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

// memo: 카드가 수십 개여도 "바뀐 카드만" 다시 그린다(핸들러는 부모에서 고정된 함수를 넘긴다).
const ExperimentCard = memo(function ExperimentCard({
  exp,
  today,
  canEdit,
  busy,
  onPatch,
  onDelete
}: {
  exp: GrowthExperiment
  today: string
  canEdit: boolean
  busy: boolean
  // 실패하면 사람이 읽을 오류 문장, 성공하면 null
  onPatch: (exp: GrowthExperiment, body: Record<string, unknown>) => Promise<string | null>
  onDelete: (id: string) => Promise<string | null>
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

  const timing = experimentTiming(exp, today)
  const action = nextRequiredAction(exp, today)
  const due = exp.status === 'running' && timing.needsResult
  const dday = elapsedDays(exp, today)
  const tone = exp.status === 'won' ? 'good' : exp.status === 'lost' ? 'bad' : 'neutral'
  const firstVideoId = exp.videos?.[0]?.id

  const startEdit = () => {
    setHypoDraft(exp.hypothesis)
    setMetricDraft(exp.metric_definition)
    setNextDraft(exp.next_action || '')
    setEffectDraft(effectText(exp.effect_size))
    setFieldError({})
    setError('')
    setMode('edit')
  }

  const startRecord = (status: 'won' | 'lost' = 'won') => {
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
    const message = await onPatch(exp, body)
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
    const message = await onPatch(exp, body)
    if (message) setError(message)
    // 성공하면 카드가 다른 칸으로 옮겨가므로 여기서 할 일이 없다.
  }

  const changeStatus = async (status: ExperimentStatus) => {
    const message = await onPatch(exp, { status })
    setError(message || '')
  }

  const remove = async () => {
    const message = await onDelete(exp.id)
    if (message) setError(message)
  }

  return (
    <div className={`v5p-card ${tone} ${open ? 'open' : ''} ${due ? 'due' : ''}`}>
      <button type="button" className="v5p-card-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="v5p-card-flags">
          <span className="v5p-dday" title={`시작일 ${formatDate(exp.started_on)} 부터 ${fmtNum(dday)}일째`}>
            D+{fmtNum(dday)}
          </span>
          {due ? <span className="v5p-due">결과 기록 필요</span> : null}
        </span>
        <span className="v5p-card-hypo">{exp.hypothesis}</span>
        <span className="v5p-card-line">
          <span className="v5p-card-key">지금 필요한 것</span>
          <span className={`v5p-card-val v5p-need ${action.tone}`}>{action.text}</span>
        </span>
        <span className="v5p-card-line">
          <span className="v5p-card-key">대상 영상</span>
          <span className="v5p-card-val" title={targetSummary(exp)}>
            {targetSummary(exp)}
          </span>
        </span>
        {exp.status === 'won' || exp.status === 'lost' ? (
          <span className="v5p-card-line">
            <span className="v5p-card-key">결과</span>
            <span className={`v5p-card-val ${exp.effect_size === null ? 'faint' : ''}`}>{exp.effect_size === null ? '숫자를 아직 안 적었어요' : effectLabel(exp.effect_size)}</span>
          </span>
        ) : null}
        {exp.next_action || (exp.status === 'running' && canEdit) ? (
          <span className="v5p-card-line">
            <span className="v5p-card-key">다음 할 일</span>
            <span className={`v5p-card-val ${exp.next_action ? '' : 'faint'}`} title={exp.next_action || undefined}>
              {exp.next_action || '아직 없어요 · 눌러서 적기'}
            </span>
          </span>
        ) : null}
        <span className="v5p-card-more" aria-hidden>
          {open ? '접기 ▲' : '자세히 ▼'}
        </span>
      </button>

      {/* 카드를 열지 않고도 바로 옮길 수 있는 버튼 */}
      {canEdit && mode !== 'record' ? (
        <div className={`v5p-quick ${due ? 'due' : ''}`}>
          {exp.status === 'running' ? (
            <>
              <span className="small muted">{due ? '기간이 지났어요. 결과는?' : '결과가 나왔나요?'}</span>
              <button type="button" className={`button xs ${due ? '' : 'secondary'}`} disabled={busy} onClick={() => startRecord('won')}>
                결과 기록
              </button>
              <button type="button" className="button xs ghost" disabled={busy} onClick={() => void changeStatus('paused')} title="“보류” 칸으로 옮겨 두고 나중에 다시 볼 수 있어요">
                보관
              </button>
            </>
          ) : exp.status === 'paused' ? (
            <>
              <button type="button" className="button xs secondary" disabled={busy} onClick={() => void changeStatus('running')}>
                시작
              </button>
              <span className="small muted">다시 시작하면 “진행중”으로 옮겨요</span>
            </>
          ) : (
            <>
              <button type="button" className="button xs secondary" disabled={busy} onClick={() => void changeStatus('running')}>
                다시 시작
              </button>
              <button type="button" className="button xs ghost" disabled={busy} onClick={() => void changeStatus('paused')} title="“보류” 칸으로 옮겨 두어요">
                보관
              </button>
              {exp.status === 'won' && firstVideoId ? (
                <Link className="button xs ghost" href={playbookLink(firstVideoId, `실험 성공: ${exp.hypothesis}`)} prefetch={false}>
                  성공 공식으로 저장
                </Link>
              ) : null}
            </>
          )}
        </div>
      ) : exp.status === 'won' && firstVideoId && mode !== 'record' ? (
        <div className="v5p-quick">
          <Link className="button xs ghost" href={playbookLink(firstVideoId, `실험 성공: ${exp.hypothesis}`)} prefetch={false}>
            성공 공식으로 저장
          </Link>
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
              <div className="v5p-record-title">결과 기록</div>
              <Segment
                value={recordStatus}
                onChange={setRecordStatus}
                options={[
                  { value: 'won', label: '성공했어요' },
                  { value: 'lost', label: '실패했어요' }
                ]}
              />
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
                  {exp.status === 'running' ? <span className="small muted"> · 계획 {fmtNum(timing.planned)}일{exp.ended_on ? '' : '(정해 둔 종료일이 없어 기본값)'}</span> : null}
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
                  {EXPERIMENT_STATUS_ORDER.filter((s) => s !== exp.status && (s === 'won' || s === 'lost')).map((s) => (
                    <button key={s} type="button" className="button xs secondary" disabled={busy} onClick={() => startRecord(s as 'won' | 'lost')}>
                      {s === 'won' ? '성공으로 기록' : '실패로 기록'}
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
})

function CanvasView() {
  const me = useV5Me()
  const { toast, showSuccess, showError } = useToast()
  // showError 는 렌더마다 바뀔 수 있으므로 effect/콜백 의존성에 넣지 않고 ref 로만 쓴다.
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError
  const q = useV5Query<{ sample?: boolean; items: GrowthExperiment[]; truncated?: boolean }>('/api/v5/growth-experiments', { errorFallback: '실험 목록을 불러오지 못했어요.' })
  const { update: updateData, reload } = q
  const items = useMemo(() => q.data?.items || [], [q.data])
  const sample = Boolean(q.data?.sample)
  const [view, setView, viewReady] = usePref<'kanban' | 'list'>('v5.canvas.view', 'kanban', (v): v is 'kanban' | 'list' => v === 'kanban' || v === 'list')
  const { filters, setFilters, reset, ready: filtersReady, params, stripParams, shareUrl } = useUrlFilters(CANVAS_SPEC, FILTER_KEY)
  const statusFilter = filters.status
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<FormState>(makeEmptyForm)
  const [initialForm, setInitialForm] = useState<FormState>(makeEmptyForm)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const once = useSingleFlight()
  const { slot: undoSlot, show: showUndo, dismiss: dismissUndo } = useUndoSlot()
  const handledNewRef = useRef(false)
  // 칸마다 지금까지 펼친 카드 수, 보류(보관) 칸을 펼쳤는지
  const [columnLimit, setColumnLimit] = useState<Partial<Record<ExperimentStatus, number>>>({})
  const [pausedOpen, setPausedOpen] = useState(false)
  const [listLimit, setListLimit] = useState(50)

  // 저장 결과를 화면과 캐시에 함께 반영한다(다른 화면을 다녀와도 옛 값으로 돌아가지 않게).
  const setItems = useCallback((fn: (prev: GrowthExperiment[]) => GrowthExperiment[]) => updateData((d) => ({ ...d, items: fn(d.items || []) })), [updateData])

  const authors = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) if (it.created_by) map.set(it.created_by, it.author_name || '이름 없음')
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [items])
  // 목록에 없는 사람(주소로 받은 값 등)은 걸러내지 않고 "전체"로 본다.
  const activeAuthor = authors.some((a) => a.id === filters.author) ? filters.author : ''
  const authorFiltered = useMemo(() => (activeAuthor ? items.filter((it) => it.created_by === activeAuthor) : items), [items, activeAuthor])

  // 자정(한국 시간)이 지나면 D+N 이 새 날짜로 바뀐다.
  const today = useKstToday()

  const grouped = useMemo(() => {
    const map = new Map<ExperimentStatus, GrowthExperiment[]>()
    for (const status of EXPERIMENT_STATUS_ORDER) map.set(status, [])
    for (const item of authorFiltered) map.get(item.status)?.push(item)
    // 진행 중: 결과 기록이 필요한 것 먼저, 그다음 오래된 것부터.
    map.get('running')?.sort((a, b) => compareRunning(a, b, today))
    return map
  }, [authorFiltered, today])

  // 걸러 보는 조건이 바뀌면 목록은 처음(50개)부터 다시 보여 준다.
  useEffect(() => {
    setListLimit(50)
    setColumnLimit({})
  }, [statusFilter, activeAuthor])

  const shownStatuses = statusFilter === 'all' ? EXPERIMENT_STATUS_ORDER : [statusFilter]
  const listItems = useMemo(() => (statusFilter === 'all' ? authorFiltered : authorFiltered.filter((it) => it.status === statusFilter)), [authorFiltered, statusFilter])

  const focus = useMemo(() => {
    const running = grouped.get('running') || []
    return { count: running.length, oldest: running[0] || null, due: running.filter((e) => experimentTiming(e, today).needsResult) }
  }, [grouped, today])

  const errors = useMemo(() => validate(form), [form])
  const showErr = <K extends keyof FormErrors>(key: K) => (submitted ? errors[key] : undefined)
  const formDirty = JSON.stringify(form) !== JSON.stringify(initialForm)

  const canEditItem = (exp: GrowthExperiment) => !sample && (exp.can_edit ?? Boolean(me?.isAdmin || (me && exp.created_by === me.crmUserId)))

  const openDrawer = (prefill?: Partial<FormState>) => {
    const next = { ...makeEmptyForm(), ...prefill }
    setForm(next)
    setInitialForm(next)
    setSubmitted(false)
    setFormError('')
    setMoreOpen(false)
    setDrawerOpen(true)
  }

  // 점수판 등에서 "이 영상으로 실험 만들기"로 들어온 경우: /v5/canvas?new=1&video=ID&focus=velocity
  useEffect(() => {
    if (!filtersReady) return
    if (params.get('new') !== '1') {
      handledNewRef.current = false
      return
    }
    if (handledNewRef.current) return
    handledNewRef.current = true
    const videoId = params.get('video')
    const prefill = experimentPrefill(params.get('focus'))
    openDrawer(prefill ? { dimensions: prefill.dimensions, hypothesis: prefill.hypothesis } : undefined)
    stripParams(ONE_SHOT_PARAMS)
    if (videoId) {
      void (async () => {
        const res = await v5Get<{ items: PickedVideo[] }>(`/api/v5/videos?id=${encodeURIComponent(videoId)}`)
        const found = res.ok ? res.data.items?.[0] : null
        if (!found) {
          showErrorRef.current('영상 정보를 불러오지 못했어요. 아래에서 영상을 직접 골라 주세요.')
          return
        }
        const picked: PickedVideo = { id: found.id, title: found.title, stock_name: found.stock_name }
        const withVideo = (f: FormState): FormState => (f.videos.length === 0 ? { ...f, videos: [picked] } : f)
        setForm(withVideo)
        setInitialForm(withVideo)
      })()
    }
  }, [filtersReady, params, stripParams])

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
        // 새 카드가 보이도록, 걸러 보던 상태가 진행중이 아니면 전체로 풀어 준다.
        if (statusFilter !== 'all' && statusFilter !== 'running') setFilters({ status: 'all' })
        setItems((prev) => [res.data.item, ...prev])
      } finally {
        setSaving(false)
      }
    }, 'create')

  // 상태를 옮긴 뒤 5초 동안 되돌릴 수 있게 한다. 되돌리기는 "이번 이동이 바꾼 값"만 옮기기 전 값으로 되돌린다
  // (그 사이에 고친 다른 내용은 건드리지 않는다). 상태와 종료일은 항상 함께 되돌린다.
  const undoMove = useCallback(
    async (prev: GrowthExperiment, changed: { effectSize: boolean; nextAction: boolean }) => {
      const body: Record<string, unknown> = { status: prev.status, endedOn: prev.ended_on }
      if (changed.effectSize) body.effectSize = prev.effect_size
      if (changed.nextAction) body.nextAction = prev.next_action || ''
      const res = await authedPatchJson<{ item: GrowthExperiment }>(`/api/v5/growth-experiments/${prev.id}`, body)
      if (!res.ok) {
        if (res.status === 404) setItems((list) => list.filter((it) => it.id !== prev.id)) // 그 사이 지워진 카드
        showErrorRef.current(errorText(res, '되돌리지 못했어요. 카드에서 직접 옮겨 주세요.'))
        return
      }
      const restored = res.data.item
      setItems((list) => list.map((it) => (it.id === prev.id ? restored : it)))
    },
    [setItems]
  )

  // 카드 하나당 한 번에 하나만(더블클릭/연타로 같은 저장이 두 번 나가지 않게). 이미 처리 중이면 조용히 무시한다.
  const onPatch = useCallback(
    async (exp: GrowthExperiment, body: Record<string, unknown>): Promise<string | null> => {
      const id = exp.id
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
          if (typeof body.status === 'string' && body.status !== exp.status) {
            const label = EXPERIMENT_STATUS_LABEL[body.status as ExperimentStatus]
            const changed = { effectSize: 'effectSize' in body, nextAction: 'nextAction' in body }
            showUndo(`실험을 “${label}” 칸으로 옮겼어요.`, () => undoMove(exp, changed))
          }
          return null
        } finally {
          setBusyId(null)
        }
      }, id)
      return result ?? null
    },
    [once, setItems, showUndo, undoMove]
  )

  const onDelete = useCallback(
    async (id: string): Promise<string | null> => {
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
    },
    [once, setItems]
  )

  const ready = Boolean(q.data) && viewReady && filtersReady
  const showSkeleton = !ready && !q.error

  const statusTabs = [
    { value: 'all' as CanvasStatusFilter, label: '전체', count: authorFiltered.length },
    ...EXPERIMENT_STATUS_ORDER.map((s) => ({ value: s as CanvasStatusFilter, label: EXPERIMENT_STATUS_LABEL[s], count: (grouped.get(s) || []).length }))
  ]

  const chips: FilterChip[] = []
  if (statusFilter !== 'all') chips.push({ key: 'status', label: `상태: ${EXPERIMENT_STATUS_LABEL[statusFilter]}`, onClear: () => setFilters({ status: 'all' }) })
  if (activeAuthor) chips.push({ key: 'author', label: `만든 사람: ${authors.find((a) => a.id === activeAuthor)?.name || ''}`, onClear: () => setFilters({ author: '' }) })
  const filteredEmpty = items.length > 0 && listItems.length === 0

  return (
    <>
      <PageHeader
        title="성장 실험"
        subtitle="조회수를 늘리려고 무엇을 바꿔 보는지, 결과가 어땠는지 한눈에 관리해요."
        actions={
          <button className="button" onClick={() => openDrawer()}>
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
            tone={focus.due.length > 0 ? 'bad' : 'neutral'}
            aside={
              focus.oldest ? (
                <span className="small muted" title={focus.oldest.hypothesis}>
                  가장 오래된 실험 · D+{fmtNum(elapsedDays(focus.oldest, today))} · “{focus.oldest.hypothesis.slice(0, 40)}
                  {focus.oldest.hypothesis.length > 40 ? '…' : ''}”
                </span>
              ) : null
            }
          >
            {items.length === 0 ? (
              <>아직 실험이 없어요. 첫 실험을 시작해 보세요.</>
            ) : focus.count === 0 ? (
              <>진행 중인 실험이 없어요 · 새 실험을 하나 시작해 볼까요?</>
            ) : focus.due.length > 0 ? (
              <>
                결과를 기록할 실험 <strong>{fmtNum(focus.due.length)}개</strong>
                <span className="v5p-answer-sub">예정한 기간이 지났어요. 카드의 “결과 기록”을 눌러 성공·실패를 남겨 주세요. (진행 중 {fmtNum(focus.count)}개)</span>
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
                <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
                  <button className="button" onClick={() => openDrawer()}>
                    첫 실험 만들기
                  </button>
                  <Link className="button secondary" href="/v5/register">
                    영상 등록하러 가기
                  </Link>
                </span>
              }
            >
              <ol className="v5p-steps">
                <li>무엇을 바꿀지 고르기 (썸네일, 제목 등)</li>
                <li>“이렇게 하면 더 나을 것 같다”는 가설 한 줄 적기</li>
                <li>실험할 영상 고르기 → 며칠 뒤 성공 / 실패 표시</li>
              </ol>
              <div className="small muted" style={{ marginTop: 8 }}>
                실험은 등록된 영상에 해요. 영상이 아직 없다면 먼저 등록해 주세요. 점수판에서 “손봐야 할 영상”을 골라 바로 시작할 수도 있어요. <GlossaryTip term="experiment" />
              </div>
            </EmptyBlock>
          ) : (
            <>
              <div className="v5p-toolbar">
                <StatusTabs<CanvasStatusFilter> idBase="v5p-canvas" label="상태별로 보기" value={statusFilter} tabs={statusTabs} onChange={(status) => setFilters({ status })} />
                <span className="v5p-toolbar-right">
                  {authors.length > 1 ? (
                    <select className="select v5p-owner-select" value={activeAuthor} onChange={(e) => setFilters({ author: e.target.value })} aria-label="만든 사람별로 보기">
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
                  <CopyLinkButton getUrl={shareUrl} />
                </span>
              </div>
              <ActiveFilters chips={chips} onReset={reset} />
              <div className="small muted v5p-toolbar-note">카드를 누르면 자세한 내용을 보고 고칠 수 있어요. 카드 아래 버튼으로 바로 옮길 수도 있어요.</div>

              {filteredEmpty ? (
                <div className="v5p-note v5p-filter-empty" role="status">
                  이 필터에 맞는 실험이 없어요.{' '}
                  <button type="button" className="button xs secondary" onClick={reset}>
                    필터 초기화
                  </button>
                </div>
              ) : null}

              <div {...tabPanelProps('v5p-canvas', statusFilter)}>
                {view === 'kanban' ? (
                  <div className={`v5p-board ${shownStatuses.length === 1 ? 'single' : ''}`}>
                    {shownStatuses.map((status) => {
                      const list = grouped.get(status) || []
                      // 보류(보관) 칸은 "전체"로 볼 때 접어 두고 개수만 보여 준다(오래 쌓여도 화면이 길어지지 않게).
                      const collapsed = status === 'paused' && statusFilter === 'all' && !pausedOpen && list.length > 0
                      const limit = columnLimit[status] ?? COLUMN_PAGE
                      const shown = collapsed ? [] : list.slice(0, limit)
                      return (
                        <div className={`v5p-col ${collapsed ? 'collapsed' : ''}`} key={status}>
                          <div className="v5p-col-head">
                            <div className="v5p-col-title">
                              {EXPERIMENT_STATUS_LABEL[status]}
                              <span>{fmtNum(list.length)}개</span>
                            </div>
                            <div className="v5p-col-hint">{COLUMN_HINT[status]}</div>
                          </div>
                          {list.length === 0 ? <div className="v5p-col-empty">{COLUMN_EMPTY[status]}</div> : null}
                          {collapsed ? (
                            <button type="button" className="button xs secondary v5p-col-more" onClick={() => setPausedOpen(true)}>
                              보류한 실험 {fmtNum(list.length)}개 펼치기
                            </button>
                          ) : null}
                          <div className="v5p-col-cards">
                            {shown.map((exp) => (
                              <ExperimentCard key={exp.id} exp={exp} today={today} canEdit={canEditItem(exp)} busy={busyId === exp.id} onPatch={onPatch} onDelete={onDelete} />
                            ))}
                          </div>
                          {!collapsed && list.length > limit ? (
                            <button type="button" className="button xs secondary v5p-col-more" onClick={() => setColumnLimit((m) => ({ ...m, [status]: limit + COLUMN_PAGE }))}>
                              더 보기 ({fmtNum(list.length - limit)}개 남음)
                            </button>
                          ) : null}
                          {status === 'paused' && statusFilter === 'all' && pausedOpen && list.length > 0 ? (
                            <button type="button" className="button xs ghost v5p-col-more" onClick={() => setPausedOpen(false)}>
                              접기
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
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
                        {listItems.slice(0, listLimit).map((exp) => {
                          const t = experimentTiming(exp, today)
                          return (
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
                                  <span className="v5p-dday inline">D+{fmtNum(elapsedDays(exp, today))}</span>
                                  {t.needsResult ? <span className="v5p-due inline">결과 기록 필요</span> : null}
                                </span>
                              </td>
                              <td className="num" data-label="결과">
                                {exp.effect_size !== null ? effectLabel(exp.effect_size) : '-'}
                              </td>
                              <td className="small muted v5p-td-clip" data-label="다음 할 일" title={exp.next_action || undefined}>
                                {exp.next_action || '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {listItems.length > listLimit ? (
                      <div className="v5p-list-note">
                        <button type="button" className="button xs secondary" onClick={() => setListLimit((n) => n + 50)}>
                          더 보기 ({fmtNum(listItems.length - listLimit)}개 남음)
                        </button>
                      </div>
                    ) : null}
                    <div className="v5p-list-note small muted">고치거나 옮기려면 “보드”에서 카드를 눌러 주세요.</div>
                  </div>
                )}
              </div>
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
              <FormField label="종료일" optional hint="정해 두면 그 날짜에 “결과 기록 필요”로 알려 줘요. 비워 두면 14일 뒤예요." error={showErr('endedOn')} htmlFor="v5p-end">
                <input id="v5p-end" className="input" type="date" value={form.endedOn} onChange={(e) => setForm((f) => ({ ...f, endedOn: e.target.value }))} />
              </FormField>
            </div>
          </details>
        </FormDrawer>
      ) : null}

      <UndoBar slot={undoSlot} onDismiss={dismissUndo} />
      <Toast toast={toast} />
    </>
  )
}

export default function CanvasPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 로 감싸야 한다(Next 16).
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <CanvasView />
    </Suspense>
  )
}
