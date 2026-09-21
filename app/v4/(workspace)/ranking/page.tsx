'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { v4Fetch } from '@/lib/v4/client'
import { useStoredState } from '@/lib/v4/use-stored-state'
import { useV4Query } from '@/lib/v4/use-v4-query'
import { useUrlFilters } from '@/lib/v4/use-url-filters'
import { useSearchField } from '@/lib/v4/use-search-field'
import type { RankedVideo } from '@/lib/v4/analytics'
import type { RankSortKey } from '@/lib/v4/ranking-query'
import { RANKING_SPEC, type RankingFilters } from '@/lib/v4/page-filters'
import { buildCsv, csvFilename, csvKstDateTime } from '@/lib/v4/csv'
import { downloadCsvFile } from '@/lib/v4/download'
import { fetchAllPages } from '@/lib/v4/export-all'
import { ActiveFilters, CopyLinkButton, CsvButton, GlossaryHint, GlossaryList, SyncStatsButton, type ExportProgress, type FilterChip } from '@/lib/v4/page-tools'
import { Card, EmptyPanel, ErrorPanel, FormatBadge, Formula, Hero, Kpi, KpiRow, Seg, SkelTable, SortHead } from '@/lib/v4/analysis-ui'
import { WEEKDAY_LABELS, fmtHourRangeKo, fmtKstMonthDay, fmtKstStamp, fmtNumber, fmtNumberOr, fmtPercentOr, fmtShortOr, fmtYmdKo } from '@/lib/v4/format'
import '../pages.css'

type RankedItem = Omit<RankedVideo, 'thumbnailUrl'>

type Summary = { videoCount: number; totalViews: number; avgViews: number; top: RankedItem | null; rising: RankedItem | null }

type RankingResponse = {
  scope: 'admin' | 'staff'
  period: number
  range: { start: string; end: string }
  items: RankedItem[]
  staffOptions: Array<{ id: string; name: string }>
  total: number
  hasMore: boolean
  summary: Summary
  filteredSummary?: Summary
  error?: string
}

const FIRST_PAGE = 10
const MORE_PAGE = 20
const EXPORT_PAGE = 200
const NO_ITEMS: RankedItem[] = []
const LOAD_ERROR = '영상 순위를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
const RESET_KEYS: Array<keyof RankingFilters> = ['sort', 'dir', 'staff', 'format', 'q', 'dow', 'hour']

const SORT_LABEL: Record<RankSortKey, string> = {
  viewCount: '조회수',
  velocity: '조회 속도(하루 평균)',
  likeCount: '좋아요 수',
  commentCount: '댓글 수',
  daysSincePublished: '올린 지 오래된 정도',
  likeRate: '좋아요 비율'
}

// 정렬 기준마다 "많은 쪽 / 적은 쪽" 을 쉬운 말로
function dirLabels(key: RankSortKey): [string, string] {
  if (key === 'viewCount') return ['잘 나가는 순', '반응 약한 순']
  if (key === 'daysSincePublished') return ['오래된 순', '최근 순']
  return ['높은 순', '낮은 순']
}

function slotText(dow: number, hour: number) {
  const day = dow >= 0 ? `${WEEKDAY_LABELS[dow]}요일 ` : ''
  const time = hour >= 0 ? `${fmtHourRangeKo(hour)} ` : ''
  return `${day}${time}`.trim()
}

export default function ContentRankingPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 안에 있어야 한다 (Next 16).
  return (
    <Suspense
      fallback={
        <div className="v4p" style={{ padding: 16 }}>
          <SkelTable rows={FIRST_PAGE} />
        </div>
      }
    >
      <RankingScreen />
    </Suspense>
  )
}

function RankingScreen() {
  const { isAdmin } = useV4Me()
  const { toast, showSuccess, showError } = useToast()
  // showError 는 렌더마다 새로 만들어지므로 ref 에 담아 두고 effect 의존성에는 넣지 않는다.
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError

  const { filters, ready, set, reset, shareUrl } = useUrlFilters<RankingFilters>('ranking', RANKING_SPEC)
  const { period, sort: sortKey, dir, staff, format, q: queryValue, dow, hour } = filters
  const sortDesc = dir === 'desc'
  const [queryText, setQueryText] = useSearchField(queryValue, (value) => set({ q: value }))
  // "자세히 보기" 는 보는 방식이라 필터와 따로, 이 브라우저에만 기억한다.
  const [detail, setDetail] = useStoredState<boolean>('v4:ranking:detail', false)

  const buildPath = useCallback(
    (limit: number, offset: number) =>
      `/api/v4/ranking?period=${period}&sort=${sortKey}&dir=${dir}&limit=${limit}&offset=${offset}` +
      `&staffId=${encodeURIComponent(isAdmin ? staff : '')}&format=${format}&q=${encodeURIComponent(queryValue)}` +
      `${dow >= 0 ? `&dow=${dow}` : ''}${hour >= 0 ? `&hour=${hour}` : ''}`,
    [period, sortKey, dir, isAdmin, staff, format, queryValue, dow, hour]
  )
  const path = ready ? buildPath(FIRST_PAGE, 0) : null

  const hasDataRef = useRef(false)
  const { data, stale, error, status, fetching, reload } = useV4Query<RankingResponse>(path, {
    fallback: LOAD_ERROR,
    // 이미 화면에 값이 있을 때만 알림으로 알린다 (처음부터 실패하면 화면 가운데 안내가 나온다)
    onError: (message) => {
      if (hasDataRef.current) showErrorRef.current(message)
    }
  })
  hasDataRef.current = data !== null

  // ---- "더 보기": 다음 20개를 이어서 받는다. 조건(기간/정렬/필터/검색)이 바뀌면 이어받은 것은 버리고 처음 10개부터.
  // (몇 개까지 펼쳤는지는 주소에 넣지 않는다)
  const [more, setMore] = useState<{ path: string; items: RankedItem[] }>({ path: '', items: [] })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const moreAbort = useRef<AbortController | null>(null)
  const loadingMoreRef = useRef(false)
  const aliveRef = useRef(true)
  const exportAbort = useRef<AbortController | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      moreAbort.current?.abort()
      exportAbort.current?.abort()
    }
  }, [])

  useEffect(() => {
    moreAbort.current?.abort()
    moreAbort.current = null
    loadingMoreRef.current = false
    setLoadingMore(false)
    setMoreError('')
  }, [path])

  const extra = path && more.path === path ? more.items : NO_ITEMS
  const shown = useMemo(() => (data ? [...data.items, ...extra] : []), [data, extra])
  const total = data?.total ?? 0

  const loadMore = async () => {
    if (!data || !path || stale || loadingMoreRef.current) return // 더블 클릭 방지
    loadingMoreRef.current = true
    setLoadingMore(true)
    setMoreError('')
    const base = path
    const offset = shown.length
    const controller = new AbortController()
    moreAbort.current = controller
    const result = await v4Fetch<RankingResponse>(buildPath(MORE_PAGE, offset), { signal: controller.signal }, LOAD_ERROR)
    // 화면을 떠났거나 조건이 바뀌어 취소된 요청은 조용히 버린다.
    if (controller.signal.aborted || !aliveRef.current) return
    loadingMoreRef.current = false
    setLoadingMore(false)
    if (!result.ok) {
      setMoreError(result.message)
      showErrorRef.current(result.message)
      return
    }
    const incoming = result.data.items
    setMore((prev) => {
      const prevItems = prev.path === base ? prev.items : []
      const known = new Set([...data.items, ...prevItems].map((v) => v.id))
      return { path: base, items: [...prevItems, ...incoming.filter((v) => !known.has(v.id))] }
    })
  }

  const collapse = () => setMore({ path: '', items: [] })

  // ---- 표를 CSV 로 저장: 화면에 불러온 것만이 아니라 "조건에 맞는 전부" 를 200개씩 이어 받아 만든다.
  const exportAll = async () => {
    if (exportAbort.current || !data) return
    const controller = new AbortController()
    exportAbort.current = controller
    setExportProgress({ done: 0, total: data.total })
    try {
      const result = await fetchAllPages<RankedItem>({
        pageSize: EXPORT_PAGE,
        signal: controller.signal,
        fetchPage: async (offset, limit, signal) => {
          const res = await v4Fetch<RankingResponse>(buildPath(limit, offset), { signal }, LOAD_ERROR)
          if (!res.ok) throw new Error(res.message)
          return { items: res.data.items, total: res.data.total }
        },
        onProgress: (done, all) => {
          if (aliveRef.current) setExportProgress({ done, total: all })
        }
      })
      if (!aliveRef.current) return
      if (result.cancelled) {
        showSuccess('저장을 취소했어요.')
      } else if (result.rows.length === 0) {
        showError('저장할 영상이 없어요.')
      } else {
        const headers = ['순위', '제목', '종목', ...(isAdmin ? ['담당자'] : []), '형식', '조회수', '조회 속도(회/일)', '좋아요', '댓글', '올린 지(일)', '좋아요 비율(%)', '게시 시각(한국 시간)', '유튜브 주소']
        const rows = result.rows.map((v, i) => [
          i + 1,
          v.title,
          v.stockName,
          ...(isAdmin ? [v.ownerName] : []),
          v.contentType === 'shortform' ? '숏폼' : '롱폼',
          v.viewCount,
          v.velocity,
          v.likeCount,
          v.commentCount,
          v.daysSincePublished,
          v.viewCount > 0 ? Number((v.likeRate * 100).toFixed(2)) : '',
          csvKstDateTime(v.publishedAt || v.createdAt),
          v.youtubeUrl
        ])
        downloadCsvFile(csvFilename(`영상순위_최근${period}일`), buildCsv(headers, rows))
        showSuccess(`영상 ${fmtNumber(result.rows.length)}개를 CSV로 저장했어요.${result.truncated ? ' (너무 많아 일부만 담았어요)' : ''}`)
      }
    } catch (e) {
      if (!aliveRef.current) return
      // 취소하는 순간 끊어진 요청은 오류가 아니다.
      if (controller.signal.aborted) showSuccess('저장을 취소했어요.')
      else showError(e instanceof Error && e.message ? e.message : LOAD_ERROR)
    } finally {
      exportAbort.current = null
      if (aliveRef.current) setExportProgress(null)
    }
  }

  const staffId = isAdmin && data?.staffOptions.some((s) => s.id === staff) ? staff : ''
  const staffName = data?.staffOptions.find((s) => s.id === staff)?.name
  const slotFiltered = dow >= 0 || hour >= 0
  const filtered = Boolean(staffId || format || queryValue || slotFiltered)

  const toggleSort = (key: RankSortKey) => {
    if (sortKey === key) set({ dir: sortDesc ? 'asc' : 'desc' })
    else set({ sort: key, dir: 'desc' })
  }

  // ---- 지금 걸려 있는 조건 요약 (칩)
  const chips: FilterChip[] = []
  if (queryValue) chips.push({ key: 'q', label: `검색: ${queryValue}`, onRemove: () => set({ q: '' }) })
  if (staffId) chips.push({ key: 'staff', label: `담당자: ${staffName ?? '선택한 담당자'}`, onRemove: () => set({ staff: '' }) })
  if (format) chips.push({ key: 'format', label: format === 'shortform' ? '숏폼만' : '롱폼만', onRemove: () => set({ format: '' }) })
  if (slotFiltered) chips.push({ key: 'slot', label: `${slotText(dow, hour)}에 올린 영상`, onRemove: () => set({ dow: -1, hour: -1 }) })
  if (sortKey !== 'viewCount' || dir !== 'desc') {
    chips.push({ key: 'sort', label: `정렬: ${SORT_LABEL[sortKey]} · ${dirLabels(sortKey)[sortDesc ? 0 : 1]}`, onRemove: () => set({ sort: 'viewCount', dir: 'desc' }) })
  }
  const clearFilters = () => reset(RESET_KEYS)

  // 열 구성 (직원 계정은 본인 영상만 보므로 담당자 열을 숨긴다)
  const cols = [
    { id: 'rank', width: '32px' },
    { id: 'title', width: 'minmax(150px, 2.4fr)' },
    { id: 'stock', width: 'minmax(70px, 1fr)' },
    ...(isAdmin ? [{ id: 'owner', width: '70px' }] : []),
    { id: 'view', width: '84px' },
    { id: 'velocity', width: '96px' },
    ...(detail
      ? [
          { id: 'format', width: '50px' },
          { id: 'like', width: '62px' },
          { id: 'comment', width: '54px' },
          { id: 'days', width: '58px' },
          { id: 'rate', width: '70px' }
        ]
      : [])
  ]
  const rowStyle = { '--cols': cols.map((c) => c.width).join(' ') } as CSSProperties
  const has = (id: string) => cols.some((c) => c.id === id)

  const sortHead = (key: RankSortKey, label: string, title?: string) => (
    <SortHead label={label} active={sortKey === key} desc={sortDesc} onClick={() => toggleSort(key)} title={title} />
  )

  // 조건을 걸었으면 위쪽 숫자도 "걸러진 영상" 기준으로 보여준다.
  const summary = filtered ? data?.filteredSummary ?? data?.summary : data?.summary
  const top = summary?.top ?? null
  const rising = summary?.rising ?? null
  const scopeText = data?.scope === 'staff' ? '내 영상' : '팀 전체'
  const failed = Boolean(error) && (!data || stale)
  const noData = Boolean(data) && !stale && !error && data?.summary.videoCount === 0
  const zeroViews = Boolean(data) && !stale && !error && (data?.summary.videoCount ?? 0) > 0 && data?.summary.totalViews === 0
  const busy = fetching && stale

  const onSyncMessage = (message: string, tone: 'success' | 'error') => (tone === 'success' ? showSuccess(message) : showError(message))

  return (
    <>
      <PageHeader
        title="콘텐츠 성과 랭킹"
        subtitle="어떤 영상이 잘 나가고 있는지 한눈에 봅니다."
        actions={
          <>
            <CopyLinkButton getUrl={shareUrl} onResult={(ok) => (ok ? showSuccess('이 화면 링크를 복사했어요. 받은 사람도 같은 조건으로 볼 수 있어요.') : showError('링크를 복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.'))} />
            <PeriodToggle value={period} onChange={(next) => set({ period: next })} />
          </>
        }
      />
      <Toast toast={toast} />

      <div className="v4p">
        {failed && !data ? (
          <ErrorPanel message={error} status={status} onRetry={reload} busy={fetching} />
        ) : noData ? (
          <EmptyPanel title="이 기간에 등록된 영상이 아직 없어요">
            이 화면은 CRM에 등록한 영상을 조회수 순으로 보여줘요. 영상을 등록해야 순위가 만들어져요. 등록하면 유튜브에서 조회수를 자동으로 가져와요. 기간을 더 길게 바꿔 볼 수도 있어요.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={
                data ? `최근 ${data.period}일 · ${scopeText}${filtered ? ' · 조건에 맞는 영상만' : ''} · ${fmtYmdKo(data.range.start)} ~ ${fmtYmdKo(data.range.end)}` : undefined
              }
              headline={
                top ? (
                  <>
                    {filtered ? '이 조건에서 가장 잘 나가는 영상' : '지금 가장 잘 나가는 영상'}: <span className="em">{top.title}</span>
                  </>
                ) : zeroViews ? (
                  '아직 조회수를 받아오지 않았어요'
                ) : filtered && total === 0 ? (
                  '조건에 맞는 영상이 없어요'
                ) : (
                  '아직 조회수가 쌓인 영상이 없어요'
                )
              }
            >
              {top ? (
                <p className="v4p-hero-detail">
                  <strong>{top.stockName}</strong>
                  {isAdmin ? <> · {top.ownerName} 담당</> : null} · 조회수 <strong title={`${fmtNumberOr(top.viewCount)}회`}>{fmtShortOr(top.viewCount)}회</strong>
                  {' '}(하루 평균 {fmtNumberOr(top.velocity)}회 <GlossaryHint term="velocity" />)
                  {top.youtubeUrl ? (
                    <>
                      {' · '}
                      <a href={top.youtubeUrl} target="_blank" rel="noopener noreferrer">
                        유튜브에서 보기 ↗
                      </a>
                    </>
                  ) : null}
                </p>
              ) : zeroViews ? (
                <>
                  <p className="v4p-hero-detail">영상은 등록되어 있지만 유튜브에서 조회수를 아직 받아오지 않았어요. 조회수를 받아오면 순위가 만들어져요.</p>
                  <div className="v4p-hero-actions">
                    {isAdmin ? <SyncStatsButton onDone={() => { collapse(); reload() }} onMessage={onSyncMessage} /> : <span className="small muted">관리자가 조회수를 받아오면 여기에 나타나요.</span>}
                  </div>
                </>
              ) : (
                <p className="v4p-hero-detail">{filtered ? '아래 “지금 보는 조건”에서 조건을 빼거나 필터를 초기화해 보세요.' : '조회수는 유튜브에서 자동으로 가져오니 조금 기다려 보세요.'}</p>
              )}
              {rising ? (
                <div className="v4p-hero-note plain">
                  요즘 빠르게 오르는 영상: <strong>{rising.title}</strong> — 올린 지 {fmtNumberOr(rising.daysSincePublished)}일 만에 {fmtShortOr(rising.viewCount)}회 ({rising.stockName})
                </div>
              ) : null}
            </Hero>

            <KpiRow>
              <Kpi label={filtered ? '조건에 맞는 영상' : '등록한 영상'} value={`${fmtNumberOr(summary?.videoCount)}개`} hint="이 기간에 등록된 영상의 수예요." loading={!data} />
              <Kpi label="총 조회수" value={`${fmtShortOr(summary?.totalViews)}회`} hint="이 영상들이 지금까지 받은 조회수를 모두 더한 값이에요." loading={!data} />
              <Kpi label="영상 1개당 평균 조회수" value={`${fmtShortOr(summary?.avgViews)}회`} hint="이 숫자보다 높으면 평균 이상으로 잘 나가는 영상이에요." loading={!data} term="avgViews" />
            </KpiRow>

            <Card
              title="영상 순위"
              sub="기본은 조회수가 많은 순 Top 10이에요. 제목을 누르면 유튜브가 열려요. 종목이나 담당자 이름을 누르면 그 영상만 모아 볼 수 있어요."
              actions={
                <>
                  <CsvButton onExport={() => void exportAll()} onCancel={() => exportAbort.current?.abort()} progress={exportProgress} disabled={!data || failed || total === 0} />
                  <label className="v4p-toggle">
                    <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
                    좋아요·댓글 등 자세히 보기
                  </label>
                </>
              }
            >
              <div className="v4p-filters">
                <input
                  className="input search"
                  type="search"
                  placeholder="종목이나 제목으로 찾기 (예: 삼성전자)"
                  value={queryText}
                  maxLength={60}
                  onChange={(e) => setQueryText(e.target.value)}
                  aria-label="종목 또는 제목 검색"
                />
                {isAdmin ? (
                  <select className="select" value={staffId} onChange={(e) => set({ staff: e.target.value })} aria-label="담당자">
                    <option value="">담당자 전체</option>
                    {(data?.staffOptions ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select className="select" value={format} onChange={(e) => set({ format: e.target.value as RankingFilters['format'] })} aria-label="영상 형식">
                  <option value="">롱폼·숏폼 모두</option>
                  <option value="longform">롱폼만</option>
                  <option value="shortform">숏폼만</option>
                </select>
                {/* 좁은 화면에서는 열 제목이 사라지므로 정렬 기준을 고르는 칸을 따로 보여준다 */}
                <select className="select v4p-sortsel" value={sortKey} onChange={(e) => set({ sort: e.target.value as RankSortKey })} aria-label="정렬 기준">
                  {(Object.keys(SORT_LABEL) as RankSortKey[]).map((key) => (
                    <option key={key} value={key}>
                      정렬: {SORT_LABEL[key]}
                    </option>
                  ))}
                </select>
                <Seg
                  label="정렬 방향"
                  value={dir}
                  options={[
                    ['desc', dirLabels(sortKey)[0]],
                    ['asc', dirLabels(sortKey)[1]]
                  ]}
                  onChange={(next) => set({ dir: next })}
                />
              </div>
              <ActiveFilters chips={chips} onReset={clearFilters} />

              {!data ? (
                <SkelTable rows={FIRST_PAGE} />
              ) : failed ? (
                <ErrorPanel message={error} status={status} onRetry={reload} busy={fetching} />
              ) : !stale && total === 0 ? (
                <EmptyPanel
                  title="조건에 맞는 영상이 없어요"
                  action={
                    <button type="button" className="button secondary" onClick={clearFilters}>
                      필터 초기화
                    </button>
                  }
                >
                  {slotFiltered ? '그 요일·시각에 올린 영상이 이 기간에는 없어요. 조건이 너무 좁을 수 있으니 ' : '검색어나 담당자, 형식 조건이 너무 좁을 수 있어요. '}
                  {slotFiltered ? '시각 조건을 빼거나 기간을 늘려 보세요.' : '조건을 빼 보세요.'}
                </EmptyPanel>
              ) : (
                <div className={`v4p-tbl ${detail ? 'wide' : ''} ${busy ? 'busy' : ''}`} role="table" aria-label="영상 순위" aria-busy={busy}>
                  <div className="v4p-tr head" style={rowStyle} role="row">
                    <div role="columnheader">#</div>
                    <div role="columnheader">제목</div>
                    <div role="columnheader">종목</div>
                    {has('owner') ? <div role="columnheader">담당자</div> : null}
                    {sortHead('viewCount', '조회수')}
                    {sortHead('velocity', '조회 속도', '하루 평균 조회수예요')}
                    {has('format') ? <div role="columnheader">형식</div> : null}
                    {has('like') ? sortHead('likeCount', '좋아요') : null}
                    {has('comment') ? sortHead('commentCount', '댓글') : null}
                    {has('days') ? sortHead('daysSincePublished', '올린 지') : null}
                    {has('rate') ? sortHead('likeRate', '좋아요 비율', '조회수 대비 좋아요 수예요') : null}
                  </div>
                  {shown.map((row, index) => {
                    const publishedIso = row.publishedAt || row.createdAt
                    return (
                      <div className="v4p-tr" style={rowStyle} key={row.id} role="row">
                        <div className="v4p-cell-rank" role="cell">
                          <span className={`v4p-rank ${index < 3 && sortKey === 'viewCount' && sortDesc ? 'top' : ''}`}>{index + 1}</span>
                        </div>
                        <div className="v4p-title-cell" role="cell">
                          {row.youtubeUrl ? (
                            <a href={row.youtubeUrl} target="_blank" rel="noopener noreferrer" title={row.title}>
                              {row.title}
                            </a>
                          ) : (
                            <span className="t" title={row.title}>{row.title}</span>
                          )}
                          <div className="v4p-sub" title={fmtKstStamp(publishedIso)}>게시 {fmtKstMonthDay(publishedIso)}</div>
                        </div>
                        <div className="v4p-ellipsis" data-label="종목" role="cell">
                          <button type="button" className="v4p-cell-btn" title={`${row.stockName} — 이 종목 영상만 보기`} onClick={() => set({ q: row.stockName })}>
                            {row.stockName}
                          </button>
                        </div>
                        {has('owner') ? (
                          <div className="v4p-ellipsis" data-label="담당자" role="cell">
                            {row.ownerId ? (
                              <button type="button" className="v4p-cell-btn" title={`${row.ownerName} — 이 담당자 영상만 보기`} onClick={() => set({ staff: row.ownerId ?? '' })}>
                                {row.ownerName}
                              </button>
                            ) : (
                              row.ownerName
                            )}
                          </div>
                        ) : null}
                        <div className="v4p-td-r v4p-num" data-label="조회수" title={`${fmtNumberOr(row.viewCount)}회`} role="cell">{fmtNumberOr(row.viewCount)}</div>
                        <div className="v4p-td-r" data-label="조회 속도" role="cell">{fmtNumberOr(row.velocity)}회/일</div>
                        {has('format') ? <div data-label="형식" role="cell"><FormatBadge contentType={row.contentType} /></div> : null}
                        {has('like') ? <div className="v4p-td-r" data-label="좋아요" role="cell">{fmtNumberOr(row.likeCount)}</div> : null}
                        {has('comment') ? <div className="v4p-td-r" data-label="댓글" role="cell">{fmtNumberOr(row.commentCount)}</div> : null}
                        {has('days') ? <div className="v4p-td-r" data-label="올린 지" title={fmtKstStamp(publishedIso)} role="cell">{fmtNumberOr(row.daysSincePublished)}일</div> : null}
                        {has('rate') ? <div className="v4p-td-r" data-label="좋아요 비율" role="cell">{fmtPercentOr(row.viewCount > 0 ? row.likeRate : null, 1)}</div> : null}
                      </div>
                    )
                  })}
                </div>
              )}

              {data && !failed && total > 0 ? (
                <div className="v4p-pager">
                  <span className="small muted" aria-live="polite">
                    {filtered ? `조건에 맞는 영상 ${fmtNumberOr(total)}개 중 ` : `전체 ${fmtNumberOr(total)}개 중 `}
                    {fmtNumberOr(shown.length)}개 표시
                  </span>
                  <div className="row" style={{ gap: 8 }}>
                    {moreError ? <span className="small v4p-pager-error" role="alert">{moreError}</span> : null}
                    {extra.length > 0 ? (
                      <button type="button" className="button secondary" onClick={collapse}>
                        접기
                      </button>
                    ) : null}
                    {shown.length < total ? (
                      <button type="button" className="button secondary" onClick={() => void loadMore()} disabled={loadingMore || stale}>
                        {loadingMore ? '불러오는 중…' : moreError ? '다시 시도' : `더 보기 (${fmtNumberOr(Math.min(MORE_PAGE, total - shown.length))}개 더)`}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <Formula>
                <p>조회 속도 = 조회수 ÷ 올린 뒤 지난 날짜(최소 1일). 하루에 평균 몇 번 봤는지를 뜻해요. 최근에 올린 영상도 공정하게 비교할 수 있어요.</p>
                <p>좋아요 비율 = 좋아요 수 ÷ 조회수. 영상을 본 사람 중 얼마나 좋아요를 눌렀는지 보여줘요.</p>
                <p>올린 날짜는 유튜브 게시일 기준이고, 없으면 CRM에 등록한 시각을 씁니다. 날짜와 시각에 마우스를 올리면 정확한 한국 시간이 나와요.</p>
                <p>“표를 CSV로 저장”은 화면에 보이는 10~20개가 아니라, 지금 조건에 맞는 영상 전부를 저장해요.</p>
              </Formula>
              <GlossaryList terms={['velocity', 'avgViews', 'likeRate']} />
            </Card>
          </>
        )}
      </div>
    </>
  )
}
