'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { useUrlFilters } from '@/lib/v4/use-url-filters'
import { useSearchField } from '@/lib/v4/use-search-field'
import { useV4Query } from '@/lib/v4/use-v4-query'
import type { PeriodDays, StockAggregate } from '@/lib/v4/analytics'
import { STOCKS_SPEC, rankingHref, type StocksFilters } from '@/lib/v4/page-filters'
import {
  NO_STOCK_NAME,
  STOCK_FOLD_MAX_MULTIPLE,
  STOCK_FOLD_MIN_VIDEOS,
  STOCK_TOP_MIN_MULTIPLE,
  STOCK_TOP_MIN_VIDEOS,
  buildStockAdvice,
  fmtMultiple
} from '@/lib/v4/insights'
import { ActiveFilters, CopyLinkButton, CsvButton, GlossaryHint, GlossaryList, SyncStatsButton, type FilterChip } from '@/lib/v4/page-tools'
import { Badge, Card, EmptyPanel, ErrorPanel, Formula, Hero, Kpi, KpiRow, Seg, SkelTable, SkelTiles, SortHead, TrendBadge } from '@/lib/v4/analysis-ui'
import { fmtKstMonthDay, fmtKstStamp, fmtNumber, fmtNumberOr, fmtShortOr, fmtYmdKo } from '@/lib/v4/format'
import { tileSizes } from '@/lib/v4/stock-view'
import '../pages.css'

type StocksResponse = {
  scope: 'admin' | 'staff'
  period: PeriodDays
  range: { start: string; end: string }
  previousRange: { start: string; end: string }
  items: StockAggregate[]
  totals: { stockCount: number; videoCount: number }
  error?: string
}

type SortKey = StocksFilters['sort']

const TILE_COUNT = 12
const PAGE_SIZE = 10
const MORE_SIZE = 20
const LOAD_ERROR = '종목 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
const ROW_STYLE = { '--cols': '32px minmax(130px, 2fr) 70px 90px 120px 120px' } as CSSProperties
const SORT_LABEL: Record<SortKey, string> = { totalViews: '총 조회수', videoCount: '영상 수', avgViews: '영상당 평균 조회수', changeRatio: '지난 기간 대비 변화' }
const NO_ITEMS: StockAggregate[] = []
const RESET_KEYS: Array<keyof StocksFilters> = ['sort', 'dir', 'q']
const TREND_TEXT = { up: '늘었어요', down: '줄었어요', flat: '비슷해요', new: '새로 등장' } as const

// 화면에 보이는 타일마다 방향(▲▼)을 글자로도 적는다 (색을 못 구분해도 읽히도록)
function trendMark(s: StockAggregate) {
  if (s.trend === 'up') return `▲ ${Math.abs(Math.round(s.changeRatio * 100))}%`
  if (s.trend === 'down') return `▼ ${Math.abs(Math.round(s.changeRatio * 100))}%`
  if (s.trend === 'new') return '새로 등장'
  return '비슷해요'
}

export default function StockTrendsPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 안에 있어야 한다 (Next 16).
  return (
    <Suspense
      fallback={
        <div className="v4p" style={{ padding: 16 }}>
          <SkelTiles count={8} />
        </div>
      }
    >
      <StocksScreen />
    </Suspense>
  )
}

function StocksScreen() {
  const { isAdmin } = useV4Me()
  const { toast, showSuccess, showError } = useToast()
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError

  const { filters, ready, set, reset, shareUrl } = useUrlFilters<StocksFilters>('stocks', STOCKS_SPEC)
  const { period, sort: sortKey, dir, q: queryValue } = filters
  const sortDesc = dir === 'desc'
  const [queryText, setQueryText] = useSearchField(queryValue, (value) => set({ q: value }))
  const [visible, setVisible] = useState(PAGE_SIZE)

  const hasDataRef = useRef(false)
  const { data, stale, error, status, fetching, reload } = useV4Query<StocksResponse>(ready ? `/api/v4/stocks?period=${period}` : null, {
    fallback: LOAD_ERROR,
    onError: (message) => {
      if (hasDataRef.current) showErrorRef.current(message)
    }
  })
  hasDataRef.current = data !== null

  // 검색·정렬은 이미 받은 값으로 화면에서만 처리한다 (다시 요청하지 않는다)
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [period, queryValue, sortKey, dir])

  const items = data?.items ?? NO_ITEMS

  // 다음 할 일: 더 올려 볼 종목 / 접어도 좋은 종목 (팀 평균 대비)
  const advice = useMemo(() => buildStockAdvice(items), [items])
  const byName = useMemo(() => new Map(items.map((s) => [s.stockName, s])), [items])
  const topNames = useMemo(() => new Set(advice.top.filter((n) => !n.reference).map((n) => n.stockName)), [advice])
  const foldNames = useMemo(() => new Set(advice.fold.map((n) => n.stockName)), [advice])
  const multipleOf = (s: StockAggregate) => (advice.teamAvg > 0 ? s.avgViews / advice.teamAvg : null)

  const tiles = useMemo(() => {
    const top = [...items].sort((a, b) => b.totalViews - a.totalViews).slice(0, TILE_COUNT)
    const sizes = tileSizes(top.map((s) => s.totalViews))
    return top.map((stock, i) => ({ stock, size: sizes[i] }))
  }, [items])
  const counts = useMemo(() => {
    let up = 0
    let down = 0
    for (const s of items) {
      if (s.trend === 'up') up += 1
      else if (s.trend === 'down') down += 1
    }
    return { up, down }
  }, [items])

  const rows = useMemo(() => {
    const q = queryValue.trim().toLowerCase()
    const filtered = q ? items.filter((s) => s.stockName.toLowerCase().includes(q)) : items
    return [...filtered].sort((a, b) => {
      const diff = (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]) || b.totalViews - a.totalViews
      return diff || a.stockName.localeCompare(b.stockName, 'ko')
    })
  }, [items, queryValue, sortKey, sortDesc])
  const shown = rows.slice(0, visible)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) set({ dir: sortDesc ? 'asc' : 'desc' })
    else set({ sort: key, dir: 'desc' })
  }

  const head = (key: SortKey, label: string, title?: string) => (
    <SortHead label={label} active={sortKey === key} desc={sortDesc} onClick={() => toggleSort(key)} title={title} />
  )

  const chips: FilterChip[] = []
  if (queryValue) chips.push({ key: 'q', label: `종목 검색: ${queryValue}`, onRemove: () => set({ q: '' }) })
  if (sortKey !== 'totalViews' || dir !== 'desc') {
    chips.push({ key: 'sort', label: `정렬: ${SORT_LABEL[sortKey]} · ${sortDesc ? '높은 순' : '낮은 순'}`, onRemove: () => set({ sort: 'totalViews', dir: 'desc' }) })
  }
  const clearFilters = () => reset(RESET_KEYS)

  const exportCsv = async () => {
    if (rows.length === 0) return
    const [{ buildCsv, csvFilename, csvKstDateTime }, { downloadCsvFile }] = await Promise.all([import('@/lib/v4/csv'), import('@/lib/v4/download')])
    const headers = ['순위', '종목', '영상 수', '총 조회수', '영상당 평균 조회수', '반응 점수(팀 평균 대비 배수)', '직전 기간 총 조회수', '지난 기간 대비 변화(%)', '흐름', '마지막 영상 시각(한국 시간)', '담당자 수', '참고 신호']
    const body = rows.map((s, i) => {
      const m = multipleOf(s)
      return [
        i + 1,
        s.stockName,
        s.videoCount,
        s.totalViews,
        s.avgViews,
        m === null ? '' : Number(m.toFixed(2)),
        s.prevViews,
        s.trend === 'new' ? '' : Number((s.changeRatio * 100).toFixed(1)),
        TREND_TEXT[s.trend],
        csvKstDateTime(s.lastMentionedAt),
        s.ownerCount,
        foldNames.has(s.stockName) ? '접어도 좋아요' : topNames.has(s.stockName) ? '더 올려 보세요' : ''
      ]
    })
    downloadCsvFile(csvFilename(`종목반응_최근${period}일`), buildCsv(headers, body))
    showSuccess(`종목 ${fmtNumber(rows.length)}개를 엑셀 파일로 저장했어요.`)
  }

  const failed = Boolean(error) && (!data || stale)
  const noData = Boolean(data) && !stale && !error && items.length === 0
  const zeroViews = Boolean(data) && !stale && !error && items.length > 0 && items.every((s) => s.totalViews <= 0)
  const scopeText = data?.scope === 'staff' ? '내 영상' : '팀 전체'
  const busy = fetching && stale
  const onSyncMessage = (message: string, tone: 'success' | 'error') => (tone === 'success' ? showSuccess(message) : showError(message))
  const linkPeriod = period

  return (
    <>
      <PageHeader
        title="종목 트렌드"
        subtitle="어떤 종목 영상이 조회수를 끌어오는지 보고, 다음에 뭘 올릴지 정할 수 있어요."
        actions={
          <>
            <CopyLinkButton getUrl={shareUrl} onResult={(ok) => (ok ? showSuccess('이 화면 링크를 복사했어요. 받은 사람도 같은 조건으로 볼 수 있어요.') : showError('링크를 복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.'))} />
            <PeriodToggle value={period} onChange={(next) => set({ period: next })} />
          </>
        }
      />
      <Toast toast={toast} />

      <div className="v4p">
        {failed ? (
          <ErrorPanel message={error} status={status} onRetry={reload} busy={fetching} />
        ) : noData ? (
          <EmptyPanel title="이 기간에 등록된 영상이 아직 없어요">
            이 화면은 종목별로 영상이 몇 개인지, 조회수가 얼마나 나왔는지 보여주고 “다음에 어떤 종목을 올릴지” 알려줘요. 영상을 등록할 때 종목명을 적으면 자동으로 모여요. 기간을 더 길게 바꿔 볼 수도 있어요.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${data.period}일 · ${scopeText} · ${fmtYmdKo(data.range.start)} ~ ${fmtYmdKo(data.range.end)}` : undefined}
              headline={
                advice.top.length > 0 ? (
                  <>
                    이번 기간 반응이 좋은 종목 상위 {advice.top.length}개: <span className="em">{advice.top.map((s) => s.stockName).join(' · ')}</span>
                  </>
                ) : zeroViews ? (
                  '아직 조회수를 받아오지 않았어요'
                ) : (
                  '눈에 띄게 반응이 좋은 종목은 아직 없어요'
                )
              }
            >
              {advice.top.length > 0 ? (
                <>
                  <p className="v4p-hero-detail">
                    <strong>{advice.top[0].sentence}</strong>
                  </p>
                  <ol className="v4p-top3" aria-label="반응이 좋은 종목 순위">
                    {advice.top.map((n, index) => {
                      const s = byName.get(n.stockName)
                      return (
                        <li className={`v4p-top3-item ${index === 0 ? 'first' : ''}`} key={n.stockName}>
                          <div className="v4p-top3-head">
                            <span className="v4p-medal" aria-label={`${index + 1}위`}>{index + 1}</span>
                            <Link className="v4p-top3-name" href={rankingHref({ q: n.stockName, period: linkPeriod })} title={`${n.stockName} — 이 종목 영상 보기`}>
                              {n.stockName}
                            </Link>
                          </div>
                          <div className="v4p-top3-main" title={`영상 1개당 평균 ${fmtNumberOr(n.avgViews)}회`}>
                            {fmtShortOr(n.avgViews)}
                            <small>회 / 영상 1개 · 팀 평균의 {fmtMultiple(n.multiple)}배</small>
                          </div>
                          <div className="v4p-top3-meta">
                            <span>영상 {fmtNumberOr(n.videoCount)}개{n.reference ? ' (1개뿐이라 참고만)' : ''}</span>
                            {s ? <TrendBadge trend={s.trend} ratio={s.changeRatio} /> : null}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </>
              ) : zeroViews ? (
                <>
                  <p className="v4p-hero-detail">영상은 등록되어 있지만 유튜브에서 조회수를 아직 받아오지 않았어요. 조회수를 받아오면 어떤 종목이 잘 나오는지 알려 드려요.</p>
                  <div className="v4p-hero-actions">
                    {isAdmin ? <SyncStatsButton onDone={reload} onMessage={onSyncMessage} /> : <span className="small muted">관리자가 조회수를 받아오면 여기에 나타나요.</span>}
                  </div>
                </>
              ) : (
                <p className="v4p-hero-detail">
                  영상을 {STOCK_TOP_MIN_VIDEOS}개 이상 다뤘고 영상당 평균 조회수가 팀 평균의 {STOCK_TOP_MIN_MULTIPLE}배 이상인 종목이 아직 없어요. 종목마다 영상이 더 쌓이면 추천해 드려요.
                </p>
              )}
            </Hero>

            <KpiRow>
              <Kpi label="다룬 종목" value={`${fmtNumberOr(data?.totals.stockCount)}개`} hint={`이 기간에 영상으로 다룬 종목 수예요. (영상 ${fmtNumberOr(data?.totals.videoCount)}개)`} loading={!data} />
              <Kpi label="뜨는 종목" value={`${fmtNumberOr(counts.up)}개`} hint="지난 기간보다 조회수가 5% 넘게 늘어난 종목이에요." tone={counts.up > 0 ? 'good' : 'neutral'} loading={!data} term="trend" />
              <Kpi label="식는 종목" value={`${fmtNumberOr(counts.down)}개`} hint="지난 기간보다 조회수가 5% 넘게 줄어든 종목이에요." tone={counts.down > 0 ? 'bad' : 'neutral'} loading={!data} />
            </KpiRow>

            <Card title="이번 주 이렇게 해 보세요" sub="팀 평균과 비교해서 더 올려 볼 종목과, 잠시 쉬어도 좋은 종목을 골랐어요. 참고용 제안이에요.">
              {!data ? (
                <SkelTable rows={3} />
              ) : advice.teamAvg <= 0 ? (
                <EmptyPanel title="아직 비교할 조회수가 없어요" action={isAdmin ? <SyncStatsButton onDone={reload} onMessage={onSyncMessage} /> : null}>
                  종목끼리 비교하려면 영상의 조회수가 필요해요. 조회수는 유튜브에서 가져와야 채워져요{isAdmin ? '. 아래 버튼으로 지금 받아올 수 있어요.' : '. 관리자가 받아오면 나타나요.'}
                </EmptyPanel>
              ) : (
                <div className="v4p-advice">
                  <section className="v4p-advice-col">
                    <h4 className="v4p-advice-title good">더 올려 보세요</h4>
                    {advice.top.length === 0 ? (
                      <p className="small muted">기준을 넘는 종목이 아직 없어요.</p>
                    ) : (
                      <ul className="v4p-advice-list">
                        {advice.top.map((n) => (
                          <li key={n.stockName}>
                            <span>{n.sentence}</span>{' '}
                            <Link href={rankingHref({ q: n.stockName, period: linkPeriod })}>영상 보기</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="v4p-advice-col">
                    <h4 className="v4p-advice-title warn">
                      접어도 좋아요 <GlossaryHint term="foldCandidate" />
                    </h4>
                    {advice.fold.length === 0 ? (
                      <p className="small muted">여러 번 다뤘는데 반응이 약한 종목은 아직 없어요.</p>
                    ) : (
                      <ul className="v4p-advice-list">
                        {advice.fold.map((n) => (
                          <li key={n.stockName}>
                            <span>{n.sentence}</span>{' '}
                            <Link href={rankingHref({ q: n.stockName, period: linkPeriod })}>영상 보기</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
              <Formula summary="이 기준은 어떻게 정했나요?">
                <p>
                  <strong>팀 평균</strong> = 이 기간 모든 영상의 조회수 합계 ÷ 영상 수{data ? ` (지금은 영상 1개당 약 ${fmtShortOr(advice.teamAvg)}회)` : ''}. 종목의 “영상당 평균”이 이 값의 몇 배인지가 반응 점수예요.
                </p>
                <p>
                  <strong>더 올려 보세요</strong>: 영상을 {STOCK_TOP_MIN_VIDEOS}개 이상 다뤘고, 반응 점수가 {STOCK_TOP_MIN_MULTIPLE}배 이상인 종목 중 높은 순 최대 3개예요. 영상 1개짜리는 우연일 수 있어 기준에서 뺐어요. (2개 이상 다룬 종목이 없을 때만 1개짜리를 “참고용”으로 보여줘요.)
                </p>
                <p>
                  <strong>접어도 좋아요</strong>: 영상을 {STOCK_FOLD_MIN_VIDEOS}개 이상 다뤘는데도 반응 점수가 {STOCK_FOLD_MAX_MULTIPLE}배({Math.round(STOCK_FOLD_MAX_MULTIPLE * 100)}%) 이하인 종목이에요. 영상이 적으면 판단이 어려워 {STOCK_FOLD_MIN_VIDEOS}개 이상만 봐요.
                </p>
                <p>조회수는 올린 지 오래된 영상일수록 많이 쌓이기 때문에, 이번 기간에 새로 시작한 종목은 실제보다 낮게 보일 수 있어요. 꼭 그래야 한다는 뜻이 아니라 참고 신호로만 써 주세요.</p>
              </Formula>
            </Card>

            <Card title="한눈에 보기" sub={`타일이 클수록 이 기간 총 조회수가 많은 종목이에요. 조회수 상위 ${TILE_COUNT}개만 보여줘요. 타일을 누르면 그 종목 영상 순위로 넘어가요.`}>
              {!data ? (
                <SkelTiles count={8} />
              ) : tiles.length === 0 ? (
                <EmptyPanel title="보여줄 종목이 없어요">
                  종목명이 적힌 영상이 이 기간에 아직 없어요. 영상을 등록할 때 종목명을 적으면 이곳에 타일로 나타나요.
                </EmptyPanel>
              ) : (
                <ul className={`v4p-tiles ${busy ? 'busy' : ''}`} aria-label="종목별 총 조회수 상위">
                  {tiles.map(({ stock: s, size }) => (
                    <li
                      className={`v4p-tile ${size}`}
                      key={s.stockName}
                      title={`${s.stockName} · 영상 ${fmtNumberOr(s.videoCount)}개 · 총 ${fmtNumberOr(s.totalViews)}회 · 지난 기간 대비 ${trendMark(s)} — 누르면 이 종목 영상 순위`}
                    >
                      <Link className="v4p-tile-link" href={s.stockName === NO_STOCK_NAME ? '/v4/ranking' : rankingHref({ q: s.stockName, period: linkPeriod })}>
                        <span className="v4p-tile-name">{s.stockName}</span>
                        <span className="v4p-tile-meta">
                          <span>조회수 {fmtShortOr(s.totalViews)}회</span>
                          <span>영상 {fmtNumberOr(s.videoCount)}개 · {trendMark(s)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="전체 종목 목록"
              sub="열 제목을 누르면 정렬돼요. 위 타일에 없는 종목도 여기서 찾을 수 있어요."
              actions={
                <>
                  <CsvButton onExport={() => void exportCsv()} disabled={!data || rows.length === 0} />
                  <input
                    className="input v4p-search-input"
                    type="search"
                    placeholder="종목 이름으로 찾기"
                    value={queryText}
                    maxLength={60}
                    onChange={(e) => setQueryText(e.target.value)}
                    aria-label="종목 검색"
                  />
                </>
              }
            >
              <div className="v4p-filters v4p-mobile-only">
                <select className="select v4p-sortsel" value={sortKey} onChange={(e) => set({ sort: e.target.value as SortKey })} aria-label="정렬 기준">
                  {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                    <option key={key} value={key}>
                      정렬: {SORT_LABEL[key]}
                    </option>
                  ))}
                </select>
                <Seg
                  label="정렬 방향"
                  value={dir}
                  options={[
                    ['desc', '높은 순'],
                    ['asc', '낮은 순']
                  ]}
                  onChange={(next) => set({ dir: next })}
                />
              </div>
              <ActiveFilters chips={chips} onReset={clearFilters} />
              {!data ? (
                <SkelTable rows={6} />
              ) : rows.length === 0 ? (
                <EmptyPanel
                  title="찾는 종목이 없어요"
                  action={
                    <button type="button" className="button secondary" onClick={clearFilters}>
                      필터 초기화
                    </button>
                  }
                >
                  “{queryValue}”가 들어간 종목이 이 기간 영상에는 없어요. 종목 이름을 다시 확인하거나 기간을 늘려 보세요.
                </EmptyPanel>
              ) : (
                <div className={`v4p-tbl ${busy ? 'busy' : ''}`} role="table" aria-label="종목 목록" aria-busy={busy}>
                  <div className="v4p-tr head" style={ROW_STYLE} role="row">
                    <div role="columnheader">#</div>
                    <div role="columnheader">종목</div>
                    {head('videoCount', '영상 수')}
                    {head('totalViews', '총 조회수')}
                    {head('avgViews', '영상당 평균', '총 조회수 ÷ 영상 수 (괄호는 팀 평균의 몇 배인지, 반응 점수)')}
                    {head('changeRatio', '지난 기간 대비', '직전 같은 길이 기간의 총 조회수와 비교해요')}
                  </div>
                  {shown.map((s, index) => {
                    const m = multipleOf(s)
                    return (
                      <div className="v4p-tr" style={ROW_STYLE} key={s.stockName} role="row">
                        <div className="v4p-cell-rank" role="cell"><span className="v4p-rank">{index + 1}</span></div>
                        <div className="v4p-title-cell" role="cell">
                          {s.stockName === NO_STOCK_NAME ? (
                            <span className="t" title={s.stockName}>{s.stockName}</span>
                          ) : (
                            <Link href={rankingHref({ q: s.stockName, period: linkPeriod })} title={`${s.stockName} — 이 종목 영상 보기`}>
                              {s.stockName}
                            </Link>
                          )}
                          <div className="v4p-sub" title={s.lastMentionedAt ? fmtKstStamp(s.lastMentionedAt) : undefined}>
                            마지막 영상 {fmtKstMonthDay(s.lastMentionedAt)} · 담당 {fmtNumberOr(s.ownerCount)}명
                          </div>
                          {foldNames.has(s.stockName) || topNames.has(s.stockName) ? (
                            <div className="v4p-sub">
                              {foldNames.has(s.stockName) ? <Badge tone="warn" title="영상을 여러 번 다뤘는데 팀 평균보다 반응이 많이 약해요">접어도 좋아요</Badge> : <Badge tone="good" title="팀 평균보다 반응이 좋아요">더 올려 보세요</Badge>}
                            </div>
                          ) : null}
                        </div>
                        <div className="v4p-td-r" data-label="영상 수" role="cell">{fmtNumberOr(s.videoCount)}개</div>
                        <div className="v4p-td-r v4p-num" data-label="총 조회수" title={`${fmtNumberOr(s.totalViews)}회`} role="cell">{fmtShortOr(s.totalViews)}</div>
                        <div className="v4p-td-r" data-label="영상당 평균" title={`${fmtNumberOr(s.avgViews)}회${m === null ? '' : ` · 팀 평균의 ${fmtMultiple(m)}배`}`} role="cell">
                          {fmtShortOr(s.avgViews)}
                          {m !== null && s.avgViews > 0 ? <span className="v4p-mult"> ({fmtMultiple(m)}배)</span> : null}
                        </div>
                        <div className="v4p-td-r" data-label="지난 기간 대비" role="cell"><TrendBadge trend={s.trend} ratio={s.changeRatio} /></div>
                      </div>
                    )
                  })}
                </div>
              )}
              {data && rows.length > PAGE_SIZE ? (
                <div className="v4p-pager">
                  <span className="small muted" aria-live="polite">전체 {fmtNumberOr(rows.length)}개 중 {fmtNumberOr(shown.length)}개 표시</span>
                  <div className="row" style={{ gap: 8 }}>
                    {visible > PAGE_SIZE ? (
                      <button type="button" className="button secondary" onClick={() => setVisible(PAGE_SIZE)}>
                        접기
                      </button>
                    ) : null}
                    {rows.length > visible ? (
                      <button type="button" className="button secondary" onClick={() => setVisible((v) => v + MORE_SIZE)}>
                        더 보기 ({fmtNumberOr(Math.min(MORE_SIZE, rows.length - visible))}개 더)
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <Formula>
                <p>영상당 평균 = 종목의 총 조회수 ÷ 그 종목 영상 수. 괄호 안 “배”는 팀 평균과 비교한 값(반응 점수)이에요. 영상이 1개뿐인 종목은 우연일 수 있어서, 영상이 2개 이상인 종목만 “더 올려 보세요”로 골라요.</p>
                <p>지난 기간 대비 = (이번 기간 총 조회수 − 직전 같은 길이 기간 총 조회수) ÷ 직전 기간 총 조회수. 비교 기간: {data ? `${fmtYmdKo(data.previousRange.start)} ~ ${fmtYmdKo(data.previousRange.end)}` : '직전 같은 길이'}.</p>
                <p>±5% 이내는 &quot;비슷해요&quot;, 지난 기간에 영상이 없던 종목은 &quot;새로 등장&quot;으로 표시해요.</p>
                <p>“표를 엑셀 파일로 저장”은 지금 검색·정렬 조건에 맞는 종목 전부를 저장해요.</p>
              </Formula>
              <GlossaryList terms={['reactionScore', 'avgViews', 'trend', 'sample', 'foldCandidate']} />
            </Card>
          </>
        )}
      </div>
    </>
  )
}
