'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v2/app-shell'
import { ContentTypeTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { useV2Me } from '@/components/v2/session-context'
import { ProgressBar, StudioLink } from '@/lib/v2/actions-ui'
import { Answer, EmptyGuide, FieldError, HowTo, InlineConfirm, Kpi, KpiRow, LoadError, MoreButton, RefreshNote, SkeletonList, SkeletonSummary, Stamp } from '@/lib/v2/analysis-ui'
import { v2Delete, v2Patch, v2Post } from '@/lib/v2/client'
import type { CsvValue } from '@/lib/v2/csv'
import { formatKstDate } from '@/lib/v2/dates'
import { ActiveFilters, type FilterChip } from '@/lib/v2/filters-ui'
import type { FilterSpec } from '@/lib/v2/filters'
import { formatCountOrDash, formatExact, shortText } from '@/lib/v2/format'
import { GlossaryDetails, Term } from '@/lib/v2/glossary-ui'
import { fixesOf, nextActionOf, progressOf, remainingFixes, sortRows, studioEditUrl, workStateOf, type Fix, type SortKey } from '@/lib/v2/next-actions'
import { ShareBar } from '@/lib/v2/share-ui'
import { useV2Query } from '@/lib/v2/swr'
import { useUrlFilters } from '@/lib/v2/use-url-filters'
import {
  CONTENT_TYPE_LABELS,
  SEO_CHECKLIST_FIELDS,
  SEO_CHECKLIST_LABELS,
  checklistDoneCount,
  improvementScoreOf,
  type OptimizationPayload,
  type OptimizationRow,
  type SeoChecklistField,
  type ThumbnailReview
} from '@/lib/v2/types'

const EMPTY: OptimizationPayload = { items: [] }
const isPayload = (data: unknown) => Array.isArray((data as { items?: unknown } | null)?.items)
const PAGE_STEP = 15
const RATING_HINT: Record<number, string> = { 1: '눈에 안 띄어요', 2: '아쉬워요', 3: '보통이에요', 4: '눈에 띄어요', 5: '클릭하고 싶어요' }
const LOAD_ERROR = '영상 점검 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'

// 주소(?view=todo&staff=…&format=…&sort=…&stock=…&video=…)와 같은 이름이라, 링크로 공유·북마크할 수 있다.
const FILTER_SPEC = {
  view: { default: 'todo', allowed: ['todo', 'done', 'all'] },
  staff: { default: '' },
  format: { default: '', allowed: ['', 'longform', 'shortform'] },
  sort: { default: 'impact', allowed: ['impact', 'views', 'recent'] },
  stock: { default: '', transient: true },
  video: { default: '', pattern: /^[0-9a-f-]{1,40}$/i, transient: true }
} as const satisfies FilterSpec

const SORT_LABELS: Record<SortKey, string> = { impact: '영향 큰 순', views: '조회수 많은 순', recent: '최근 순' }
const VIEW_LABELS = { todo: '고칠 영상', done: '완료한 영상', all: '전체' } as const

function normalize(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

function StarPicker({ value, onPick, disabled }: { value: number; onPick?: (rating: number) => void; disabled?: boolean }) {
  return (
    <span className="v2-stars" role={onPick ? 'radiogroup' : undefined} aria-label="썸네일 별점">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`v2-star ${n <= value ? 'filled' : ''}`}
          data-active={n === value ? 'true' : undefined}
          disabled={disabled || !onPick}
          onClick={() => onPick?.(n)}
          role={onPick ? 'radio' : undefined}
          aria-checked={onPick ? n === value : undefined}
          aria-label={`${n}점`}
          title={RATING_HINT[n]}
        >
          ★
        </button>
      ))}
    </span>
  )
}

function OptimizationBody() {
  const me = useV2Me()
  const { toast, showError, showSuccess } = useToast()
  const query = useV2Query<OptimizationPayload>('/api/v2/optimization', { fallback: LOAD_ERROR, validate: isPayload })
  const payload = query.data ?? EMPTY
  const loaded = !query.loading
  const loadError = query.error
  const { filters, setFilters, reset, shareHref } = useUrlFilters('optimization', FILTER_SPEC)
  const view = filters.view as 'todo' | 'done' | 'all'
  const sort = filters.sort as SortKey
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftRating, setDraftRating] = useState(3)
  const [draftNote, setDraftNote] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingChecks, setPendingChecks] = useState<Set<string>>(() => new Set())
  const [visible, setVisible] = useState(PAGE_STEP)
  const formRef = useRef<HTMLFormElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 저장 버튼을 빠르게 두 번 눌러도 한 번만 보내도록 상태보다 먼저 바뀌는 표시를 함께 둔다.
  const savingRef = useRef(false)
  const pendingRef = useRef<Set<string>>(new Set())

  // 별점 입력이 열리면 현재 별점 버튼으로 바로 포커스를 옮긴다.
  useEffect(() => {
    if (!openId) return
    formRef.current?.querySelector<HTMLButtonElement>('.v2-star[data-active="true"]')?.focus()
  }, [openId])

  const owners = useMemo(() => {
    const set = new Set<string>()
    for (const row of payload.items) if (row.video.owner_name) set.add(row.video.owner_name)
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [payload.items])

  // 담당자 이름은 관리자에게만 내려온다. 직원 화면에서는 담당자 필터를 쓰지 않는다.
  const staffNow = me.isAdmin ? filters.staff : ''
  const stockKey = normalize(filters.stock)
  const scoped = useMemo(
    () =>
      payload.items.filter(
        (row) =>
          (!staffNow || row.video.owner_name === staffNow) &&
          (!filters.format || row.video.content_type === filters.format) &&
          (!filters.video || row.video.id === filters.video) &&
          (!stockKey || normalize(row.video.stock_name || '').includes(stockKey))
      ),
    [payload.items, staffNow, filters.format, filters.video, stockKey]
  )
  const todo = useMemo(() => scoped.filter((row) => workStateOf(row) === 'todo'), [scoped])
  const finished = useMemo(() => scoped.filter((row) => workStateOf(row) === 'done'), [scoped])
  const progress = useMemo(() => progressOf(scoped), [scoped])
  // 카드 위 숫자 세 개. 메모를 한 글자 칠 때마다 다시 세지 않도록 묶어서 기억해 둔다.
  const { urgent, noStock, noReview } = useMemo(() => {
    let urgentCount = 0
    let noStockCount = 0
    let noReviewCount = 0
    for (const row of scoped) {
      const left = remainingFixes(row)
      if (workStateOf(row) === 'todo' && left.length >= 3) urgentCount += 1
      if (left.some((f) => f.key === 'no-stock')) noStockCount += 1
      if (left.some((f) => f.key === 'thumb-missing')) noReviewCount += 1
    }
    return { urgent: urgentCount, noStock: noStockCount, noReview: noReviewCount }
  }, [scoped])
  const list = useMemo(() => sortRows(view === 'todo' ? todo : view === 'done' ? finished : scoped, sort), [view, todo, finished, scoped, sort])
  const shown = list.slice(0, visible)
  const top = useMemo(() => sortRows(todo, 'impact')[0], [todo])
  const topAction = top ? nextActionOf(top) : null

  const chips: FilterChip[] = []
  if (me.isAdmin && filters.staff) chips.push({ key: 'staff', label: `담당자: ${filters.staff}`, onClear: () => pick({ staff: '' }) })
  if (filters.format) chips.push({ key: 'format', label: `형식: ${CONTENT_TYPE_LABELS[filters.format as 'longform' | 'shortform'] ?? filters.format}`, onClear: () => pick({ format: '' }) })
  if (filters.stock) chips.push({ key: 'stock', label: `종목: ${filters.stock}`, onClear: () => pick({ stock: '' }) })
  if (filters.video) chips.push({ key: 'video', label: '영상 1개만 보는 중', onClear: () => pick({ video: '' }) })
  if (sort !== 'impact') chips.push({ key: 'sort', label: `정렬: ${SORT_LABELS[sort]}`, onClear: () => pick({ sort: 'impact' }) })

  function pick(patch: Partial<Record<keyof typeof FILTER_SPEC, string>>) {
    setFilters(patch)
    setVisible(PAGE_STEP)
  }

  const resetAll = () => {
    reset()
    setVisible(PAGE_STEP)
  }

  const patchRow = (videoId: string, fn: (row: OptimizationRow) => OptimizationRow) => {
    query.setData((prev) => ({ ...prev, items: prev.items.map((row) => (row.video.id === videoId ? fn(row) : row)) }))
  }

  const openReview = (row: OptimizationRow) => {
    setOpenId(row.video.id)
    setDraftRating(row.latestReview?.rating || 3)
    setDraftNote('')
    setFormError('')
  }

  const closeReview = () => {
    setOpenId(null)
    setFormError('')
  }

  const submitReview = async (row: OptimizationRow) => {
    if (saving || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setFormError('')
    const res = await v2Post<{ ok?: boolean; item?: ThumbnailReview }>(
      '/api/v2/thumbnail-reviews',
      { videoId: row.video.id, rating: draftRating, note: draftNote.trim() || null },
      '썸네일 평가를 저장하지 못했어요. 다시 시도해 주세요.'
    )
    savingRef.current = false
    setSaving(false)
    query.noteStatus(res.status)
    if (!res.ok || !res.data.item) {
      setFormError(res.error || '썸네일 평가를 저장하지 못했어요. 다시 시도해 주세요.')
      return
    }
    const item = res.data.item
    // 목록을 다시 불러오지 않고 그 자리에서 바로 바꾼다 (화면이 움직이지 않도록).
    patchRow(row.video.id, (r) => ({ ...r, latestReview: item, improvementScore: improvementScoreOf({ ...r, latestReview: item }) }))
    closeReview()
  }

  const deleteReview = async (row: OptimizationRow) => {
    const review = row.latestReview
    if (!review || deletingId) return
    setDeletingId(review.id)
    const res = await v2Delete(`/api/v2/thumbnail-reviews?id=${encodeURIComponent(review.id)}`, '평가를 지우지 못했어요. 다시 시도해 주세요.')
    setDeletingId(null)
    query.noteStatus(res.status)
    if (!res.ok) {
      showError(res.error)
      return
    }
    // 이전에 남긴 평가가 있으면 그것이 다시 최신이 되므로 서버 값으로 맞춘다.
    query.reload()
  }

  // "고쳤어요" 체크: 누르면 바로 바뀌고(목록도 바로 줄어든다), 저장에 실패하면 원래대로 되돌린다.
  // 저장 위치는 기존 SEO 체크리스트 칸(seo-checklists)이라 영상 등록 화면의 체크와 같은 값이다.
  const toggleCheck = async (row: OptimizationRow, field: SeoChecklistField) => {
    const key = `${row.video.id}:${field}`
    if (pendingChecks.has(key) || pendingRef.current.has(key)) return
    pendingRef.current.add(key)
    const next = !row.checklist[field]
    const before = workStateOf(row)
    patchRow(row.video.id, (r) => ({ ...r, checklist: { ...r.checklist, [field]: next } }))
    const after = workStateOf({ ...row, checklist: { ...row.checklist, [field]: next } })
    setPendingChecks((prev) => new Set(prev).add(key))
    if (before !== after && view !== 'all') {
      // 목록에서 카드가 사라지므로 안내하고, 키보드 사용자가 자리를 잃지 않게 목록으로 포커스를 옮긴다.
      showSuccess(after === 'done' ? '고쳤어요로 표시했어요. ‘완료’ 탭으로 옮겼어요.' : '다시 ‘고칠 영상’으로 돌려놨어요.')
      window.requestAnimationFrame(() => listRef.current?.focus())
    }
    const res = await v2Patch('/api/v2/seo-checklists', { videoId: row.video.id, patch: { [field]: next } }, '체크리스트를 저장하지 못했어요. 다시 시도해 주세요.')
    query.noteStatus(res.status)
    pendingRef.current.delete(key)
    setPendingChecks((prev) => {
      const copy = new Set(prev)
      copy.delete(key)
      return copy
    })
    if (!res.ok) {
      patchRow(row.video.id, (r) => ({ ...r, checklist: { ...r.checklist, [field]: !next } }))
      showError(res.error)
    }
  }

  const renderCheck = (row: OptimizationRow, fix: Fix) => {
    if (!fix.field) return null
    const pending = pendingChecks.has(`${row.video.id}:${fix.field}`)
    return (
      <label className={`v2a-done-check ${fix.done ? 'on' : ''} ${pending ? 'pending' : ''}`}>
        <input type="checkbox" checked={fix.done} disabled={pending} onChange={() => void toggleCheck(row, fix.field as SeoChecklistField)} />
        {fix.done ? '고쳤어요 (눌러서 취소)' : '고쳤어요'}
      </label>
    )
  }

  const csvTable = () => ({
    name: `영상 점검 ${VIEW_LABELS[view]}`,
    headers: ['제목', '종목', '형식', '담당자', '발행일', '조회수', '남은 고칠 점', '먼저 할 일', '상태', '유튜브 주소', '스튜디오 수정 주소'],
    rows: list.map((row): CsvValue[] => {
      const state = workStateOf(row)
      return [
        row.video.title || '',
        row.video.stock_name,
        CONTENT_TYPE_LABELS[row.video.content_type] ?? row.video.content_type,
        row.video.owner_name || '',
        formatKstDate(row.video.published_at),
        row.video.view_count,
        remainingFixes(row).length,
        nextActionOf(row)?.action || '',
        state === 'ok' ? '문제 없음' : state === 'done' ? '고쳤어요' : '고칠 영상',
        row.video.youtube_url || '',
        studioEditUrl(row.video.youtube_url) || ''
      ]
    })
  })

  const who = me.isAdmin ? '전체 영상' : '내 영상'
  const filtering = chips.length > 0

  return (
    <>
      <PageHeader title="영상 점검" subtitle="제목·설명·썸네일이 검색에 잘 걸리는지 확인하고, 영상마다 지금 가장 먼저 할 일을 알려 드려요." />
      <Toast toast={toast} />
      {(loaded && loadError) || query.expired ? <LoadError message={loadError} expired={query.expired} onRetry={query.reload} /> : null}
      <RefreshNote show={query.refreshing} />

      {!loaded ? (
        <>
          <SkeletonSummary />
          <div className="panel">
            <SkeletonList rows={4} />
          </div>
        </>
      ) : payload.items.length === 0 ? (
        loadError ? null : (
          <EmptyGuide title={me.isAdmin ? '점검할 영상이 아직 없어요' : '아직 등록한 영상이 없어요'} href="/v2/register" action="영상 등록하러 가기">
            영상이 있어야 점검할 수 있어요. 유튜브 주소와 종목을 등록하면 이 화면에서 제목·설명·썸네일을 자동으로 점검하고, 고칠 곳을 알려 드려요.
          </EmptyGuide>
        )
      ) : (
        <>
          <Answer tone={todo.length === 0 ? 'good' : urgent > 0 ? 'bad' : 'neutral'}>
            {progress.total === 0 ? (
              <>{filtering ? '이 조건의 영상' : who} {scoped.length.toLocaleString('ko-KR')}개 모두 점검을 통과했어요. 새 영상을 등록하면 여기서 다시 확인할 수 있어요.</>
            ) : todo.length === 0 ? (
              <>고칠 영상 {progress.total.toLocaleString('ko-KR')}개를 모두 끝냈어요. 새 영상을 등록하면 다시 점검해 드려요.</>
            ) : (
              <>
                지금 고칠 영상이 <b>{todo.length.toLocaleString('ko-KR')}개</b> 있어요. 가장 먼저 할 일은 「{shortText(top?.video.title)}」에서 {topAction ? `‘${topAction.action}’` : '확인하기'}예요.
              </>
            )}
          </Answer>

          <ProgressBar done={progress.done} total={progress.total} label="완료" />

          <KpiRow>
            <Kpi label="먼저 고칠 영상" value={urgent.toLocaleString('ko-KR')} unit="개" tone={urgent > 0 ? 'bad' : 'good'} hint="남은 고칠 곳이 3가지 이상인 영상 수예요." />
            <Kpi label="제목에 종목명이 없는 영상" value={noStock.toLocaleString('ko-KR')} unit="개" tone={noStock > 0 ? 'warn' : 'good'} hint="제목에 종목명이 있어야 검색할 때 잘 나와요." />
            <Kpi label={<><Term k="thumb">썸네일 평가</Term>를 기다리는 영상</>} value={noReview.toLocaleString('ko-KR')} unit="개" tone={noReview > 0 ? 'warn' : 'good'} hint="별점을 아직 남기지 않은 영상 수예요." />
          </KpiRow>

          <div className="panel">
            <div className="v2a-toolbar">
              <div className="v2-seg" role="tablist" aria-label="보기">
                <button role="tab" aria-selected={view === 'todo'} className={view === 'todo' ? 'active' : ''} onClick={() => pick({ view: 'todo' })}>
                  고칠 영상 {todo.length}
                </button>
                <button role="tab" aria-selected={view === 'done'} className={view === 'done' ? 'active' : ''} onClick={() => pick({ view: 'done' })}>
                  완료 {finished.length}
                </button>
                <button role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'active' : ''} onClick={() => pick({ view: 'all' })}>
                  전체 {scoped.length}
                </button>
              </div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                {me.isAdmin && owners.length > 1 ? (
                  <div className="row" style={{ gap: 8 }}>
                    <label className="small muted" htmlFor="opt-owner">
                      담당자
                    </label>
                    <select id="opt-owner" className="select compact" value={owners.includes(filters.staff) ? filters.staff : ''} onChange={(e) => pick({ staff: e.target.value })}>
                      <option value="">전체</option>
                      {owners.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" htmlFor="opt-format">
                    형식
                  </label>
                  <select id="opt-format" className="select compact" value={filters.format} onChange={(e) => pick({ format: e.target.value })}>
                    <option value="">전체</option>
                    <option value="longform">롱폼</option>
                    <option value="shortform">숏폼</option>
                  </select>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" htmlFor="opt-sort">
                    정렬
                  </label>
                  <select id="opt-sort" className="select compact" value={sort} onChange={(e) => pick({ sort: e.target.value })}>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                      <option key={key} value={key}>
                        {SORT_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <ActiveFilters chips={chips} onReset={resetAll} />
            <ShareBar getCsv={csvTable} csvDisabledReason={list.length === 0 ? '저장할 영상이 없어요' : undefined} getLink={shareHref} />

            {payload.capped ? <p className="v2a-note">가장 최근에 등록한 영상 위주로 보여 드려요. 더 오래된 영상은 이 목록에 나오지 않을 수 있어요.</p> : null}

            <div ref={listRef} tabIndex={-1} id="opt-list" style={{ outline: 'none' }} aria-label={`${VIEW_LABELS[view]} ${list.length}개`}>
              {list.length === 0 ? (
                scoped.length === 0 ? (
                  <EmptyGuide title="이 조건에 맞는 영상이 없어요" action={filtering ? '필터 초기화' : undefined} onAction={filtering ? resetAll : undefined}>
                    {filtering ? '담당자·형식·종목 조건을 바꾸거나 필터를 초기화하면 다시 보여요.' : '등록한 영상이 없어요.'}
                  </EmptyGuide>
                ) : view === 'todo' ? (
                  <EmptyGuide title={progress.total > 0 ? '고칠 영상을 모두 끝냈어요' : '점검을 통과했어요'} href="/v2/register" action="새 영상 등록하러 가기">
                    {progress.total > 0
                      ? '고쳤어요로 표시한 영상은 ‘완료’ 탭에서 다시 볼 수 있어요. 새 영상을 등록하면 이 화면에서 바로 점검해 드려요.'
                      : '이 조건의 영상은 제목·설명·썸네일이 모두 괜찮아요. 새 영상을 등록하면 이 화면에서 바로 점검해 드려요.'}
                  </EmptyGuide>
                ) : view === 'done' ? (
                  <EmptyGuide title="아직 고쳤어요로 표시한 영상이 없어요" action="고칠 영상 보기" onAction={() => pick({ view: 'todo' })}>
                    ‘고칠 영상’에서 하나를 골라 유튜브에서 고친 뒤 ‘고쳤어요’를 누르면 여기로 옮겨져요.
                  </EmptyGuide>
                ) : null
              ) : (
                <div className="list">
                  {shown.map((row) => {
                    const done = checklistDoneCount(row.checklist)
                    const fixes = fixesOf(row)
                    const remaining = fixes.filter((f) => !f.done)
                    const state = workStateOf(row)
                    const next = remaining[0] ?? null
                    const others = fixes.filter((f) => f !== next)
                    const isOpen = openId === row.video.id
                    const review = row.latestReview
                    const canDeleteReview = Boolean(review && (me.isAdmin || review.reviewed_by === me.crmUserId))
                    return (
                      <div className="list-item" key={row.video.id}>
                        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="v2-card-title">
                              <span className="v2a-clamp2" title={row.video.title || ''}>
                                {row.video.youtube_url ? (
                                  <a href={row.video.youtube_url} target="_blank" rel="noreferrer noopener">
                                    {row.video.title || '(제목 수집 대기)'}
                                  </a>
                                ) : (
                                  row.video.title || '(제목 수집 대기)'
                                )}
                              </span>
                              <ContentTypeTag contentType={row.video.content_type} />
                            </div>
                            <div className="v2-card-meta" style={{ marginTop: 6 }}>
                              <span>{row.video.stock_name}</span>
                              {me.isAdmin && row.video.owner_name ? <span>담당 {row.video.owner_name}</span> : null}
                              <span>
                                발행 <Stamp iso={row.video.published_at} />
                              </span>
                              <span title={row.video.view_count == null ? '아직 조회수를 가져오지 못했어요' : `${formatExact(row.video.view_count)}회`}>
                                조회 {row.video.view_count == null ? '-' : `${formatCountOrDash(row.video.view_count)}회`}
                              </span>
                            </div>
                          </div>
                          <span className={`pill ${state !== 'todo' ? 'success' : remaining.length >= 3 ? 'danger' : 'warning'}`} style={{ flex: 'none' }}>
                            {state === 'ok' ? '✓ 문제 없음' : state === 'done' ? '✓ 모두 고쳤어요' : `${remaining.length >= 3 ? '▼ ' : ''}고칠 곳 ${remaining.length}개`}
                          </span>
                        </div>

                        {state === 'ok' ? (
                          <div className="v2a-reasons" style={{ marginTop: 10 }}>
                            <span className="v2a-reason ok">제목·설명·썸네일 모두 괜찮아요</span>
                          </div>
                        ) : null}

                        {next ? (
                          <div className={`v2a-todo ${next.bad ? 'bad' : ''}`}>
                            <div className="v2a-todo-label">먼저 할 일</div>
                            <div className="v2a-todo-problem">{next.problem}</div>
                            <p className="v2a-todo-action">→ {next.action}</p>
                            <div className="v2a-todo-buttons">
                              <StudioLink youtubeUrl={row.video.youtube_url} />
                              {renderCheck(row, next)}
                            </div>
                            {!next.field ? <p className="v2a-todo-note">유튜브에서 고친 뒤 영상 정보가 새로 반영되면 이 목록에서 저절로 사라져요.</p> : null}
                          </div>
                        ) : null}

                        {state === 'done' ? (
                          <div className="v2a-todo done">
                            <div className="v2a-todo-label">완료</div>
                            <p className="v2a-todo-action">고칠 점을 모두 고쳤어요. 잘하셨어요!</p>
                          </div>
                        ) : null}

                        {others.length > 0 ? (
                          <details className="v2a-more-fixes">
                            <summary>{state === 'done' ? `고친 내용 ${others.length + (next ? 1 : 0)}개 보기` : `그 밖에 할 일 ${others.length}개 보기`}</summary>
                            <ul className="v2a-fix-list">
                              {others.map((fix) => (
                                <li key={fix.key} className={fix.done ? 'done' : ''}>
                                  <span className="v2a-fix-text">
                                    {fix.action}
                                    <small>{fix.problem}</small>
                                  </span>
                                  {renderCheck(row, fix)}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}

                        <div className="row-between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
                          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                            <span className="small muted">
                              <Term k="thumb">썸네일 평가</Term>
                            </span>
                            {review ? (
                              <>
                                <StarPicker value={review.rating} disabled />
                                {review.note ? <span className="small muted">“{review.note}”</span> : null}
                              </>
                            ) : (
                              <span className="small muted">아직 없어요</span>
                            )}
                          </div>
                          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                            {canDeleteReview && !isOpen ? (
                              <InlineConfirm label="평가 지우기" prompt="이 평가를 지울까요?" confirmLabel="지우기" busyLabel="지우는 중…" busy={deletingId === review?.id} onConfirm={() => void deleteReview(row)} />
                            ) : null}
                            <button className="button secondary xs" onClick={() => (isOpen ? closeReview() : openReview(row))}>
                              {isOpen ? '닫기' : review ? '다시 평가하기' : '썸네일 평가하기'}
                            </button>
                          </div>
                        </div>

                        {isOpen ? (
                          <form
                            ref={formRef}
                            className="v2-card-form"
                            style={{ marginTop: 10 }}
                            noValidate
                            onSubmit={(e) => {
                              e.preventDefault()
                              void submitReview(row)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                closeReview()
                                return
                              }
                              // 숫자 1~5 를 누르면 별점 선택 (입력칸에서 글을 쓰는 중에는 제외)
                              if (/^[1-5]$/.test(e.key) && (e.target as HTMLElement).tagName !== 'INPUT') setDraftRating(Number(e.key))
                            }}
                          >
                            <div className="field" style={{ gap: 6 }}>
                              <span className="label">이 썸네일, 눈에 띄나요?</span>
                              <div className="row" style={{ gap: 10 }}>
                                <StarPicker value={draftRating} onPick={setDraftRating} />
                                <span className="small muted">
                                  {draftRating}점 · {RATING_HINT[draftRating]}
                                </span>
                              </div>
                            </div>
                            <div className="field" style={{ gap: 6, marginTop: 10 }}>
                              <label className="label" htmlFor={`note-${row.video.id}`}>
                                메모 (선택)
                              </label>
                              <div className="row" style={{ gap: 8 }}>
                                <input
                                  id={`note-${row.video.id}`}
                                  className="input compact"
                                  style={{ flex: 1 }}
                                  maxLength={300}
                                  placeholder="예: 글자가 작아서 잘 안 보여요"
                                  value={draftNote}
                                  onChange={(e) => setDraftNote(e.target.value)}
                                />
                                <button className="button success xs" type="submit" disabled={saving}>
                                  {saving ? '저장 중…' : '저장'}
                                </button>
                                <button className="button secondary xs" type="button" disabled={saving} onClick={closeReview}>
                                  취소
                                </button>
                              </div>
                              <FieldError>{formError}</FieldError>
                            </div>
                          </form>
                        ) : null}

                        <details className="v2a-howto" style={{ marginTop: 8 }}>
                          <summary>
                            <Term k="check">검색 점검</Term> {done}/4
                          </summary>
                          <div className="v2a-howto-body">
                            <div className="v2a-checks">
                              {SEO_CHECKLIST_FIELDS.map((field) => {
                                const checked = Boolean(row.checklist[field])
                                const pending = pendingChecks.has(`${row.video.id}:${field}`)
                                return (
                                  <label key={field} className={`v2a-check ${checked ? 'on' : ''} ${pending ? 'pending' : ''}`}>
                                    <input type="checkbox" checked={checked} disabled={pending} onChange={() => void toggleCheck(row, field)} />
                                    {SEO_CHECKLIST_LABELS[field]}
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        </details>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <MoreButton shown={shown.length} total={list.length} step={PAGE_STEP} onMore={() => setVisible((v) => v + PAGE_STEP)} />

            <GlossaryDetails keys={['fixspot', 'check', 'thumb']} />
            <HowTo title="‘고칠 곳’과 순서는 어떻게 정하나요? (계산 방법 보기)">
              <p>아래 5가지를 하나씩 확인해서, 해당하는 것만큼 ‘고칠 곳’이 늘어나요.</p>
              <p>1) 제목이 비어 있음 · 2) 제목이 60자를 넘음 · 3) 제목에 종목명이 없음 · 4) 설명란이 비어 있음 · 5) 썸네일 평가가 없거나 3점 미만</p>
              <p>‘영향 큰 순’은 검색에 미치는 영향이 큰 문제부터예요. 종목명 없음 → 제목 없음 → 낮은 썸네일 → 빈 설명란 → 썸네일 평가 없음 → 긴 제목 순으로 보고, 같으면 조회수가 높은 영상을 먼저 보여 드려요.</p>
              <p>‘고쳤어요’는 영상 등록 화면과 같은 검색 점검 칸에 저장돼요(제목의 종목명, 설명란 목차, 썸네일 글자). 제목이 비었거나 너무 긴 경우는 유튜브에서 고친 뒤 정보가 새로 반영되면 저절로 사라져요.</p>
            </HowTo>
          </div>
        </>
      )}
    </>
  )
}

export default function OptimizationPage() {
  // 필터를 주소에서 읽기 때문에 Suspense 로 감싸야 한다 (Next.js 요구사항).
  return (
    <Suspense
      fallback={
        <>
          <SkeletonSummary />
        </>
      }
    >
      <OptimizationBody />
    </Suspense>
  )
}
