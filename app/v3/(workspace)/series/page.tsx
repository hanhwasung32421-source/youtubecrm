'use client'

import '../analysis.css'
import Link from 'next/link'
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { SampleBanner, Section, Tag } from '@/components/v3/ui'
import { useV3Me } from '@/components/v3/auth-guard'
import { v3Request } from '@/lib/v3/api-client'
import { ConfirmButton, FieldError, InlineEditor, Req } from '@/lib/v3/interact'
import { invalidateV3, useV3Data } from '@/lib/v3/use-v3-data'
import { useDebouncedField, useUrlFilters } from '@/lib/v3/use-filters'
import { SERIES_FILTERS, chipLabel, defaultFilters, optionsFor } from '@/lib/v3/filters'
import { formatCompactNumber, formatNumber, formatPct } from '@/lib/v3/format'
import { pctChange } from '@/lib/v3/engagement'
import { SAMPLE_STOCK_NAMES } from '@/lib/v3/sample-data'
import { lifecycleHref, viralHref } from '@/lib/v3/links'
import { matchesQuery, sortSeriesRows } from '@/lib/v3/sorting'
import { applyOrder, decodeOrder, findAddable, findDuplicateName, membersMatching, moveItem, orderKey, withMember, withRenamed, withoutMember, withoutSeries, restoreSeries } from '@/lib/v3/series-logic'
import { seriesCsv } from '@/lib/v3/table-rows'
import {
  AnswerCard,
  AnswerSkeleton,
  CardsSkeleton,
  EmptyBlock,
  ErrorBlock,
  HowTo,
  MoreButton,
  RefreshFailed,
  SectionSkeleton,
  Skel,
  SkeletonShell,
  describeChange,
  useShowMore,
  withLoginLink,
  type Tone
} from '../analysis-parts'
import { FilterBar, GlossaryHelp, ShareTools, Term, type FilterField } from '../analysis-tools'
import { CompareTable, type CompareRowData } from '../analysis-charts'

type FormatStat = { label: string; contentType: string; count: number; avgEngagementPct: number; avgVelocity: number; totalViews: number }

type SeriesRow = {
  id: string
  name: string
  stockName: string | null
  videoCount: number
  avgEngagementPct: number
  avgVelocity: number
  baselineEngagementPct: number
  baselineVelocity: number
  members: { id: string; title: string; publishedAt?: string | null }[]
  createdByName: string | null
  canEdit: boolean
}

type EligibleVideo = { id: string; title: string; stockName: string | null; contentType: string }
type MovableVideo = EligibleVideo & { seriesId: string; seriesName: string }

type FormatSeriesResponse = {
  sample: boolean
  formatStats: { longform: FormatStat; shortform: FormatStat }
  series: SeriesRow[]
  eligibleVideos: EligibleVideo[]
  movableVideos?: MovableVideo[]
  staffOptions?: { id: string; name: string }[]
}

// 형식(롱폼/숏폼) 비교 결과를 한 문장으로
function summarizeFormats(lf: FormatStat, sf: FormatStat): { tone: Tone; headline: string; detail?: string } | null {
  if (lf.count === 0 && sf.count === 0) return null
  if (lf.count === 0 || sf.count === 0) {
    const missing = lf.count === 0 ? '롱폼' : '숏폼'
    const have = lf.count === 0 ? sf : lf
    return {
      tone: 'neutral',
      headline: `아직 ${missing} 영상이 없어서 두 형식을 비교할 수 없어요.`,
      detail: `지금은 ${have.label} 영상 ${formatNumber(have.count)}개만 있어요. ${missing}도 몇 개 등록하면 어느 쪽이 반응이 좋은지 알려드려요.`
    }
  }
  const engDiff = pctChange(Math.max(lf.avgEngagementPct, sf.avgEngagementPct), Math.min(lf.avgEngagementPct, sf.avgEngagementPct))
  const velDiff = pctChange(Math.max(lf.avgVelocity, sf.avgVelocity), Math.min(lf.avgVelocity, sf.avgVelocity))
  const engWin = sf.avgEngagementPct > lf.avgEngagementPct ? sf : lf
  const velWin = sf.avgVelocity > lf.avgVelocity ? sf : lf
  const small = (engDiff ?? 0) < 5 && (velDiff ?? 0) < 5
  const fewNote = lf.count < 5 || sf.count < 5 ? `영상 수가 적어서(롱폼 ${lf.count}개, 숏폼 ${sf.count}개) 참고용으로만 봐 주세요.` : undefined

  if (small) return { tone: 'neutral', headline: '롱폼과 숏폼의 차이가 크지 않아요. 지금은 어느 쪽이 더 좋다고 말하기 어려워요.', detail: fewNote }
  if (engWin === velWin) {
    return { tone: 'good', headline: `${engWin.label}이 반응(참여율)도, 조회수가 늘어나는 속도도 더 좋아요.`, detail: fewNote }
  }
  return {
    tone: 'neutral',
    headline: `시청자 반응(참여율)은 ${engWin.label}이, 조회수가 늘어나는 속도는 ${velWin.label}이 더 좋아요.`,
    detail: fewNote
  }
}

// 시리즈가 같은 종목의 시리즈 밖 영상보다 나은지 판정
function seriesVerdict(s: SeriesRow, engChange: number | null, velChange: number | null): { tone: 'green' | 'red' | 'gray'; label: string } {
  if (s.videoCount === 0) return { tone: 'gray', label: '영상 없음' }
  if (engChange === null && velChange === null) return { tone: 'gray', label: '비교할 기준 영상 없음' }
  const e = engChange ?? 0
  const v = velChange ?? 0
  if (e >= 5 && v >= 5) return { tone: 'green', label: '시리즈 효과 있음' }
  if (e <= -5 && v <= -5) return { tone: 'red', label: '일반 영상보다 반응이 낮음' }
  return { tone: 'gray', label: '결과가 엇갈려요' }
}

const HEADER_PROPS = { icon: '🧩', title: '롱폼·숏폼·시리즈 비교', subtitle: '어떤 형식과 시리즈가 반응을 더 잘 얻는지 비교합니다.' }

// 회차 순서는 DB 에 자리가 없어서 이 브라우저에만 기억한다.
function readOrder(seriesId: string): string[] | null {
  try {
    return decodeOrder(window.localStorage.getItem(orderKey(seriesId)))
  } catch {
    return null
  }
}

function writeOrder(seriesId: string, ids: string[]) {
  try {
    window.localStorage.setItem(orderKey(seriesId), JSON.stringify(ids))
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 바뀐다.
  }
}

// useSearchParams 는 Suspense 안에서만 쓸 수 있다(Next 16).
export default function SeriesPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader {...HEADER_PROPS} />
          <SkeletonShell label="비교 결과를 불러오는 중이에요…">
            <AnswerSkeleton />
          </SkeletonShell>
        </>
      }
    >
      <SeriesView />
    </Suspense>
  )
}

function SeriesView() {
  const me = useV3Me()
  const { toast, showSuccess, showError } = useToast()
  const f = useUrlFilters('series', SERIES_FILTERS)
  const { filters, set: setFilter } = f
  const isAdmin = !!me?.isAdmin

  const apiUrl = useMemo(() => {
    if (!f.ready) return null
    const q = new URLSearchParams()
    if (isAdmin && filters.staff) q.set('staffId', filters.staff)
    if (filters.period !== 'all') q.set('days', filters.period)
    const s = q.toString()
    return `/api/v3/format-series${s ? `?${s}` : ''}`
  }, [f.ready, isAdmin, filters.staff, filters.period])

  const res = useV3Data<FormatSeriesResponse>(apiUrl, { scope: me?.crmUserId, fallback: '비교 결과를 불러오지 못했어요.' })
  const { data, reload, mutate } = res
  // 버튼을 빠르게 두 번 눌러도 저장이 한 번만 나가게 하는 즉시 잠금
  const lock = useRef(false)
  const [queryInput, setQueryInput] = useDebouncedField(filters.q, (q) => setFilter({ q }))

  // 새 시리즈 폼
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [name, setName] = useState('')
  const [stockName, setStockName] = useState('')
  const [videoQuery, setVideoQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // 카드별 작업
  const [adderOpen, setAdderOpen] = useState<Record<string, boolean>>({})
  const [adderQuery, setAdderQuery] = useState<Record<string, string>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  const [openMembers, setOpenMembers] = useState<Record<string, boolean>>({})
  // 회차 순서(이 브라우저에만 저장). 캐시에서 읽고, 바꾸면 화면을 다시 그리도록 tick 을 올린다.
  const orderCache = useRef(new Map<string, string[] | null>())
  const [, setOrderTick] = useState(0)
  const [orderNote, setOrderNote] = useState('')

  const setCardError = (id: string, message: string | null) =>
    setCardErrors((prev) => {
      const next = { ...prev }
      if (message) next[id] = message
      else delete next[id]
      return next
    })

  // 저장/수정/삭제 뒤에는 저장해 둔 옛 값을 버리고 서버의 최신 값을 다시 받는다.
  const refresh = async () => {
    invalidateV3('/api/v3/format-series')
    await reload(true)
  }

  useEffect(() => {
    if (showForm) nameRef.current?.focus()
  }, [showForm])

  // 저장해 둔 직원이 더는 목록에 없거나, 직원이 아닌 사람이 직원 필터를 들고 오면 전체 팀으로 되돌린다.
  useEffect(() => {
    if (!data || !me || !filters.staff) return
    if (!isAdmin || (data.staffOptions && !data.staffOptions.some((s) => s.id === filters.staff))) setFilter({ staff: '' })
  }, [data, me, isAdmin, filters.staff, setFilter])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const dupOfNew = data && name.trim() ? findDuplicateName(name, data.series) : null
  const nameError = attempted && !name.trim() ? '시리즈 이름을 입력해 주세요. 예: 삼성전자 실적 브리핑 시리즈' : dupOfNew ? `“${dupOfNew.name}” 시리즈가 이미 있어요. 다른 이름을 쓰거나, 기존 시리즈에 영상을 추가해 주세요.` : null

  const closeForm = () => {
    setShowForm(false)
    setAttempted(false)
    setFormError(null)
  }

  // 종목을 입력했다면 그 종목 영상이 위로 오도록, 검색어가 있으면 걸러서 보여준다.
  const pickable = useMemo(() => {
    const q = videoQuery.trim().toLowerCase()
    const stock = stockName.trim()
    let items = data?.eligibleVideos || []
    if (q) items = items.filter((v) => v.title.toLowerCase().includes(q) || (v.stockName || '').toLowerCase().includes(q))
    if (stock) items = [...items].sort((a, b) => Number(b.stockName === stock) - Number(a.stockName === stock))
    return items
  }, [data, videoQuery, stockName])
  const pickMore = useShowMore(pickable, 8, 10)

  // 시리즈 목록: 검색 → 정렬
  const visibleSeries = useMemo(() => {
    const list = (data?.series || []).filter((s) => matchesQuery(filters.q, s.name, s.stockName) || s.members.some((m) => matchesQuery(filters.q, m.title)))
    return sortSeriesRows(list, filters.sort)
  }, [data, filters.q, filters.sort])
  const seriesMore = useShowMore(visibleSeries, 5, 10)

  const staffOptions = data?.staffOptions || []
  const fields: FilterField[] = [
    ...(isAdmin && staffOptions.length > 0
      ? [{ key: 'staff', label: '비교할 직원', options: [{ value: '', label: '전체 팀' }, ...staffOptions.map((s) => ({ value: s.id, label: s.name }))] }]
      : []),
    { key: 'period', label: '롱폼·숏폼 비교 기간', options: optionsFor('series', SERIES_FILTERS, 'period') },
    { key: 'sort', label: '시리즈 정렬', options: optionsFor('series', SERIES_FILTERS, 'sort') }
  ]
  const chips = f.chips((key, value) => chipLabel('series', key, value, (id) => staffOptions.find((s) => s.id === id)?.name || null))
  const filtered = chips.some((c) => c.key === 'staff' || c.key === 'period')

  const resetAll = () => {
    f.reset()
    setQueryInput('')
  }

  const filterBar = (
    <FilterBar fields={fields} filters={filters} defaults={defaultFilters(SERIES_FILTERS)} chips={chips} onChange={(key, value) => f.set({ [key]: value })} onReset={resetAll}>
      <ShareTools
        getLink={() => f.shareUrl()}
        csv={{ baseName: '시리즈 비교', rowCount: visibleSeries.length, build: () => seriesCsv(visibleSeries) }}
        notify={{ success: showSuccess, error: showError }}
      />
    </FilterBar>
  )

  const header = <PageHeader {...HEADER_PROPS} />

  if (!data) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        <div style={{ marginBottom: 16 }}>{filterBar}</div>
        {res.error ? (
          <ErrorBlock message={res.error} status={res.status} onRetry={() => void reload(true)} />
        ) : (
          <SkeletonShell label="비교 결과를 불러오는 중이에요…">
            <AnswerSkeleton />
            <SectionSkeleton titleWidth={150}>
              <div className="v3-chart-card" aria-hidden>
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '38% 1fr 1fr', gap: 16, padding: '8px 0' }}>
                    <Skel h={14} w="70%" />
                    <Skel h={14} w="50%" />
                    <Skel h={14} w="50%" />
                  </div>
                ))}
              </div>
            </SectionSkeleton>
            <SectionSkeleton titleWidth={90}>
              <CardsSkeleton count={2} />
            </SectionSkeleton>
          </SkeletonShell>
        )}
      </>
    )
  }

  // ── 저장 동작(모두 화면 먼저 바꾸고, 실패하면 되돌린다) ─────────────────
  const createSeries = async (e?: FormEvent) => {
    e?.preventDefault()
    if (creating || lock.current) return
    setAttempted(true)
    setFormError(null)
    if (!name.trim()) {
      nameRef.current?.focus()
      return
    }
    if (dupOfNew) {
      nameRef.current?.focus()
      return
    }
    lock.current = true
    setCreating(true)
    const created = name.trim()
    const out = await v3Request<{ moved?: number }>(
      '/api/v3/series',
      { method: 'POST', body: { name: created, stockName: stockName.trim() || undefined, videoIds: selectedIds } },
      '시리즈를 만들지 못했어요.'
    )
    lock.current = false
    setCreating(false)
    if (!out.ok) {
      setFormError(out.error)
      showError(out.error || '시리즈를 만들지 못했어요.')
      nameRef.current?.focus()
      return
    }
    const movedText = out.data?.moved ? ` 다른 시리즈에서 영상 ${out.data.moved}개를 옮겨 왔어요.` : ''
    showSuccess(`“${created}” 시리즈를 만들었어요.${selectedIds.length > 0 ? ` 영상 ${selectedIds.length}개를 묶었어요.` : ''}${movedText}`)
    setName('')
    setStockName('')
    setSelectedIds([])
    setVideoQuery('')
    setAttempted(false)
    await refresh()
    nameRef.current?.focus()
  }

  const addToSeries = async (s: SeriesRow, video: { id: string; title: string; moveFromSeriesName?: string | null }) => {
    if (busyKey || lock.current) return
    // 이미 들어 있는 영상이면 서버에 보내지 않는다.
    if (s.members.some((m) => m.id === video.id)) {
      showError(`“${video.title}”은(는) 이미 이 시리즈에 있어요.`)
      return
    }
    lock.current = true
    setBusyKey(`add:${s.id}`)
    setCardError(s.id, null)
    const before = { series: data.series, eligible: data.eligibleVideos, movable: data.movableVideos }
    mutate((prev) => ({
      ...prev,
      series: withMember(prev.series, s.id, { id: video.id, title: video.title }),
      eligibleVideos: prev.eligibleVideos.filter((v) => v.id !== video.id),
      movableVideos: (prev.movableVideos || []).filter((v) => v.id !== video.id)
    }))
    setOpenMembers((prev) => ({ ...prev, [s.id]: true }))
    const out = await v3Request<{ moved?: boolean; already?: boolean; fromSeriesName?: string }>(
      `/api/v3/series/${s.id}/members`,
      { method: 'POST', body: { videoId: video.id } },
      '영상을 추가하지 못했어요.'
    )
    lock.current = false
    setBusyKey(null)
    if (!out.ok) {
      mutate((prev) => ({ ...prev, series: before.series, eligibleVideos: before.eligible, movableVideos: before.movable }))
      setCardError(s.id, out.error)
      showError(`“${video.title}”을(를) 추가하지 못했어요. ${out.error || ''}`.trim())
      return
    }
    if (out.data?.already) showSuccess(`“${video.title}”은(는) 이미 이 시리즈에 있었어요.`)
    else if (out.data?.moved) showSuccess(`“${video.title}”을(를) “${out.data.fromSeriesName || video.moveFromSeriesName || '다른 시리즈'}”에서 “${s.name}”(으)로 옮겼어요.`)
    else showSuccess(`“${video.title}”을(를) “${s.name}”에 추가했어요.`)
    setAdderQuery((prev) => ({ ...prev, [s.id]: '' }))
    // 화면은 이미 바뀌어 있으니 뒤에서 조용히 최신 값으로 맞춘다.
    void refresh()
  }

  const removeMember = async (s: SeriesRow, member: { id: string; title: string }) => {
    if (busyKey || lock.current) return
    lock.current = true
    setBusyKey(`rm:${s.id}:${member.id}`)
    setCardError(s.id, null)
    const before = { series: data.series, eligible: data.eligibleVideos }
    // 먼저 화면에서 빼고, 실패하면 되돌린다. 뺀 영상은 다시 추가할 수 있게 후보에도 넣어 둔다.
    mutate((prev) => ({
      ...prev,
      series: withoutMember(prev.series, s.id, member.id),
      eligibleVideos: prev.eligibleVideos.some((v) => v.id === member.id) ? prev.eligibleVideos : [{ id: member.id, title: member.title, stockName: s.stockName, contentType: '' }, ...prev.eligibleVideos]
    }))
    const out = await v3Request(`/api/v3/series/${s.id}/members`, { method: 'DELETE', body: { videoId: member.id } }, '영상을 빼지 못했어요.')
    lock.current = false
    setBusyKey(null)
    if (!out.ok) {
      mutate((prev) => ({ ...prev, series: before.series, eligibleVideos: before.eligible }))
      setCardError(s.id, out.error)
      showError(`“${member.title}”을(를) 빼지 못했어요. ${out.error || ''}`.trim())
      return
    }
    showSuccess(`“${member.title}”을(를) “${s.name}”에서 뺐어요. 영상은 그대로 남아 있어요.`)
    void refresh()
  }

  const renameSeries = async (s: SeriesRow, value: string) => {
    if (value === s.name) {
      setRenamingId(null)
      setRenameDraft(null)
      return
    }
    // 같은 이름은 서버가 막지만, 저장을 기다리지 않고 바로 알려 준다.
    const clash = findDuplicateName(value, data.series, s.id)
    if (clash) {
      setRenameError('같은 이름의 시리즈가 이미 있어요. 다른 이름을 써 주세요.')
      return
    }
    if (lock.current) return
    lock.current = true
    setRenameError(null)
    const before = data.series
    const oldName = s.name
    mutate((prev) => ({ ...prev, series: withRenamed(prev.series, s.id, value) }))
    setRenamingId(null)
    setRenameDraft(null)
    const out = await v3Request(`/api/v3/series/${s.id}`, { method: 'PATCH', body: { name: value } }, '이름을 바꾸지 못했어요.')
    lock.current = false
    if (!out.ok) {
      mutate((prev) => ({ ...prev, series: before }))
      // 입력했던 이름을 그대로 두고 편집 칸을 다시 열어 준다.
      setRenamingId(s.id)
      setRenameDraft(value)
      setRenameError(out.error)
      showError(`이름을 바꾸지 못했어요. “${oldName}” 그대로예요. ${out.error || ''}`.trim())
      return
    }
    showSuccess(`시리즈 이름을 “${value}”(으)로 바꿨어요.`)
    void refresh()
  }

  const deleteSeries = async (s: SeriesRow) => {
    if (lock.current) return
    lock.current = true
    setBusyKey(`del:${s.id}`)
    setCardError(s.id, null)
    const removed = withoutSeries(data.series, s.id)
    mutate((prev) => ({ ...prev, series: withoutSeries(prev.series, s.id).list }))
    const out = await v3Request(`/api/v3/series/${s.id}`, { method: 'DELETE' }, '시리즈를 삭제하지 못했어요.')
    lock.current = false
    setBusyKey(null)
    // 이미 지워진 시리즈(404)도 목록에서는 사라져야 하므로 성공처럼 다룬다.
    if (!out.ok && out.status !== 404) {
      if (removed.removed) {
        const back = removed.removed
        mutate((prev) => ({ ...prev, series: restoreSeries(prev.series, back, removed.index) }))
      }
      setCardError(s.id, out.error)
      showError(`“${s.name}” 시리즈를 지우지 못했어요. ${out.error || ''}`.trim())
      return
    }
    showSuccess(`“${s.name}” 시리즈를 지웠어요. 영상 ${formatNumber(s.videoCount)}개는 그대로 남아 있어요.`)
    void refresh()
  }

  const orderedMembers = (s: SeriesRow) => {
    if (!orderCache.current.has(s.id)) orderCache.current.set(s.id, readOrder(s.id))
    return applyOrder(s.members, orderCache.current.get(s.id))
  }

  const moveMember = (s: SeriesRow, memberId: string, dir: -1 | 1) => {
    const list = orderedMembers(s)
    const ids = list.map((m) => m.id)
    const next = moveItem(ids, memberId, dir)
    if (next === ids) return
    orderCache.current.set(s.id, next)
    writeOrder(s.id, next)
    setOrderTick((n) => n + 1)
    const title = list.find((m) => m.id === memberId)?.title || '영상'
    setOrderNote(`“${title}”을(를) ${next.indexOf(memberId) + 1}번째로 옮겼어요.`)
  }

  const { longform: lf, shortform: sf } = data.formatStats
  const formatAnswer = summarizeFormats(lf, sf)
  const noVideos = lf.count === 0 && sf.count === 0
  const both = lf.count > 0 && sf.count > 0
  // 표의 한 줄 = 하나의 지표. 막대와 ▲ 글자로 더 높은 쪽을 알려 준다(색만으로 구분하지 않는다).
  const compareRows: CompareRowData[] = [
    { key: 'count', label: '영상 수', hint: '', long: { text: `${formatNumber(lf.count)}개`, value: lf.count }, short: { text: `${formatNumber(sf.count)}개`, value: sf.count }, compare: false },
    {
      key: 'eng',
      label: '참여율',
      hint: '조회수 대비 좋아요+댓글 비율',
      long: { text: lf.count ? formatPct(lf.avgEngagementPct, 2) : '—', value: lf.count ? lf.avgEngagementPct : null },
      short: { text: sf.count ? formatPct(sf.avgEngagementPct, 2) : '—', value: sf.count ? sf.avgEngagementPct : null },
      compare: both
    },
    {
      key: 'vel',
      label: '하루 평균 조회수',
      hint: '올린 뒤 하루에 평균 몇 번 보였는지',
      long: { text: lf.count ? `${formatNumber(Math.round(lf.avgVelocity))}회` : '—', value: lf.count ? lf.avgVelocity : null },
      short: { text: sf.count ? `${formatNumber(Math.round(sf.avgVelocity))}회` : '—', value: sf.count ? sf.avgVelocity : null },
      compare: both
    },
    {
      key: 'views',
      label: '총 조회수',
      hint: '모든 영상의 조회수를 더한 값',
      long: { text: `${formatCompactNumber(lf.totalViews)}회`, value: lf.totalViews, title: `${formatNumber(lf.totalViews)}회` },
      short: { text: `${formatCompactNumber(sf.totalViews)}회`, value: sf.totalViews, title: `${formatNumber(sf.totalViews)}회` },
      compare: false
    }
  ]
  const movable = data.movableVideos || []

  return (
    <>
      {header}
      <Toast toast={toast} />
      <span className="v3a-sr" role="status" aria-live="polite">
        {orderNote}
      </span>

      <div className="v3a-stack">
        {filterBar}
        <div className={`v3a-stack ${res.stale ? 'v3a-dim' : ''}`} aria-busy={res.refreshing || res.stale}>
          {res.error ? <RefreshFailed message={res.error} status={res.status} onRetry={() => void reload(true)} /> : null}
          <SampleBanner show={data.sample} />

          {noVideos ? (
            filtered ? (
              <EmptyBlock title="이 조건에는 비교할 영상이 없어요" actionLabel="필터 초기화" onAction={resetAll} secondaryLabel="영상 등록하러 가기" secondaryHref="/v3/register">
                고른 기간·직원에 영상이 없어요. 조건을 풀면 다른 영상이 보일 수 있어요.
              </EmptyBlock>
            ) : (
              <EmptyBlock title="아직 비교할 영상이 없어요" actionLabel="영상 등록하러 가기" actionHref="/v3/register">
                롱폼과 숏폼 영상이 함께 쌓이면, 어느 형식이 시청자 반응을 더 잘 얻는지 여기에서 바로 알려드려요.
              </EmptyBlock>
            )
          ) : (
            <>
              {formatAnswer ? <AnswerCard tone={formatAnswer.tone} eyebrow="롱폼 vs 숏폼" headline={formatAnswer.headline} detail={formatAnswer.detail} /> : null}

              <GlossaryHelp page="series" keys={['engagement', 'dailyViews', 'seriesEffect', 'baseline']} />

              <Section title="롱폼 vs 숏폼" description="영상이 몇 개인지가 아니라, 시청자가 얼마나 반응하고 조회수가 얼마나 빨리 느는지를 비교해요. ‘▲ 더 높아요’가 붙은 쪽이 더 좋은 쪽이에요. 막대가 길수록 값이 커요.">
                <CompareTable rows={compareRows} />
                <div className="v3a-toolbar">
                  <span className="v3a-sub-note">이 비교를 보고 다음에 할 일:</span>
                  <span className="v3i-tools">
                    <Link className="button secondary xs" href={viralHref('longform')}>
                      롱폼 중 급상승 영상 보기
                    </Link>
                    <Link className="button secondary xs" href={viralHref('shortform')}>
                      숏폼 중 급상승 영상 보기
                    </Link>
                  </span>
                </div>
              </Section>
            </>
          )}

          <Section
            title="시리즈"
            count={data.series.length}
            description="같은 주제로 이어지는 영상 묶음이에요. 같은 종목의 시리즈 밖 영상과 비교해서, 묶어 만든 효과가 있는지 알려드려요."
            actions={
              <>
                {data.sample ? <span className="small muted">SQL 실행 후 만들 수 있어요</span> : null}
                <button
                  type="button"
                  className={showForm ? 'button secondary' : 'button'}
                  disabled={data.sample && !showForm}
                  onClick={() => (showForm ? closeForm() : setShowForm(true))}
                >
                  {showForm ? '닫기' : '새 시리즈 만들기'}
                </button>
              </>
            }
          >
            {showForm ? (
              <form
                className="v3-inline-form"
                noValidate
                onSubmit={(e) => void createSeries(e)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !creating) closeForm()
                }}
              >
                <div className="v3-form-grid">
                  <div className="field">
                    <label className="label" htmlFor="v3-series-name">
                      시리즈 이름
                      <Req />
                    </label>
                    <input
                      id="v3-series-name"
                      ref={nameRef}
                      className="input"
                      value={name}
                      maxLength={200}
                      disabled={creating}
                      aria-invalid={!!(nameError || formError)}
                      aria-describedby="v3-series-name-err"
                      onChange={(e) => {
                        setName(e.target.value)
                        if (formError) setFormError(null)
                      }}
                      placeholder="예: 삼성전자 실적 브리핑 시리즈"
                    />
                    <FieldError id="v3-series-name-err">{nameError || withLoginLink(formError)}</FieldError>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="v3-series-stock">
                      종목 (선택)
                    </label>
                    <input
                      id="v3-series-stock"
                      className="input"
                      list="v3-series-stock-suggestions"
                      value={stockName}
                      maxLength={100}
                      disabled={creating}
                      onChange={(e) => setStockName(e.target.value)}
                      placeholder="예: 삼성전자"
                    />
                    <p className="v3a-field-help">넣으면 같은 종목의 다른 영상과 비교해요. 비워도 돼요.</p>
                    <datalist id="v3-series-stock-suggestions">
                      {SAMPLE_STOCK_NAMES.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="v3-series-video-search">
                    묶을 영상 고르기 (선택) · 지금 {selectedIds.length}개 골랐어요
                  </label>
                  <input
                    id="v3-series-video-search"
                    className="input v3a-search"
                    type="search"
                    placeholder="제목이나 종목으로 찾기"
                    value={videoQuery}
                    disabled={creating}
                    onChange={(e) => setVideoQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // 검색칸에서 Enter 를 눌러도 시리즈가 만들어지지 않게 한다.
                      if (e.key === 'Enter') e.preventDefault()
                    }}
                  />
                  <div className="v3a-picker scroll">
                    {pickable.length === 0 ? (
                      <div className="v3a-empty compact">
                        <div className="v3a-empty-text">{(data.eligibleVideos || []).length === 0 ? '묶을 수 있는 영상이 아직 없어요. 시리즈만 먼저 만들고 나중에 추가해도 돼요.' : '검색 결과가 없어요.'}</div>
                        {(data.eligibleVideos || []).length === 0 ? (
                          <Link className="button secondary xs" href="/v3/register">
                            영상 등록하러 가기
                          </Link>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        {pickMore.visible.map((v) => (
                          <button key={v.id} type="button" className={`v3a-pick check ${selectedIds.includes(v.id) ? 'selected' : ''}`} disabled={creating} aria-pressed={selectedIds.includes(v.id)} onClick={() => toggleSelect(v.id)}>
                            <span className="v3a-pick-title">
                              {v.title}
                              {v.stockName ? <span className="v3a-row-sub">· {v.stockName}</span> : null}
                            </span>
                            <span className="small muted">{selectedIds.includes(v.id) ? '✓ 선택됨' : ''}</span>
                          </button>
                        ))}
                        <MoreButton remaining={pickMore.remaining} onClick={pickMore.more} />
                      </>
                    )}
                  </div>
                  <p className="v3a-field-help">영상은 나중에 시리즈 카드에서 더 추가할 수 있어요. 이미 다른 시리즈에 들어간 영상은 여기서 보이지 않아요.</p>
                </div>
                <div className="v3a-lead-actions">
                  <button type="submit" className="button" disabled={creating || !!dupOfNew}>
                    {creating ? '저장 중…' : '시리즈 만들기'}
                  </button>
                  <button type="button" className="button secondary" disabled={creating} onClick={closeForm}>
                    취소
                  </button>
                </div>
              </form>
            ) : null}

            {data.series.length > 0 ? (
              <input
                className="input v3a-search"
                type="search"
                aria-label="시리즈 검색"
                placeholder="시리즈 이름·종목·영상 제목으로 찾기"
                maxLength={60}
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
              />
            ) : null}

            {data.series.length === 0 ? (
              <EmptyBlock title="아직 만든 시리즈가 없어요" actionLabel="첫 시리즈 만들기" onAction={() => setShowForm(true)} secondaryLabel="영상 등록하러 가기" secondaryHref="/v3/register">
                예를 들어 “삼성전자 실적 브리핑”처럼 같은 주제로 이어지는 영상을 묶어 두세요. 묶어 두면 시리즈가 일반 영상보다 반응이 좋은지 자동으로 비교해 드려요.
              </EmptyBlock>
            ) : visibleSeries.length === 0 ? (
              <EmptyBlock title="찾는 시리즈가 없어요" actionLabel="검색 지우기" onAction={resetAll}>
                {filters.q ? `“${filters.q}”에 맞는 시리즈가 없어요. ` : ''}이름이나 종목, 묶인 영상 제목을 다르게 검색해 보세요.
              </EmptyBlock>
            ) : (
              <div className="v3a-cards">
                {seriesMore.visible.map((s) => {
                  const engChange = pctChange(s.avgEngagementPct, s.baselineEngagementPct)
                  const velChange = pctChange(s.avgVelocity, s.baselineVelocity)
                  const engText = describeChange(engChange, '시리즈 밖 영상')
                  const velText = describeChange(velChange, '시리즈 밖 영상')
                  const verdict = seriesVerdict(s, engChange, velChange)
                  const candidates = findAddable({
                    query: adderQuery[s.id] || '',
                    eligible: data.eligibleVideos,
                    movable,
                    memberIds: s.members.map((m) => m.id),
                    seriesId: s.id
                  })
                  const alreadyIn = membersMatching(adderQuery[s.id] || '', s.members)
                  const canAdd = !data.sample && s.canEdit
                  const cardBusy = !!busyKey && busyKey.includes(s.id)
                  const isRenaming = renamingId === s.id
                  const members = orderedMembers(s)
                  return (
                    <div className="v3a-card" key={s.id}>
                      <div className="v3a-card-head">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {isRenaming ? (
                            <InlineEditor
                              label="시리즈 이름"
                              initial={renameDraft ?? s.name}
                              maxLength={200}
                              required
                              saving={false}
                              error={renameError}
                              onSave={(value) => renameSeries(s, value)}
                              onCancel={() => {
                                setRenamingId(null)
                                setRenameError(null)
                                setRenameDraft(null)
                              }}
                            />
                          ) : (
                            <div className="v3a-card-title">
                              {s.name} {data.sample ? <Tag tone="amber">예시</Tag> : null}
                            </div>
                          )}
                          <div className="v3-cell-sub">
                            {s.stockName || '종목 무관'} · 영상 {formatNumber(s.videoCount)}개{s.createdByName ? ` · 만든 사람 ${s.createdByName}` : ''}
                          </div>
                        </div>
                        <Tag tone={verdict.tone}>{verdict.label}</Tag>
                      </div>
                      {s.videoCount === 0 ? (
                        <p className="v3a-note">아직 이 시리즈에 묶인 영상이 없어요. 아래에서 영상을 추가하면 효과를 계산해요.</p>
                      ) : (
                        <div className="v3a-series-lines">
                          <div className="v3a-series-line">
                            참여율
                            <strong>{formatPct(s.avgEngagementPct, 2)}</strong>
                            <span className={`v3a-tone-${engText.tone}`}>
                              {engChange === null ? '비교할 기준 영상이 없어요' : `${engText.arrow} ${engText.text} (${formatPct(s.baselineEngagementPct, 2)})`}
                            </span>
                          </div>
                          <div className="v3a-series-line">
                            하루 평균 조회수
                            <strong>{formatNumber(Math.round(s.avgVelocity))}회</strong>
                            <span className={`v3a-tone-${velText.tone}`}>
                              {velChange === null ? '비교할 기준 영상이 없어요' : `${velText.arrow} ${velText.text} (${formatNumber(Math.round(s.baselineVelocity))}회)`}
                            </span>
                          </div>
                        </div>
                      )}

                      {members.length > 0 ? (
                        <div>
                          <button type="button" className="v3i-linkbtn" aria-expanded={!!openMembers[s.id]} onClick={() => setOpenMembers((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}>
                            {openMembers[s.id] ? '묶인 영상 접기' : `묶인 영상 ${formatNumber(members.length)}개 보기`}
                          </button>
                          {openMembers[s.id] ? (
                            <>
                              {s.canEdit && !data.sample && members.length > 1 ? <p className="v3a-order-hint">↑ ↓ 버튼으로 회차 순서를 바꿀 수 있어요. 순서는 이 컴퓨터(브라우저)에만 기억되고, 다른 사람에게는 올린 날짜 순으로 보여요.</p> : null}
                              <ul className="v3i-members">
                                {members.map((m, index) => (
                                  <li key={m.id} className="v3i-member">
                                    <span className="v3a-member-title-wrap">
                                      <span className="v3a-member-no" aria-hidden>
                                        {index + 1}.
                                      </span>
                                      <span className="v3i-member-title" title={m.title}>
                                        {m.title}
                                      </span>
                                    </span>
                                    <span className="v3a-member-actions">
                                      <Link className="v3i-linkbtn" href={lifecycleHref(m.id)}>
                                        성장 곡선
                                      </Link>
                                      {s.canEdit && !data.sample ? (
                                        <>
                                          {members.length > 1 ? (
                                            <>
                                              <button type="button" className="v3a-move" disabled={index === 0} aria-label={`${m.title} 위로 옮기기`} onClick={() => moveMember(s, m.id, -1)}>
                                                <span aria-hidden>↑</span>
                                              </button>
                                              <button type="button" className="v3a-move" disabled={index === members.length - 1} aria-label={`${m.title} 아래로 옮기기`} onClick={() => moveMember(s, m.id, 1)}>
                                                <span aria-hidden>↓</span>
                                              </button>
                                            </>
                                          ) : null}
                                          <button type="button" className="v3i-linkbtn" disabled={!!busyKey} onClick={() => void removeMember(s, m)} aria-label={`${m.title} 시리즈에서 빼기`}>
                                            {busyKey === `rm:${s.id}:${m.id}` ? '빼는 중…' : '시리즈에서 빼기'}
                                          </button>
                                        </>
                                      ) : null}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </div>
                      ) : null}

                      {canAdd ? (
                        <div>
                          {adderOpen[s.id] ? (
                            <div className="v3a-adder">
                              <div className="field">
                                <label className="label" htmlFor={`v3-series-add-${s.id}`}>
                                  추가할 영상 찾기
                                </label>
                                <input
                                  id={`v3-series-add-${s.id}`}
                                  className="input v3a-search"
                                  type="search"
                                  placeholder="제목이나 종목으로 찾기 (예: 삼성전자)"
                                  value={adderQuery[s.id] || ''}
                                  disabled={busyKey === `add:${s.id}`}
                                  onChange={(e) => setAdderQuery((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') setAdderOpen((prev) => ({ ...prev, [s.id]: false }))
                                  }}
                                />
                              </div>
                              {candidates.results.length > 0 ? (
                                <div className="v3a-adder-results">
                                  {candidates.results.map((v) => (
                                    <div className="v3a-adder-item" key={v.id}>
                                      <span>
                                        {v.title}
                                        {v.stockName ? <span className="v3a-row-sub">· {v.stockName}</span> : null}
                                        {v.moveFromSeriesName ? <span className="v3a-row-sub">· 지금 “{v.moveFromSeriesName}”에 있어요. 추가하면 옮겨져요</span> : null}
                                      </span>
                                      <button type="button" className="button secondary xs" disabled={!!busyKey} onClick={() => void addToSeries(s, v)}>
                                        {busyKey === `add:${s.id}` ? '저장 중…' : v.moveFromSeriesName ? '옮겨오기' : '추가'}
                                      </button>
                                    </div>
                                  ))}
                                  {candidates.total > candidates.results.length ? <p className="v3a-sub-note">{formatNumber(candidates.total - candidates.results.length)}개가 더 있어요. 검색어를 더 적어서 좁혀 보세요.</p> : null}
                                </div>
                              ) : (
                                <div className="v3a-empty compact">
                                  <div className="v3a-empty-text">
                                    {alreadyIn.length > 0
                                      ? `“${alreadyIn[0].title}”처럼 검색어에 맞는 영상은 이미 이 시리즈에 들어 있어요.`
                                      : adderQuery[s.id]
                                        ? '검색어에 맞고 추가할 수 있는 영상이 없어요. 다른 검색어로 찾아 보세요.'
                                        : '추가할 수 있는 영상이 없어요. 새 영상을 등록하면 여기에 나타나요. (직원은 내가 올린 영상만 넣을 수 있어요)'}
                                  </div>
                                  {!adderQuery[s.id] ? (
                                    <Link className="button secondary xs" href="/v3/register">
                                      영상 등록하러 가기
                                    </Link>
                                  ) : null}
                                </div>
                              )}
                              {candidates.results.length > 0 && alreadyIn.length > 0 ? <p className="v3a-sub-note">“{alreadyIn[0].title}” 등 {alreadyIn.length}개는 이미 이 시리즈에 있어서 목록에서 뺐어요.</p> : null}
                              <div className="v3i-tools">
                                <button type="button" className="button secondary xs" onClick={() => setAdderOpen((prev) => ({ ...prev, [s.id]: false }))}>
                                  영상 추가 닫기
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" className="button secondary xs" disabled={cardBusy} onClick={() => setAdderOpen((prev) => ({ ...prev, [s.id]: true }))}>
                              영상 추가하기
                            </button>
                          )}
                        </div>
                      ) : null}

                      {s.canEdit && !data.sample ? (
                        <div className="v3i-tools">
                          {!isRenaming ? (
                            <button
                              type="button"
                              className="button secondary xs"
                              disabled={cardBusy}
                              onClick={() => {
                                setRenamingId(s.id)
                                setRenameDraft(null)
                                setRenameError(null)
                              }}
                            >
                              이름 바꾸기
                            </button>
                          ) : null}
                          <ConfirmButton
                            label="시리즈 삭제"
                            question={`“${s.name}” 시리즈만 지워져요. 영상 ${formatNumber(s.videoCount)}개는 그대로 남아요. 삭제할까요?`}
                            confirmLabel="삭제"
                            busyLabel="삭제 중…"
                            danger
                            busy={busyKey === `del:${s.id}`}
                            disabled={cardBusy && busyKey !== `del:${s.id}`}
                            onConfirm={() => deleteSeries(s)}
                          />
                        </div>
                      ) : !s.canEdit && !data.sample ? (
                        <p className="v3i-inline-note">{s.createdByName ? `${s.createdByName}님이 만든 시리즈라서 볼 수만 있어요.` : '만든 사람이 없는 시리즈라서 관리자만 고칠 수 있어요.'}</p>
                      ) : null}
                      <FieldError>{withLoginLink(cardErrors[s.id])}</FieldError>
                    </div>
                  )
                })}
                <MoreButton remaining={seriesMore.remaining} onClick={seriesMore.more} label="시리즈 더 보기" />
              </div>
            )}
          </Section>

          <HowTo>
            <p>참여율 = (좋아요 + 댓글) ÷ 조회수 × 100</p>
            <p>하루 평균 조회수 = 조회수 ÷ 올린 지 지난 날짜 (최소 1일)</p>
            <p>
              <Term k="seriesEffect" />: 시리즈에 묶인 영상들의 평균을, 같은 종목이면서 시리즈에 속하지 않은 영상들(<Term k="baseline" />)의 평균(괄호 안 숫자)과 비교해요. 두 지표가 모두 5% 이상 높으면 ‘시리즈 효과 있음’이에요.
            </p>
            <p>영상은 한 시리즈에만 들어갈 수 있어요. 다른 시리즈에 있는 영상을 추가하면 그쪽에서 옮겨 와요.</p>
            <p>위의 ‘롱폼·숏폼 비교 기간’과 ‘비교할 직원’은 롱폼 vs 숏폼 표에만 적용돼요. 시리즈 카드의 비교는 늘 팀 전체 영상을 기준으로 해요.</p>
          </HowTo>
        </div>
      </div>
    </>
  )
}
