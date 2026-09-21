'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/v5/app-shell'
import { Badge, Drawer, Segment } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { authedPatchJson } from '@/lib/v5/client'
import { daysSince, formatDate, todayYmd } from '@/lib/v5/format'
import { AnswerBanner, EmptyBlock, FormField, LoadError, LoadingLine, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import {
  EXPERIMENT_DIMENSIONS,
  EXPERIMENT_DIMENSION_LABEL,
  EXPERIMENT_STATUS_LABEL,
  EXPERIMENT_STATUS_ORDER,
  type ExperimentDimension,
  type ExperimentStatus,
  type GrowthExperiment
} from '@/lib/v5/types'

type VideoOption = { id: string; title: string | null; stock_name: string; content_type: string }

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
  won: '성공으로 표시',
  lost: '실패로 표시',
  paused: '보류'
}

const DIMENSION_HINT = '여러 개 골라도 돼요. 예: 썸네일 + 제목'

function makeEmptyForm() {
  return {
    dimensions: [] as ExperimentDimension[],
    videoIds: [] as string[],
    hypothesis: '',
    metricDefinition: '',
    startedOn: todayYmd(),
    endedOn: '',
    nextAction: ''
  }
}

type FormState = ReturnType<typeof makeEmptyForm>
type FormErrors = Partial<Record<'dimensions' | 'videoIds' | 'hypothesis' | 'startedOn' | 'endedOn', string>>

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (form.dimensions.length === 0) errors.dimensions = '무엇을 바꿔 볼지 1개 이상 골라 주세요.'
  if (!form.hypothesis.trim()) errors.hypothesis = '가설을 한 줄로 적어 주세요.'
  if (form.videoIds.length === 0) errors.videoIds = '실험할 영상을 1개 이상 골라 주세요.'
  if (!form.startedOn) errors.startedOn = '시작일을 골라 주세요.'
  if (form.endedOn && form.startedOn && form.endedOn < form.startedOn) errors.endedOn = '종료일은 시작일보다 빠를 수 없어요.'
  return errors
}

const videoName = (v: { title: string | null; stock_name: string }) => v.title || v.stock_name

function targetSummary(exp: GrowthExperiment) {
  const list = exp.videos || []
  if (list.length === 0) return '대상 영상 없음'
  const first = videoName(list[0])
  return list.length > 1 ? `${first} 외 ${list.length - 1}개` : first
}

function ExperimentCard({
  exp,
  busy,
  onPatch,
  onDelete
}: {
  exp: GrowthExperiment
  busy: boolean
  onPatch: (body: Record<string, unknown>) => Promise<boolean>
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [nextDraft, setNextDraft] = useState(exp.next_action || '')
  const [effectDraft, setEffectDraft] = useState(exp.effect_size === null ? '' : String(exp.effect_size))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [effectError, setEffectError] = useState('')

  const dirty = nextDraft.trim() !== (exp.next_action || '') || effectDraft.trim() !== (exp.effect_size === null ? '' : String(exp.effect_size))

  const save = async () => {
    const body: Record<string, unknown> = {}
    if (nextDraft.trim() !== (exp.next_action || '')) body.nextAction = nextDraft.trim()
    if (effectDraft.trim() !== (exp.effect_size === null ? '' : String(exp.effect_size))) {
      if (effectDraft.trim() === '') {
        body.effectSize = null
      } else {
        const n = Number(effectDraft)
        if (!Number.isFinite(n) || n < -1000 || n > 1000) {
          setEffectError('숫자만 적어 주세요. 예: 32 또는 -8')
          return
        }
        body.effectSize = n
      }
    }
    setEffectError('')
    await onPatch(body)
  }

  const tone = exp.status === 'won' ? 'good' : exp.status === 'lost' ? 'bad' : 'neutral'

  return (
    <div className={`v5p-card ${tone} ${open ? 'open' : ''}`}>
      <button type="button" className="v5p-card-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="v5p-card-hypo">{exp.hypothesis}</span>
        <span className="v5p-card-line">
          <span className="v5p-card-key">대상 영상</span>
          <span className="v5p-card-val">{targetSummary(exp)}</span>
        </span>
        <span className="v5p-card-line">
          <span className="v5p-card-key">다음 할 일</span>
          <span className={`v5p-card-val ${exp.next_action ? '' : 'faint'}`}>{exp.next_action || (exp.status === 'running' ? '아직 없어요 · 눌러서 적기' : '없음')}</span>
        </span>
        <span className="v5p-card-more" aria-hidden>
          {open ? '접기 ▲' : '자세히 ▼'}
        </span>
      </button>

      {open ? (
        <div className="v5p-card-body">
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
            <dd>
              {formatDate(exp.started_on)} ~ {exp.ended_on ? formatDate(exp.ended_on) : '진행 중'}
              {exp.status === 'running' ? ` (${fmtNum(daysSince(exp.started_on))}일째)` : ''}
            </dd>
            {exp.videos && exp.videos.length > 1 ? (
              <>
                <dt>전체 대상</dt>
                <dd>{exp.videos.map(videoName).join(', ')}</dd>
              </>
            ) : null}
            <dt>만든 사람</dt>
            <dd>{exp.author_name || '알 수 없음'}</dd>
          </dl>

          <div className="v5p-card-edit">
            <FormField label="다음 할 일" optional>
              <input className="input" value={nextDraft} maxLength={200} onChange={(e) => setNextDraft(e.target.value)} placeholder="예: 3일 뒤 클릭률 다시 확인하기" />
            </FormField>
            {exp.status !== 'running' ? (
              <FormField label="결과 (%)" optional hint="좋아졌으면 +, 나빠졌으면 - 로 적어요. 예: 32" error={effectError}>
                <input className="input" inputMode="decimal" value={effectDraft} onChange={(e) => setEffectDraft(e.target.value)} placeholder="예: 32" />
              </FormField>
            ) : null}
            <div className="row" style={{ gap: 8 }}>
              <button className="button sm" type="button" disabled={busy || !dirty} onClick={save}>
                {busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>

          <div className="v5p-card-actions">
            <span className="small muted">상태 바꾸기</span>
            {EXPERIMENT_STATUS_ORDER.filter((s) => s !== exp.status).map((s) => (
              <button key={s} type="button" className="button xs secondary" disabled={busy} onClick={() => void onPatch({ status: s })}>
                {MOVE_LABEL[s]}
              </button>
            ))}
            <span className="v5p-spacer" />
            {confirmDelete ? (
              <>
                <span className="small">정말 지울까요?</span>
                <button type="button" className="button xs danger" disabled={busy} onClick={onDelete}>
                  지우기
                </button>
                <button type="button" className="button xs secondary" onClick={() => setConfirmDelete(false)}>
                  아니요
                </button>
              </>
            ) : (
              <button type="button" className="button xs ghost v5p-danger-text" disabled={busy} onClick={() => setConfirmDelete(true)}>
                삭제
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function CanvasPage() {
  const { toast, showSuccess, showError } = useToast()
  const [items, setItems] = useState<GrowthExperiment[]>([])
  const [sample, setSample] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [videoOptions, setVideoOptions] = useState<VideoOption[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<FormState>(makeEmptyForm)
  const [submitted, setSubmitted] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [videoQuery, setVideoQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    const res = await authedFetchJson<{ sample: boolean; items: GrowthExperiment[]; error?: string }>('/api/v5/growth-experiments')
    if (res.ok) {
      setItems(res.data.items || [])
      setSample(Boolean(res.data.sample))
    } else {
      setLoadError(res.data?.error || '실험 목록을 불러오지 못했어요.')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const run = async () => {
      const res = await authedFetchJson<{ items: VideoOption[] }>('/api/v5/videos')
      if (res.ok) setVideoOptions(res.data.items || [])
    }
    void run()
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<ExperimentStatus, GrowthExperiment[]>()
    for (const status of EXPERIMENT_STATUS_ORDER) map.set(status, [])
    for (const item of items) map.get(item.status)?.push(item)
    return map
  }, [items])

  // "다음에 확인할 것": 가장 오래 진행 중인 실험을 기준으로 안내한다.
  const focus = useMemo(() => {
    const running = (grouped.get('running') || []).slice().sort((a, b) => a.started_on.localeCompare(b.started_on))
    return { count: running.length, oldest: running[0] || null }
  }, [grouped])

  const errors = useMemo(() => validate(form), [form])
  const showErr = <K extends keyof FormErrors>(key: K) => (submitted ? errors[key] : undefined)

  const filteredVideos = useMemo(() => {
    const q = videoQuery.trim().toLowerCase()
    const list = q ? videoOptions.filter((v) => `${v.title || ''} ${v.stock_name}`.toLowerCase().includes(q)) : videoOptions
    return list
  }, [videoOptions, videoQuery])

  const openDrawer = () => {
    setForm(makeEmptyForm())
    setSubmitted(false)
    setMoreOpen(false)
    setVideoQuery('')
    setDrawerOpen(true)
  }

  const toggleDimension = (dim: ExperimentDimension) => {
    setForm((f) => ({
      ...f,
      dimensions: f.dimensions.includes(dim) ? f.dimensions.filter((d) => d !== dim) : [...f.dimensions, dim]
    }))
  }

  const toggleVideo = (id: string) => {
    setForm((f) => ({ ...f, videoIds: f.videoIds.includes(id) ? f.videoIds.filter((v) => v !== id) : [...f.videoIds, id] }))
  }

  const onCreate = async () => {
    setSubmitted(true)
    const errs = validate(form)
    if (Object.keys(errs).length > 0) {
      if (errs.endedOn) setMoreOpen(true)
      return
    }

    setSaving(true)
    try {
      const res = await authedPostJson('/api/v5/growth-experiments', {
        dimensions: form.dimensions,
        videoIds: form.videoIds,
        hypothesis: form.hypothesis.trim(),
        metricDefinition: form.metricDefinition.trim() || undefined,
        startedOn: form.startedOn,
        endedOn: form.endedOn || undefined,
        nextAction: form.nextAction.trim() || undefined
      })
      if (!res.ok) {
        showError((res.data as any)?.error || '실험을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
        return
      }
      showSuccess('새 실험을 추가했어요.')
      setDrawerOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const onPatch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id)
    try {
      const res = await authedPatchJson(`/api/v5/growth-experiments/${id}`, body)
      if (!res.ok) {
        showError((res.data as any)?.error || '저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
        return false
      }
      setItems((prev) => prev.map((it) => (it.id === id ? (res.data as any).item : it)))
      showSuccess('저장했어요.')
      return true
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (id: string) => {
    setBusyId(id)
    try {
      const res = await authedFetchJson(`/api/v5/growth-experiments/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        showError((res.data as any)?.error || '삭제하지 못했어요.')
        return
      }
      setItems((prev) => prev.filter((it) => it.id !== id))
    } finally {
      setBusyId(null)
    }
  }

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

      {loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingLine />
      ) : (
        <>
          <AnswerBanner
            label="오늘의 한 줄"
            aside={
              focus.oldest ? (
                <span className="small muted">
                  가장 오래된 실험 · {fmtNum(daysSince(focus.oldest.started_on))}일째 · “{focus.oldest.hypothesis.slice(0, 40)}
                  {focus.oldest.hypothesis.length > 40 ? '…' : ''}”
                </span>
              ) : null
            }
          >
            {items.length === 0 ? (
              <>아직 실험이 없어요. 첫 실험을 시작해 보세요.</>
            ) : focus.count === 0 ? (
              <>진행 중인 실험이 없어요 · 새 실험을 하나 시작해 볼까요?</>
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
                <Segment
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'kanban', label: '보드' },
                    { value: 'list', label: '목록' }
                  ]}
                />
              </div>

              {view === 'kanban' ? (
                <div className="v5p-board">
                  {EXPERIMENT_STATUS_ORDER.map((status) => {
                    const list = grouped.get(status) || []
                    return (
                      <div className="v5p-col" key={status}>
                        <div className="v5p-col-head">
                          <div className="v5p-col-title">
                            {EXPERIMENT_STATUS_LABEL[status]}
                            <span>{fmtNum(list.length)}</span>
                          </div>
                          <div className="v5p-col-hint">{COLUMN_HINT[status]}</div>
                        </div>
                        {list.length === 0 ? <div className="v5p-col-empty">{COLUMN_EMPTY[status]}</div> : null}
                        {list.map((exp) => (
                          <ExperimentCard key={exp.id} exp={exp} busy={busyId === exp.id} onPatch={(body) => onPatch(exp.id, body)} onDelete={() => onDelete(exp.id)} />
                        ))}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="v5-table-wrap panel" style={{ padding: 0 }}>
                  <table className="v5-table">
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
                      {items.map((exp) => (
                        <tr key={exp.id}>
                          <td style={{ maxWidth: 260 }}>{exp.hypothesis}</td>
                          <td>{exp.dimensions.map((d) => EXPERIMENT_DIMENSION_LABEL[d]).join(', ')}</td>
                          <td className="small muted">{targetSummary(exp)}</td>
                          <td className="small">
                            {formatDate(exp.started_on)} ~ {exp.ended_on ? formatDate(exp.ended_on) : '진행 중'}
                          </td>
                          <td>
                            <Badge tone={STATUS_TONE[exp.status]}>{EXPERIMENT_STATUS_LABEL[exp.status]}</Badge>
                          </td>
                          <td className="num">{exp.effect_size !== null ? `${exp.effect_size >= 0 ? '+' : ''}${exp.effect_size}%` : '-'}</td>
                          <td className="small muted">{exp.next_action || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {drawerOpen ? (
        <Drawer
          title="새 실험 만들기"
          onClose={() => setDrawerOpen(false)}
          footer={
            <>
              <button className="button secondary" type="button" onClick={() => setDrawerOpen(false)}>
                취소
              </button>
              <button className="button" type="button" disabled={saving} onClick={onCreate}>
                {saving ? '저장 중…' : '실험 시작하기'}
              </button>
            </>
          }
        >
          <FormField label="1. 무엇을 바꿔 보나요?" hint={DIMENSION_HINT} error={showErr('dimensions')}>
            <div className="v5p-chips">
              {EXPERIMENT_DIMENSIONS.map((dim) => (
                <button key={dim} type="button" aria-pressed={form.dimensions.includes(dim)} className={`v5p-chip ${form.dimensions.includes(dim) ? 'on' : ''}`} onClick={() => toggleDimension(dim)}>
                  {EXPERIMENT_DIMENSION_LABEL[dim]}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="2. 가설" hint="“이렇게 바꾸면 이렇게 될 것이다”를 한 줄로 적어요." error={showErr('hypothesis')} htmlFor="v5p-hypo">
            <textarea
              id="v5p-hypo"
              className="textarea"
              rows={3}
              maxLength={500}
              value={form.hypothesis}
              onChange={(e) => setForm((f) => ({ ...f, hypothesis: e.target.value }))}
              placeholder="예: 썸네일에 큰 숫자를 넣으면 클릭이 더 늘 것이다"
            />
          </FormField>

          <FormField label="3. 대상 영상" hint={`실험할 영상을 골라요. ${fmtNum(form.videoIds.length)}개 선택됨`} error={showErr('videoIds')}>
            {videoOptions.length === 0 ? (
              <div className="v5p-note">
                아직 등록된 영상이 없어요. <Link href="/v5/register">영상 등록</Link>에서 먼저 영상을 넣어 주세요.
              </div>
            ) : (
              <>
                <input className="input" type="search" value={videoQuery} onChange={(e) => setVideoQuery(e.target.value)} placeholder="종목명이나 제목으로 찾기 (예: 삼성전자)" />
                <div className="v5p-picker" role="group" aria-label="대상 영상 선택">
                  {filteredVideos.slice(0, 40).map((v) => {
                    const on = form.videoIds.includes(v.id)
                    return (
                      <label key={v.id} className={`v5p-pick-row ${on ? 'on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleVideo(v.id)} />
                        <span className="v5p-pick-stock">{v.stock_name}</span>
                        <span className="v5p-pick-title">{v.title || '(제목 없음)'}</span>
                      </label>
                    )
                  })}
                  {filteredVideos.length === 0 ? <div className="v5p-pick-empty">찾는 영상이 없어요.</div> : null}
                  {filteredVideos.length > 40 ? <div className="v5p-pick-empty">최근 {fmtNum(filteredVideos.length)}개 중 40개만 보여요. 검색으로 좁혀 보세요.</div> : null}
                </div>
              </>
            )}
          </FormField>

          <FormField label="4. 시작일" error={showErr('startedOn')} htmlFor="v5p-start">
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
        </Drawer>
      ) : null}

      <Toast toast={toast} />
    </>
  )
}
