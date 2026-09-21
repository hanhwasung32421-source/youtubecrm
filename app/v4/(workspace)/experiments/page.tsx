'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { Toast, useToast } from '@/components/toast'
import { getKstYmd } from '@/lib/attendance/time'
import { v4Fetch, v4Json } from '@/lib/v4/client'
import { useV4Query } from '@/lib/v4/use-v4-query'
import { useUrlFilters } from '@/lib/v4/use-url-filters'
import { useSearchField } from '@/lib/v4/use-search-field'
import { DEFAULT_METRIC } from '@/lib/v4/experiment-consts'
import { applyResultPatch, deleteConsequence, nextStep } from '@/lib/v4/experiment-view'
import { EXPERIMENTS_SPEC, rankingHref, type ExperimentsFilters } from '@/lib/v4/page-filters'
import { buildCsv, csvFilename } from '@/lib/v4/csv'
import { downloadCsvFile } from '@/lib/v4/download'
import type { ExperimentItem } from '@/lib/v4/sample-data'
import type { VideoOption } from '@/lib/v4/experiments'
import { ActiveFilters, CopyLinkButton, CsvButton, GlossaryList, type FilterChip } from '@/lib/v4/page-tools'
import { Badge, Card, EmptyPanel, ErrorPanel, Hero, Kpi, KpiRow, SampleNote, Seg, SkelCards, TimeAgo } from '@/lib/v4/analysis-ui'
import { fmtKstStamp, fmtNumber, fmtNumberOr, fmtYmdKo } from '@/lib/v4/format'
import { ExperimentForm } from './experiment-form'
import { ResultRecorder, type ResultDraft, type ResultValues } from './result-recorder'
import { ExperimentStepper } from './stepper'
import '../pages.css'
import './experiments.css'

type ExperimentsResponse = {
  sample: boolean
  scope: 'admin' | 'staff'
  items: ExperimentItem[]
  videoOptions: VideoOption[]
  truncated?: boolean
}

type Filter = ExperimentsFilters['status']

const WINNER_BADGE: Record<'a' | 'b' | 'tie', { label: string; tone: 'good' | 'info' | 'neutral' }> = {
  a: { label: '기존(A)이 더 좋았어요', tone: 'info' },
  b: { label: '새 방식(B)이 더 좋았어요', tone: 'good' },
  tie: { label: '차이가 없었어요', tone: 'neutral' }
}

const RESET_KEYS: Array<keyof ExperimentsFilters> = ['status', 'q']
const LOAD_FALLBACK = '실험 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'

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

function matches(item: ExperimentItem, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [item.hypothesis, item.variantA, item.variantB, item.learning ?? '', item.videoTitle, item.stockName, item.metric].some((text) => text.toLowerCase().includes(needle))
}

export default function ExperimentsPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 안에 있어야 한다 (Next 16).
  return (
    <Suspense
      fallback={
        <div className="v4p" style={{ padding: 16 }}>
          <SkelCards count={3} />
        </div>
      }
    >
      <ExperimentsScreen />
    </Suspense>
  )
}

function ExperimentsScreen() {
  const { me, isAdmin } = useV4Me()
  const { toast, showSuccess, showError } = useToast()
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError
  const [formMode, setFormMode] = useState<'closed' | 'new' | { edit: string }>('closed')
  const [record, setRecord] = useState<{ id: string; focus: 'winner' | 'learning' } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ResultDraft>>({})
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, 'save' | 'delete'>>({})
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [flashId, setFlashId] = useState<string | null>(null)
  const { filters, ready, set, reset, shareUrl } = useUrlFilters<ExperimentsFilters>('experiments', EXPERIMENTS_SPEC)
  const { status: filter, q: queryValue } = filters
  const [queryText, setQueryText] = useSearchField(queryValue, (value) => set({ q: value }))
  const formRef = useRef<HTMLDivElement | null>(null)
  const autoOpened = useRef(false)
  const hasDataRef = useRef(false)
  const pendingRef = useRef(new Set<string>()) // 저장·삭제가 끝나기 전에 같은 실험을 또 건드리지 못하게 (state 는 다음 렌더에야 바뀐다)

  // 옛 목록을 먼저 보여주고 뒤에서 새로 받는다. 화면을 떠나면 요청이 취소된다.
  const { data, error: loadError, status: loadStatus, fetching, reload, mutate } = useV4Query<ExperimentsResponse>(ready ? '/api/v4/experiments' : null, {
    fallback: LOAD_FALLBACK,
    // 이미 목록이 보이는 중이면 화면은 그대로 두고 알림만 띄운다.
    onError: (message) => {
      if (hasDataRef.current) showErrorRef.current(message)
    }
  })
  hasDataRef.current = data !== null

  // 처음 들어왔는데 실험이 하나도 없으면 등록 폼을 바로 펼쳐 둔다.
  useEffect(() => {
    if (data && !autoOpened.current) {
      autoOpened.current = true
      if (data.items.length === 0) setFormMode('new')
    }
  }, [data])

  // 삭제 확인 중 Esc = 취소
  useEffect(() => {
    if (!confirmId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmId])

  const all = useMemo(() => data?.items ?? [], [data])
  const running = useMemo(() => all.filter((i) => !i.winner), [all])
  const done = useMemo(() => all.filter((i) => Boolean(i.winner)), [all])
  const bWins = done.filter((i) => i.winner === 'b').length
  const latestLearning = useMemo(() => all.find((i) => i.learning && i.learning.trim()) ?? null, [all])
  const byStatus = filter === 'running' ? running : filter === 'done' ? done : all
  const items = useMemo(() => byStatus.filter((i) => matches(i, queryValue)), [byStatus, queryValue])

  const sample = Boolean(data?.sample)
  const canEdit = (item: ExperimentItem) => !sample && (isAdmin || Boolean(me?.crmUserId && item.createdBy === me.crmUserId))
  const today = getKstYmd()
  const noData = Boolean(data) && all.length === 0
  const editingItem = typeof formMode === 'object' ? all.find((i) => i.id === formMode.edit) ?? null : null

  // ---- 화면 상태만 바꾸는 도우미: 서버가 돌려준 실험으로 목록을 바로 갱신한다 (다시 불러오지 않아 화면이 튀지 않는다)
  const applyItem = (item: ExperimentItem) => {
    mutate((prev) => ({ ...prev, items: sortItems([item, ...prev.items.filter((i) => i.id !== item.id)]) }))
    setFlashId(item.id)
    window.setTimeout(() => setFlashId((cur) => (cur === item.id ? null : cur)), 1500)
  }
  // 순서는 그대로 두고 한 개만 바꾼다 (낙관적 갱신 / 되돌리기용)
  const replaceItem = (item: ExperimentItem) => mutate((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === item.id ? item : i)) }))

  const markPending = (id: string, kind: 'save' | 'delete' | null) => {
    if (kind) pendingRef.current.add(id)
    else pendingRef.current.delete(id)
    setPending((prev) => {
      const next = { ...prev }
      if (kind) next[id] = kind
      else delete next[id]
      return next
    })
  }

  const scrollTo = (elementId: string) =>
    window.setTimeout(() => document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40)

  const openNew = () => {
    setRecord(null)
    setFormMode('new')
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const openEdit = (item: ExperimentItem) => {
    setRecord(null)
    setFormMode({ edit: item.id })
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const openRecord = (item: ExperimentItem, focus: 'winner' | 'learning' = 'winner') => {
    if (pendingRef.current.has(item.id)) return
    setFormMode('closed')
    setConfirmId(null)
    // 상태 필터·검색어 때문에 카드가 안 보이면 풀어 준다.
    if ((filter === 'done' && !item.winner) || (filter === 'running' && item.winner)) set({ status: 'all' })
    if (queryValue && !matches(item, queryValue)) set({ q: '' })
    setRecord({ id: item.id, focus })
    scrollTo(`exp-${item.id}`)
  }

  // ---- 결과 저장: 화면을 먼저 바꾸고 → 서버에 저장 → 실패하면 원래대로 되돌리고 적던 내용을 다시 열어 준다.
  const submitResult = async (item: ExperimentItem, values: ResultValues) => {
    if (pendingRef.current.has(item.id)) return
    const patch = { winner: values.winner, learning: values.learning.trim() || null, endedOn: values.endedOn || today }
    const before = item
    markPending(item.id, 'save')
    setRecord(null)
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
    setRowError((prev) => ({ ...prev, [item.id]: '' }))
    replaceItem(applyResultPatch(item, patch))
    const result = await v4Json<{ item: ExperimentItem }>('PATCH', `/api/v4/experiments/${item.id}`, patch, '결과를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    markPending(item.id, null)
    if (result.ok) {
      applyItem(result.data.item)
      showSuccess(before.winner ? '결과를 고쳤어요.' : '결과를 기록했어요. 끝난 실험으로 옮겼어요.')
      return
    }
    replaceItem(before) // 되돌리기
    setDrafts((prev) => ({ ...prev, [item.id]: { winner: values.winner, learning: values.learning, endedOn: values.endedOn, message: result.message } }))
    setRecord({ id: item.id, focus: 'winner' })
    showError(result.message)
  }

  // ---- 진행 중으로 되돌리기 (같은 방식: 먼저 바꾸고, 실패하면 원래대로)
  const reopenItem = async (item: ExperimentItem) => {
    if (pendingRef.current.has(item.id)) return
    const before = item
    markPending(item.id, 'save')
    setRecord(null)
    setRowError((prev) => ({ ...prev, [item.id]: '' }))
    replaceItem(applyResultPatch(item, { winner: null, endedOn: null }))
    const result = await v4Json<{ item: ExperimentItem }>('PATCH', `/api/v4/experiments/${item.id}`, { winner: null, endedOn: null }, '진행 중으로 되돌리지 못했어요. 잠시 후 다시 시도해 주세요.')
    markPending(item.id, null)
    if (result.ok) {
      applyItem(result.data.item)
      showSuccess('진행 중인 실험으로 되돌렸어요.')
      return
    }
    replaceItem(before)
    setRowError((prev) => ({ ...prev, [item.id]: result.message }))
    showError(result.message)
  }

  // ---- 삭제: 목록에서 먼저 지우고 → 서버에서 삭제 → 실패하면 제자리에 다시 넣는다.
  const remove = async (item: ExperimentItem) => {
    if (pendingRef.current.has(item.id)) return // 더블 클릭으로 두 번 지우지 않는다
    markPending(item.id, 'delete')
    setConfirmId(null)
    setRowError((prev) => ({ ...prev, [item.id]: '' }))
    if (record?.id === item.id) setRecord(null)
    if (typeof formMode === 'object' && formMode.edit === item.id) setFormMode('closed')
    mutate((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== item.id) }))
    const result = await v4Fetch<{ ok: boolean }>(`/api/v4/experiments/${item.id}`, { method: 'DELETE' }, '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
    markPending(item.id, null)
    if (result.ok) return
    mutate((prev) => ({ ...prev, items: sortItems([item, ...prev.items.filter((i) => i.id !== item.id)]) })) // 되돌리기
    setRowError((prev) => ({ ...prev, [item.id]: `삭제하지 못해서 목록에 다시 넣었어요. ${result.message}` }))
    showError(result.message)
  }

  // ---- 표를 CSV 로 저장 (지금 상태 필터·검색에 맞는 실험 전부)
  const exportCsv = () => {
    if (items.length === 0) return
    const headers = ['시작일', '끝난 날', '상태', '무엇을 확인하나', 'A (지금 방식)', 'B (새 방식)', '비교 기준', '배운 점', '대상 영상', '종목', '만든 사람']
    const rows = items.map((i) => [
      i.startedOn,
      i.endedOn ?? '',
      i.winner ? WINNER_BADGE[i.winner].label : '진행 중',
      i.hypothesis,
      i.variantA,
      i.variantB,
      i.metric,
      i.learning ?? '',
      i.videoId ? i.videoTitle : '',
      i.stockName === '-' ? '' : i.stockName,
      i.createdByName
    ])
    downloadCsvFile(csvFilename('실험기록'), buildCsv(headers, rows))
    showSuccess(`실험 ${fmtNumber(items.length)}개를 CSV로 저장했어요.`)
  }

  const chips: FilterChip[] = []
  if (filter !== 'all') chips.push({ key: 'status', label: filter === 'running' ? '진행 중인 실험만' : '끝난 실험만', onRemove: () => set({ status: 'all' }) })
  if (queryValue) chips.push({ key: 'q', label: `검색: ${queryValue}`, onRemove: () => set({ q: '' }) })
  const clearFilters = () => reset(RESET_KEYS)

  const formOpen = formMode !== 'closed'

  return (
    <>
      <PageHeader
        title="실험 관리 (A/B 로그)"
        subtitle="썸네일·제목을 두 가지로 만들어 비교해 보고, 결과와 배운 점을 남깁니다."
        actions={
          <>
            <CopyLinkButton getUrl={shareUrl} onResult={(ok) => (ok ? showSuccess('이 화면 링크를 복사했어요. 받은 사람도 같은 조건으로 볼 수 있어요.') : showError('링크를 복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.'))} />
            <button type="button" className="button" onClick={openNew} disabled={sample}>
              + 새 실험 만들기
            </button>
          </>
        }
      />
      <Toast toast={toast} />

      <div className="v4p">
        {sample ? <SampleNote /> : null}

        {loadError && !data ? (
          <ErrorPanel message={loadError} status={loadStatus} onRetry={reload} busy={fetching} />
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
                    <Link href="/v4/ranking" className="button secondary">
                      영상 성과부터 살펴보기
                    </Link>
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
                      진행 중인 실험 <span className="em">{fmtNumberOr(running.length)}개</span>가 결과를 기다리고 있어요
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
                          <div style={{ fontWeight: 700 }} className="v4p-ellipsis" title={item.hypothesis}>
                            {item.hypothesis}
                          </div>
                          <div className="small muted">
                            {fmtYmdKo(item.startedOn)} 시작 · {fmtNumberOr(daysBetween(item.startedOn, today) + 1)}일째
                          </div>
                        </div>
                        {canEdit(item) ? (
                          <button type="button" className="button secondary" onClick={() => openRecord(item)} disabled={Boolean(pending[item.id])}>
                            결과 기록하기
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {running.length > 3 ? <div className="small muted">그 밖에 {fmtNumberOr(running.length - 3)}개는 아래 목록에서 볼 수 있어요.</div> : null}
                  </div>
                ) : latestLearning ? (
                  <div className="v4p-learn" style={{ background: 'rgba(255,255,255,0.7)' }}>
                    <strong>{latestLearning.hypothesis}</strong>
                    <div style={{ marginTop: 4 }}>{latestLearning.learning}</div>
                  </div>
                ) : (
                  <div className="v4p-hero-actions">
                    <button type="button" className="button" onClick={openNew} disabled={sample}>
                      새 실험 만들기
                    </button>
                  </div>
                )}
              </Hero>
            )}

            {data && !noData ? (
              <KpiRow>
                <Kpi label="진행 중인 실험" value={`${fmtNumberOr(running.length)}개`} hint="아직 결과를 기록하지 않은 실험이에요." />
                <Kpi label="끝난 실험" value={`${fmtNumberOr(done.length)}개`} hint="결과까지 기록해서 마무리한 실험이에요." />
                <Kpi label="새 방식(B)이 더 좋았던 실험" value={`${fmtNumberOr(bWins)}개`} hint="새로 해본 방식이 기존보다 잘 나온 횟수예요." tone={bWins > 0 ? 'good' : 'neutral'} />
              </KpiRow>
            ) : null}

            {formOpen && data ? (
              <div ref={formRef} style={{ scrollMarginTop: 16 }}>
                <Card
                  title={editingItem ? '실험 내용 고치기' : '새 실험 만들기'}
                  sub={editingItem ? '결과와 배운 점은 목록의 “결과 기록하기”에서 남길 수 있어요.' : '한 번에 한 가지만 바꿔야 결과를 제대로 해석할 수 있어요.'}
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
                sub="최근에 시작한 실험이 위에 있어요. 카드 위쪽 단계 표시로 어디까지 왔는지 볼 수 있어요."
                actions={
                  <>
                    <CsvButton onExport={exportCsv} disabled={!data || items.length === 0} />
                    <Seg
                      label="상태 필터"
                      value={filter}
                      options={[
                        ['all', `전체 ${all.length}`],
                        ['running', `진행 중 ${running.length}`],
                        ['done', `끝남 ${done.length}`]
                      ]}
                      onChange={(next) => set({ status: next })}
                    />
                  </>
                }
              >
                <div className="v4p-filters">
                  <input
                    className="input search"
                    type="search"
                    placeholder="가설·방식·배운 점·영상 제목으로 찾기"
                    value={queryText}
                    maxLength={60}
                    onChange={(e) => setQueryText(e.target.value)}
                    aria-label="실험 검색"
                  />
                </div>
                <ActiveFilters chips={chips} onReset={clearFilters} />
                {!data ? (
                  <SkelCards count={3} />
                ) : items.length === 0 ? (
                  <EmptyPanel
                    title={queryValue ? '찾는 실험이 없어요' : filter === 'running' ? '진행 중인 실험이 없어요' : '끝난 실험이 아직 없어요'}
                    action={
                      chips.length > 0 ? (
                        <button type="button" className="button secondary" onClick={clearFilters}>
                          필터 초기화
                        </button>
                      ) : (
                        <button type="button" className="button" onClick={openNew} disabled={sample}>
                          새 실험 만들기
                        </button>
                      )
                    }
                  >
                    {queryValue
                      ? `“${queryValue}”가 들어간 실험이 없어요. 검색어를 바꾸거나 필터를 초기화해 보세요.`
                      : filter === 'running'
                        ? '모든 실험의 결과가 기록되어 있어요. 새 실험을 만들어 다음 아이디어를 확인해 보세요.'
                        : '진행 중인 실험에서 “결과 기록하기”를 누르면 여기에 모여요.'}
                  </EmptyPanel>
                ) : (
                  <div className="v4p-exp-list">
                    {items.map((item) => {
                      const editable = canEdit(item)
                      const confirming = confirmId === item.id
                      const busyKind = pending[item.id]
                      const busy = Boolean(busyKind)
                      const next = nextStep(item)
                      const isRecording = editable && record?.id === item.id
                      return (
                        <div className={`v4p-exp ${flashId === item.id ? 'flash' : ''} ${busy ? 'pending' : ''}`} key={item.id} id={`exp-${item.id}`} aria-busy={busy}>
                          <div style={{ minWidth: 0 }}>
                            <div className="v4p-exp-meta">
                              <StatusBadge winner={item.winner} />
                              <span>
                                {fmtYmdKo(item.startedOn)} ~ {item.endedOn ? fmtYmdKo(item.endedOn) : item.winner ? '' : `${fmtNumberOr(daysBetween(item.startedOn, today) + 1)}일째`}
                              </span>
                              {isAdmin ? <span>· {item.createdByName}</span> : null}
                              <span title={`등록 ${fmtKstStamp(item.createdAt)}`}>
                                · <TimeAgo iso={item.createdAt} prefix="등록 " />
                              </span>
                            </div>
                            <ExperimentStepper item={item} pending={busyKind === 'save'} />
                            <div className="v4p-exp-title" title={item.hypothesis.length > 90 ? item.hypothesis : undefined}>{item.hypothesis}</div>
                            {item.videoId || item.metric !== DEFAULT_METRIC ? (
                              <div className="v4p-exp-link">
                                {item.videoId ? (
                                  <>
                                    영상: {item.videoTitle}
                                    {item.stockName !== '-' ? ` (${item.stockName})` : ''}
                                    {' · '}
                                    <Link href={rankingHref({ q: item.videoTitle })}>성과 보기</Link>
                                    {item.videoUrl ? (
                                      <>
                                        {' · '}
                                        <a href={item.videoUrl} target="_blank" rel="noopener noreferrer">
                                          유튜브에서 보기 ↗
                                        </a>
                                      </>
                                    ) : null}
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
                            {editable && confirming ? (
                              <div className="v4p-confirm" role="alertdialog" aria-label="실험 삭제 확인">
                                <p>
                                  <strong>이 실험을 삭제할까요?</strong> {deleteConsequence(item)}
                                </p>
                                <div className="v4p-form-actions">
                                  <button type="button" className="button danger" onClick={() => void remove(item)} autoFocus>
                                    삭제하기
                                  </button>
                                  <button type="button" className="button secondary" onClick={() => setConfirmId(null)}>
                                    취소
                                  </button>
                                  <span className="v4p-keyhint">Esc 취소</span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {editable ? (
                            <div className="v4p-exp-actions">
                              {next.action === 'record' ? (
                                <button type="button" className="button" onClick={() => openRecord(item)} disabled={busy}>
                                  결과 기록하기
                                </button>
                              ) : next.action === 'learn' ? (
                                <button type="button" className="button" onClick={() => openRecord(item, 'learning')} disabled={busy}>
                                  배운 점 적기
                                </button>
                              ) : (
                                <button type="button" className="button secondary" onClick={() => openRecord(item)} disabled={busy}>
                                  결과 고치기
                                </button>
                              )}
                              {next.action === 'learn' ? (
                                <button type="button" className="button secondary" onClick={() => openRecord(item)} disabled={busy}>
                                  결과 고치기
                                </button>
                              ) : null}
                              <button type="button" className="button secondary" onClick={() => openEdit(item)} disabled={busy}>
                                내용 고치기
                              </button>
                              <button type="button" className="button v4p-btn-danger-soft" onClick={() => setConfirmId(item.id)} disabled={busy || confirming}>
                                {busyKind === 'delete' ? '삭제 중…' : '삭제'}
                              </button>
                            </div>
                          ) : null}
                          {isRecording ? (
                            <ResultRecorder
                              key={`${item.id}-${item.updatedAt}-${record?.focus}-${drafts[item.id]?.message ?? ''}`}
                              item={item}
                              today={today}
                              focus={record?.focus}
                              draft={drafts[item.id] ?? null}
                              onCancel={() => {
                                setRecord(null)
                                setDrafts((prev) => {
                                  const rest = { ...prev }
                                  delete rest[item.id]
                                  return rest
                                })
                              }}
                              onSubmit={(values) => void submitResult(item, values)}
                              onReopen={() => void reopenItem(item)}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
                {data?.truncated ? <p className="small muted" style={{ marginTop: 10 }}>실험이 매우 많아서 가장 최근 1,000개만 보여줘요.</p> : null}
                <GlossaryList terms={['abTest']} />
              </Card>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
