'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { Toast, useToast } from '@/components/toast'
import { getKstYmd } from '@/lib/attendance/time'
import { v4Fetch } from '@/lib/v4/client'
import { DEFAULT_METRIC } from '@/lib/v4/experiment-consts'
import { useStoredState } from '@/lib/v4/use-stored-state'
import type { ExperimentItem } from '@/lib/v4/sample-data'
import type { VideoOption } from '@/lib/v4/experiments'
import { Badge, Card, EmptyPanel, ErrorPanel, Hero, Kpi, KpiRow, SampleNote, Seg, SkelRows } from '@/lib/v4/analysis-ui'
import { fmtDateKst, fmtNumber } from '@/lib/v4/format'
import { ExperimentForm } from './experiment-form'
import { ResultRecorder } from './result-recorder'
import '../pages.css'
import './experiments.css'

type ExperimentsResponse = {
  sample: boolean
  scope: 'admin' | 'staff'
  items: ExperimentItem[]
  videoOptions: VideoOption[]
  truncated?: boolean
}

type Filter = 'all' | 'running' | 'done'

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

function daysBetween(fromYmd: string, toYmd: string) {
  const diff = (Date.parse(toYmd) - Date.parse(fromYmd)) / 86400000
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : 0
}

// 최근에 시작한 실험이 위로 (서버 정렬과 같은 기준)
function sortItems(items: ExperimentItem[]) {
  return [...items].sort((a, b) => (a.startedOn === b.startedOn ? (a.createdAt < b.createdAt ? 1 : -1) : a.startedOn < b.startedOn ? 1 : -1))
}

export default function ExperimentsPage() {
  const { me, isAdmin } = useV4Me()
  const { toast, showSuccess, showError } = useToast()
  const [data, setData] = useState<ExperimentsResponse | null>(null)
  const [loadError, setLoadError] = useState('')
  const [formMode, setFormMode] = useState<'closed' | 'new' | { edit: string }>('closed')
  const [recordId, setRecordId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [flashId, setFlashId] = useState<string | null>(null)
  const [filter, setFilter] = useStoredState<Filter>('v4:experiments:filter', 'all', (v): v is Filter => v === 'all' || v === 'running' || v === 'done')
  const formRef = useRef<HTMLDivElement | null>(null)
  const autoOpened = useRef(false)
  const hasDataRef = useRef(false)

  const load = useCallback(async () => {
    const result = await v4Fetch<ExperimentsResponse>('/api/v4/experiments', {}, '실험 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    if (!result.ok) {
      setLoadError(result.message)
      // 이미 목록이 보이는 중이면 화면은 그대로 두고 알림만 띄운다.
      if (hasDataRef.current) showError(result.message)
      return
    }
    setLoadError('')
    hasDataRef.current = true
    setData(result.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 처음 들어왔는데 실험이 하나도 없으면 등록 폼을 바로 펼쳐 둔다.
  useEffect(() => {
    if (data && !autoOpened.current) {
      autoOpened.current = true
      if (data.items.length === 0) setFormMode('new')
    }
  }, [data])

  // 삭제 확인 중 Esc = 취소, 몇 초 지나면 저절로 원래 버튼으로 돌아간다.
  useEffect(() => {
    if (!confirmId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmId(null)
    }
    const timer = window.setTimeout(() => setConfirmId(null), 7000)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [confirmId])

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
  const editingItem = typeof formMode === 'object' ? all.find((i) => i.id === formMode.edit) ?? null : null

  // ---- 화면 상태만 바꾸는 도우미: 서버가 돌려준 실험으로 목록을 바로 갱신한다 (다시 불러오지 않아 화면이 튀지 않는다)
  const applyItem = (item: ExperimentItem) => {
    setData((prev) => (prev ? { ...prev, items: sortItems([item, ...prev.items.filter((i) => i.id !== item.id)]) } : prev))
    setFlashId(item.id)
    window.setTimeout(() => setFlashId((cur) => (cur === item.id ? null : cur)), 1500)
  }

  const scrollTo = (elementId: string) =>
    window.setTimeout(() => document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40)

  const openNew = () => {
    setRecordId(null)
    setFormMode('new')
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const openEdit = (item: ExperimentItem) => {
    setRecordId(null)
    setFormMode({ edit: item.id })
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const openRecord = (item: ExperimentItem) => {
    setFormMode('closed')
    setConfirmId(null)
    // 필터 때문에 카드가 안 보이면 전체 보기로 바꿔 준다.
    if (filter === 'done' && !item.winner) setFilter('all')
    if (filter === 'running' && item.winner) setFilter('all')
    setRecordId(item.id)
    scrollTo(`exp-${item.id}`)
  }

  const remove = async (item: ExperimentItem) => {
    setDeletingId(item.id)
    setRowError((prev) => ({ ...prev, [item.id]: '' }))
    const result = await v4Fetch<{ ok: boolean }>(`/api/v4/experiments/${item.id}`, { method: 'DELETE' }, '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
    setDeletingId(null)
    setConfirmId(null)
    if (!result.ok) {
      setRowError((prev) => ({ ...prev, [item.id]: result.message }))
      return
    }
    setData((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev))
    if (recordId === item.id) setRecordId(null)
    if (typeof formMode === 'object' && formMode.edit === item.id) setFormMode('closed')
  }

  const formOpen = formMode !== 'closed'

  return (
    <>
      <PageHeader
        title="실험 관리 (A/B 로그)"
        subtitle="썸네일·제목을 두 가지로 만들어 비교해 보고, 결과와 배운 점을 남깁니다."
        actions={
          <button type="button" className="button" onClick={openNew} disabled={sample}>
            + 새 실험 만들기
          </button>
        }
      />
      <Toast toast={toast} />

      <div className="v4p">
        {sample ? <SampleNote /> : null}

        {loadError && !data ? (
          <ErrorPanel message={loadError} onRetry={() => void load()} />
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
                {!formOpen ? (
                  <div className="v4p-hero-actions">
                    <button type="button" className="button" onClick={openNew}>
                      첫 실험 만들기
                    </button>
                  </div>
                ) : null}
              </Hero>
            ) : (
              <Hero
                loading={!data}
                eyebrow={data ? (isAdmin ? '팀 전체 실험' : '내가 등록한 실험') : undefined}
                headline={
                  running.length > 0 ? (
                    <>
                      진행 중인 실험 <span className="em">{fmtNumber(running.length)}개</span>가 결과를 기다리고 있어요
                    </>
                  ) : latestLearning ? (
                    '진행 중인 실험이 없어요. 가장 최근에 알게 된 점이에요'
                  ) : (
                    '진행 중인 실험이 없어요. 새 실험을 시작해 보세요'
                  )
                }
              >
                {running.length > 0 ? (
                  <div className="v4p-running-list">
                    {running.slice(0, 3).map((item) => (
                      <div className="v4p-running-item" key={item.id}>
                        <div>
                          <div style={{ fontWeight: 700 }} className="v4p-ellipsis">
                            {item.hypothesis}
                          </div>
                          <div className="small muted">
                            {fmtDateKst(item.startedOn)} 시작 · {fmtNumber(daysBetween(item.startedOn, today) + 1)}일째
                          </div>
                        </div>
                        {canEdit(item) ? (
                          <button type="button" className="button secondary" onClick={() => openRecord(item)}>
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

            {formOpen && data ? (
              <div ref={formRef} style={{ scrollMarginTop: 16 }}>
                <Card
                  title={editingItem ? '실험 내용 고치기' : '새 실험 만들기'}
                  sub={editingItem ? '결과와 배운 점은 목록의 “결과 기록”에서 남길 수 있어요.' : '한 번에 한 가지만 바꿔야 결과를 제대로 해석할 수 있어요.'}
                >
                  <ExperimentForm
                    key={editingItem?.id ?? 'new'}
                    editing={editingItem}
                    videoOptions={data.videoOptions}
                    onClose={() => setFormMode('closed')}
                    onSaved={(item, mode) => {
                      applyItem(item)
                      if (mode === 'edit') setFormMode('closed')
                      else showSuccess('실험을 등록했어요. 아래 목록에서 볼 수 있어요.')
                    }}
                  />
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
                {!data ? (
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
                    {items.map((item) => {
                      const editable = canEdit(item)
                      const confirming = confirmId === item.id
                      const busy = deletingId === item.id
                      return (
                        <div className={`v4p-exp ${flashId === item.id ? 'flash' : ''}`} key={item.id} id={`exp-${item.id}`}>
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
                                {item.videoId ? (
                                  <>
                                    영상: {item.videoTitle}
                                    {item.stockName !== '-' ? ` (${item.stockName})` : ''}
                                  </>
                                ) : null}
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
                            {rowError[item.id] ? (
                              <div className="v4p-inline-error" role="alert">
                                {rowError[item.id]}
                              </div>
                            ) : null}
                          </div>
                          {editable ? (
                            <div className="v4p-exp-actions">
                              <button type="button" className={item.winner ? 'button secondary' : 'button'} onClick={() => openRecord(item)} disabled={busy}>
                                {item.winner ? '결과 고치기' : '결과 기록'}
                              </button>
                              <button type="button" className="button secondary" onClick={() => openEdit(item)} disabled={busy}>
                                내용 고치기
                              </button>
                              {confirming ? (
                                <>
                                  <button type="button" className="button danger" onClick={() => void remove(item)} disabled={busy} autoFocus>
                                    {busy ? '삭제 중…' : '정말 삭제'}
                                  </button>
                                  <button type="button" className="button secondary" onClick={() => setConfirmId(null)} disabled={busy}>
                                    취소
                                  </button>
                                </>
                              ) : (
                                <button type="button" className="button v4p-btn-danger-soft" onClick={() => setConfirmId(item.id)} disabled={busy}>
                                  삭제
                                </button>
                              )}
                            </div>
                          ) : null}
                          {editable && recordId === item.id ? (
                            <ResultRecorder
                              key={`${item.id}-${item.updatedAt}`}
                              item={item}
                              today={today}
                              onCancel={() => setRecordId(null)}
                              onSaved={(saved, message) => {
                                applyItem(saved)
                                setRecordId(null)
                                showSuccess(message)
                              }}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
                {data?.truncated ? <p className="small muted" style={{ marginTop: 10 }}>실험이 매우 많아서 가장 최근 1,000개만 보여줘요.</p> : null}
              </Card>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
