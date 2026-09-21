'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { getKstYmd } from '@/lib/attendance/time'
import type { ExperimentItem } from '@/lib/v4/sample-data'
import type { VideoOption } from '@/lib/v4/experiments'
import { Badge, Card, EmptyPanel, ErrorPanel, Hero, Kpi, KpiRow, SampleNote, Seg, SkelRows } from '@/lib/v4/analysis-ui'
import { fmtDateKst, fmtNumber } from '@/lib/v4/format'
import '../pages.css'

type ExperimentsResponse = {
  sample: boolean
  scope: 'admin' | 'staff'
  items: ExperimentItem[]
  videoOptions: VideoOption[]
  error?: string
}

type Winner = 'a' | 'b' | 'tie' | ''
type Filter = 'all' | 'running' | 'done'
type FieldKey = 'hypothesis' | 'variantA' | 'variantB' | 'startedOn' | 'endedOn'

type FormState = {
  videoId: string
  hypothesis: string
  variantA: string
  variantB: string
  metric: string
  startedOn: string
  endedOn: string
  winner: Winner
  learning: string
}

const emptyForm = (): FormState => ({
  videoId: '',
  hypothesis: '',
  variantA: '',
  variantB: '',
  metric: '',
  startedOn: getKstYmd(),
  endedOn: '',
  winner: '',
  learning: ''
})

const DEFAULT_METRIC = '조회수'

const WINNER_BADGE: Record<'a' | 'b' | 'tie', { label: string; tone: 'good' | 'info' | 'neutral' }> = {
  a: { label: '기존(A)이 더 좋았어요', tone: 'info' },
  b: { label: '새 방식(B)이 더 좋았어요', tone: 'good' },
  tie: { label: '차이가 없었어요', tone: 'neutral' }
}

function StatusBadge({ winner }: { winner: ExperimentItem['winner'] }) {
  if (!winner) return <Badge tone="warn">진행 중</Badge>
  const w = WINNER_BADGE[winner]
  return <Badge tone={w.tone}>{w.label}</Badge>
}

function validate(form: FormState): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {}
  if (!form.hypothesis.trim()) errors.hypothesis = '무엇을 확인하고 싶은지 적어 주세요.'
  if (!form.variantA.trim()) errors.variantA = '지금 하던 방식을 적어 주세요.'
  if (!form.variantB.trim()) errors.variantB = '새로 해볼 방식을 적어 주세요.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startedOn)) errors.startedOn = '시작일을 선택해 주세요.'
  if (form.endedOn && form.startedOn && form.endedOn < form.startedOn) errors.endedOn = '종료일은 시작일보다 빠를 수 없어요.'
  return errors
}

function daysBetween(fromYmd: string, toYmd: string) {
  const diff = (Date.parse(toYmd) - Date.parse(fromYmd)) / 86400000
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : 0
}

function Field({ id, label, optional, hint, error, children }: { id: string; label: string; optional?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="v4p-field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="opt">(선택)</span> : null}
      </label>
      {children}
      {error ? (
        <div className="v4p-field-error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="v4p-field-hint">{hint}</div>
      ) : null}
    </div>
  )
}

export default function ExperimentsPage() {
  const { me, isAdmin } = useV4Me()
  const { toast, showSuccess, showError } = useToast()
  const [data, setData] = useState<ExperimentsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const formRef = useRef<HTMLDivElement | null>(null)
  const autoOpened = useRef(false)

  const load = async () => {
    const { ok, data: res } = await authedFetchJson<ExperimentsResponse>('/api/v4/experiments')
    setLoading(false)
    if (!ok || res?.error) {
      const message = res?.error || '실험 목록을 불러오지 못했습니다.'
      setLoadError(message)
      showError(message)
      return
    }
    setLoadError('')
    setData(res)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 처음 들어왔는데 실험이 하나도 없으면 등록 폼을 바로 펼쳐 둔다.
  useEffect(() => {
    if (data && !autoOpened.current) {
      autoOpened.current = true
      if (data.items.length === 0) setFormOpen(true)
    }
  }, [data])

  const errors = validate(form)
  const showErr = (key: FieldKey) => (submitted || touched[key] ? errors[key] : undefined)
  const touch = (key: FieldKey) => setTouched((prev) => ({ ...prev, [key]: true }))
  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }))

  const scrollToForm = () => window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)

  const resetForm = () => {
    setEditingId(null)
    setForm(emptyForm())
    setSubmitted(false)
    setTouched({})
    setMoreOpen(false)
  }

  const openNew = () => {
    resetForm()
    setFormOpen(true)
    scrollToForm()
  }

  const closeForm = () => {
    resetForm()
    setFormOpen(false)
  }

  const startEdit = (item: ExperimentItem) => {
    setEditingId(item.id)
    setForm({
      videoId: item.videoId || '',
      hypothesis: item.hypothesis,
      variantA: item.variantA,
      variantB: item.variantB,
      metric: item.metric === DEFAULT_METRIC ? '' : item.metric,
      startedOn: item.startedOn,
      endedOn: item.endedOn || '',
      winner: item.winner || '',
      learning: item.learning || ''
    })
    setSubmitted(false)
    setTouched({})
    setMoreOpen(true)
    setFormOpen(true)
    scrollToForm()
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSubmitted(true)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    // 결과를 골랐는데 종료일이 비어 있으면 오늘로 채운다.
    const endedOn = form.endedOn || (form.winner ? getKstYmd() : '')
    const payload = {
      videoId: form.videoId || null,
      hypothesis: form.hypothesis.trim(),
      variantA: form.variantA.trim(),
      variantB: form.variantB.trim(),
      metric: form.metric.trim() || DEFAULT_METRIC,
      startedOn: form.startedOn,
      endedOn: endedOn || null,
      winner: form.winner || null,
      learning: form.learning.trim() || null
    }
    const result = editingId
      ? await authedFetchJson<{ error?: string }>(`/api/v4/experiments/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      : await authedPostJson<{ error?: string }>('/api/v4/experiments', payload)
    setSaving(false)
    if (!result.ok || result.data?.error) {
      showError(result.data?.error || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    showSuccess(editingId ? '실험을 저장했어요.' : '실험을 등록했어요.')
    closeForm()
    void load()
  }

  const remove = async (item: ExperimentItem) => {
    setDeletingId(item.id)
    const { ok, data: res } = await authedFetchJson<{ error?: string }>(`/api/v4/experiments/${item.id}`, { method: 'DELETE' })
    setDeletingId(null)
    setConfirmId(null)
    if (!ok || res?.error) {
      showError(res?.error || '삭제하지 못했습니다.')
      return
    }
    showSuccess('실험을 삭제했어요.')
    if (editingId === item.id) closeForm()
    void load()
  }

  const all = useMemo(() => data?.items ?? [], [data])
  const running = useMemo(() => all.filter((i) => !i.winner), [all])
  const done = useMemo(() => all.filter((i) => Boolean(i.winner)), [all])
  const bWins = done.filter((i) => i.winner === 'b').length
  const latestLearning = useMemo(() => all.find((i) => i.learning && i.learning.trim()) ?? null, [all])
  const items = filter === 'running' ? running : filter === 'done' ? done : all

  const sample = Boolean(data?.sample)
  const canEdit = (item: ExperimentItem) => !sample && (isAdmin || Boolean(me?.crmUserId && item.createdBy === me.crmUserId))
  const today = getKstYmd()

  const noData = Boolean(data) && all.length === 0

  return (
    <>
      <PageHeader
        title="실험 관리 (A/B 로그)"
        subtitle="썸네일·제목을 두 가지로 만들어 비교해 보고, 결과와 배운 점을 남깁니다."
        actions={
          <button type="button" className="button" onClick={openNew} disabled={saving}>
            + 새 실험 만들기
          </button>
        }
      />
      <Toast toast={toast} />

      <div className="v4p">
        {sample ? <SampleNote /> : null}

        {loadError && !data ? (
          <ErrorPanel message={loadError} onRetry={() => { setLoading(true); void load() }} />
        ) : (
          <>
            {/* 답부터: 지금 결과를 기다리는 실험 / 최근 배운 점 / 첫 사용 안내 */}
            {noData ? (
              <Hero eyebrow="A/B 실험이란?" headline="제목이나 썸네일을 두 가지로 만들어, 어느 쪽이 더 잘 나오는지 비교하는 거예요">
                <ol className="v4p-steps">
                  <li>지금 쓰던 방식(A)과 새로 해볼 방식(B)을 정해요. 예: 썸네일 글씨를 작게 vs 크게</li>
                  <li>비슷한 영상에 각각 적용해서 올려요.</li>
                  <li>며칠 뒤 조회수를 보고 어느 쪽이 나았는지 기록해요. 배운 점은 다음 영상에 써먹어요.</li>
                </ol>
                <div className="v4p-hero-actions">
                  <button type="button" className="button" onClick={openNew}>
                    첫 실험 만들기
                  </button>
                </div>
              </Hero>
            ) : (
              <Hero
                loading={!data}
                eyebrow={data ? (isAdmin ? '팀 전체 실험' : '내가 등록한 실험') : undefined}
                headline={
                  running.length > 0
                    ? <>진행 중인 실험 <span className="em">{fmtNumber(running.length)}개</span>가 결과를 기다리고 있어요</>
                    : latestLearning
                      ? '진행 중인 실험이 없어요. 가장 최근에 알게 된 점이에요'
                      : '진행 중인 실험이 없어요. 새 실험을 시작해 보세요'
                }
              >
                {running.length > 0 ? (
                  <div className="v4p-running-list">
                    {running.slice(0, 3).map((item) => (
                      <div className="v4p-running-item" key={item.id}>
                        <div>
                          <div style={{ fontWeight: 700 }} className="v4p-ellipsis">{item.hypothesis}</div>
                          <div className="small muted">{fmtDateKst(item.startedOn)} 시작 · {fmtNumber(daysBetween(item.startedOn, today) + 1)}일째</div>
                        </div>
                        {canEdit(item) ? (
                          <button type="button" className="button secondary" onClick={() => startEdit(item)} disabled={saving}>
                            결과 기록
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {running.length > 3 ? <div className="small muted">그 밖에 {fmtNumber(running.length - 3)}개는 아래 목록에서 볼 수 있어요.</div> : null}
                  </div>
                ) : latestLearning ? (
                  <div className="v4p-learn" style={{ background: 'rgba(255,255,255,0.7)' }}>
                    <strong>{latestLearning.hypothesis}</strong>
                    <div style={{ marginTop: 4 }}>{latestLearning.learning}</div>
                  </div>
                ) : null}
              </Hero>
            )}

            {data && !noData ? (
              <KpiRow>
                <Kpi label="진행 중인 실험" value={`${fmtNumber(running.length)}개`} hint="아직 결과를 기록하지 않은 실험이에요." />
                <Kpi label="끝난 실험" value={`${fmtNumber(done.length)}개`} hint="결과까지 기록해서 마무리한 실험이에요." />
                <Kpi label="새 방식(B)이 더 좋았던 실험" value={`${fmtNumber(bWins)}개`} hint="새로 해본 방식이 기존보다 잘 나온 횟수예요." tone={bWins > 0 ? 'good' : 'neutral'} />
              </KpiRow>
            ) : null}

            {formOpen ? (
              <div ref={formRef} style={{ scrollMarginTop: 16 }}>
                <Card
                  title={editingId ? '실험 결과 기록 / 수정' : '새 실험 만들기'}
                  sub={editingId ? '어느 쪽이 더 좋았는지와 배운 점을 남겨 주세요. 아래 “더 적기”에 있어요.' : '한 번에 한 가지만 바꿔야 결과를 제대로 해석할 수 있어요.'}
                  actions={
                    <button type="button" className="button secondary" onClick={closeForm} disabled={saving}>
                      닫기
                    </button>
                  }
                >
                  <form className="v4p-form" onSubmit={submit} noValidate>
                    <Field id="exp-hypothesis" label="무엇을 확인하고 싶나요?" error={showErr('hypothesis')} hint="한 문장이면 충분해요.">
                      <textarea
                        id="exp-hypothesis"
                        className={`textarea ${showErr('hypothesis') ? 'invalid' : ''}`}
                        value={form.hypothesis}
                        onChange={(e) => update({ hypothesis: e.target.value })}
                        onBlur={() => touch('hypothesis')}
                        placeholder="예: 썸네일에 종목명을 크게 넣으면 조회수가 더 잘 나온다"
                        disabled={saving}
                      />
                    </Field>
                    <div className="v4p-form-grid">
                      <Field id="exp-a" label="A · 지금 하던 방식" error={showErr('variantA')}>
                        <textarea
                          id="exp-a"
                          className={`textarea ${showErr('variantA') ? 'invalid' : ''}`}
                          value={form.variantA}
                          onChange={(e) => update({ variantA: e.target.value })}
                          onBlur={() => touch('variantA')}
                          placeholder="예: 종목명을 작은 글씨로"
                          disabled={saving}
                        />
                      </Field>
                      <Field id="exp-b" label="B · 새로 해볼 방식" error={showErr('variantB')}>
                        <textarea
                          id="exp-b"
                          className={`textarea ${showErr('variantB') ? 'invalid' : ''}`}
                          value={form.variantB}
                          onChange={(e) => update({ variantB: e.target.value })}
                          onBlur={() => touch('variantB')}
                          placeholder="예: 종목명을 크게, 노란 배경으로"
                          disabled={saving}
                        />
                      </Field>
                    </div>
                    <div className="v4p-form-grid">
                      <Field id="exp-start" label="시작일" error={showErr('startedOn')}>
                        <input
                          id="exp-start"
                          className={`input ${showErr('startedOn') ? 'invalid' : ''}`}
                          type="date"
                          value={form.startedOn}
                          onChange={(e) => update({ startedOn: e.target.value })}
                          onBlur={() => touch('startedOn')}
                          disabled={saving}
                        />
                      </Field>
                    </div>

                    <details className="v4p-details" style={{ marginTop: 0 }} open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
                      <summary>더 적기 (선택) — 결과, 배운 점, 대상 영상 등</summary>
                      <div className="v4p-form" style={{ marginTop: 12 }}>
                        <div className="v4p-form-grid">
                          <Field id="exp-winner" label="결과" optional hint="아직 모르면 “진행 중”으로 두세요.">
                            <select id="exp-winner" className="select" value={form.winner} onChange={(e) => update({ winner: e.target.value as Winner })} disabled={saving}>
                              <option value="">아직 진행 중이에요</option>
                              <option value="a">A(기존 방식)가 더 좋았어요</option>
                              <option value="b">B(새 방식)가 더 좋았어요</option>
                              <option value="tie">차이가 없었어요</option>
                            </select>
                          </Field>
                          <Field id="exp-end" label="종료일" optional error={showErr('endedOn')} hint="결과를 고르고 비워 두면 오늘로 저장돼요.">
                            <input
                              id="exp-end"
                              className={`input ${showErr('endedOn') ? 'invalid' : ''}`}
                              type="date"
                              value={form.endedOn}
                              onChange={(e) => update({ endedOn: e.target.value })}
                              onBlur={() => touch('endedOn')}
                              disabled={saving}
                            />
                          </Field>
                        </div>
                        <Field id="exp-learning" label="배운 점" optional hint="다음 영상에 어떻게 쓸지 적어 두면 좋아요.">
                          <textarea id="exp-learning" className="textarea" value={form.learning} onChange={(e) => update({ learning: e.target.value })} placeholder="예: 종목명을 크게 하니 조회수가 1.4배 나왔다. 앞으로 크게 쓰자" disabled={saving} />
                        </Field>
                        <div className="v4p-form-grid">
                          <Field id="exp-metric" label="무엇으로 비교하나요?" optional hint={`비워 두면 “${DEFAULT_METRIC}”로 저장돼요.`}>
                            <input id="exp-metric" className="input" value={form.metric} onChange={(e) => update({ metric: e.target.value })} placeholder="예: 올린 지 48시간 뒤 조회수" disabled={saving} />
                          </Field>
                          <Field id="exp-video" label="대상 영상" optional hint="특정 영상에 한 실험이면 골라 주세요.">
                            <select id="exp-video" className="select" value={form.videoId} onChange={(e) => update({ videoId: e.target.value })} disabled={saving}>
                              <option value="">연결 안 함 (채널 전체 실험 등)</option>
                              {(data?.videoOptions ?? []).map((v) => (
                                <option key={v.id} value={v.id}>
                                  [{v.stockName}] {v.title} · {fmtDateKst(v.createdAt)}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      </div>
                    </details>

                    <div className="v4p-form-actions">
                      <button type="submit" className="button" disabled={saving || sample}>
                        {saving ? '저장 중...' : editingId ? '저장하기' : '실험 등록하기'}
                      </button>
                      <button type="button" className="button secondary" onClick={closeForm} disabled={saving}>
                        취소
                      </button>
                      {sample ? <span className="small muted">샘플 데이터 상태에서는 저장할 수 없어요.</span> : null}
                    </div>
                  </form>
                </Card>
              </div>
            ) : null}

            {!noData ? (
              <Card
                title="실험 목록"
                sub="최근에 시작한 실험이 위에 있어요."
                actions={
                  <Seg
                    label="상태 필터"
                    value={filter}
                    options={[
                      ['all', `전체 ${all.length}`],
                      ['running', `진행 중 ${running.length}`],
                      ['done', `끝남 ${done.length}`]
                    ]}
                    onChange={setFilter}
                  />
                }
              >
                {loading || !data ? (
                  <SkelRows rows={3} />
                ) : items.length === 0 ? (
                  <EmptyPanel
                    title={filter === 'running' ? '진행 중인 실험이 없어요' : '끝난 실험이 아직 없어요'}
                    action={
                      <button type="button" className="button secondary" onClick={() => setFilter('all')}>
                        전체 보기
                      </button>
                    }
                  >
                    {filter === 'running' ? '새 실험을 만들어 시작해 보세요.' : '진행 중인 실험에서 “결과 기록”을 누르면 여기에 모여요.'}
                  </EmptyPanel>
                ) : (
                  <div className="v4p-exp-list">
                    {items.map((item) => (
                      <div className="v4p-exp" key={item.id}>
                        <div style={{ minWidth: 0 }}>
                          <div className="v4p-exp-meta">
                            <StatusBadge winner={item.winner} />
                            <span>
                              {fmtDateKst(item.startedOn)} ~ {item.endedOn ? fmtDateKst(item.endedOn) : item.winner ? '' : `${fmtNumber(daysBetween(item.startedOn, today) + 1)}일째`}
                            </span>
                            {isAdmin ? <span>· {item.createdByName}</span> : null}
                          </div>
                          <div className="v4p-exp-title">{item.hypothesis}</div>
                          {item.videoId || item.metric !== DEFAULT_METRIC ? (
                            <div className="v4p-exp-link">
                              {item.videoId ? <>영상: {item.videoTitle}{item.stockName !== '-' ? ` (${item.stockName})` : ''}</> : null}
                              {item.videoId && item.metric ? ' · ' : ''}
                              {item.metric ? <>비교 기준: {item.metric}</> : null}
                            </div>
                          ) : null}
                          <div className="v4p-ab">
                            <div className={`v4p-ab-box ${item.winner === 'a' ? 'win' : ''}`}>
                              <div className="v4p-ab-tag">A · 지금 하던 방식{item.winner === 'a' ? ' — 더 좋았어요' : ''}</div>
                              {item.variantA}
                            </div>
                            <div className={`v4p-ab-box ${item.winner === 'b' ? 'win' : ''}`}>
                              <div className="v4p-ab-tag">B · 새로 해본 방식{item.winner === 'b' ? ' — 더 좋았어요' : ''}</div>
                              {item.variantB}
                            </div>
                          </div>
                          {item.learning ? <div className="v4p-learn">{item.learning}</div> : null}
                        </div>
                        {canEdit(item) ? (
                          <div className="v4p-exp-actions">
                            <button type="button" className={item.winner ? 'button secondary' : 'button'} onClick={() => startEdit(item)} disabled={saving || deletingId === item.id}>
                              {item.winner ? '수정' : '결과 기록'}
                            </button>
                            {confirmId === item.id ? (
                              <>
                                <button type="button" className="button danger" onClick={() => void remove(item)} disabled={deletingId === item.id}>
                                  {deletingId === item.id ? '삭제 중...' : '정말 삭제'}
                                </button>
                                <button type="button" className="button secondary" onClick={() => setConfirmId(null)} disabled={deletingId === item.id}>
                                  취소
                                </button>
                              </>
                            ) : (
                              <button type="button" className="button v4p-btn-danger-soft" onClick={() => setConfirmId(item.id)} disabled={saving}>
                                삭제
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
