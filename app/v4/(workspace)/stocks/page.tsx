'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import type { PeriodDays, StockAggregate } from '@/lib/v4/analytics'
import { Card, EmptyPanel, ErrorPanel, Formula, Hero, Kpi, KpiRow, SkelRows, SortHead, TrendBadge } from '@/lib/v4/analysis-ui'
import { fmtDateKst, fmtNumber, fmtShort } from '@/lib/v4/format'
import '../pages.css'

type StocksResponse = {
  scope: 'admin' | 'staff'
  period: PeriodDays
  range: { start: string; end: string }
  previousRange: { start: string; end: string }
  items: StockAggregate[]
  top5Recent: Array<{ stockName: string; videoCount: number; totalViews: number; avgViews: number }>
  totals: { stockCount: number; videoCount: number }
  error?: string
}

type SortKey = 'videoCount' | 'totalViews' | 'avgViews' | 'changeRatio'

const NO_STOCK = '(종목 미지정)'
const TILE_COUNT = 12
const PAGE_SIZE = 10
const ROW_STYLE = { '--cols': '32px minmax(130px, 2fr) 70px 90px 96px 120px' } as CSSProperties

// 타일 크기는 "지금 보이는 상위 12개" 안에서의 순위로 정한다 (종목이 많아도 화면이 커지지 않게).
function tileSize(rank: number): 'xl' | 'lg' | 'md' | 'sm' {
  if (rank === 0) return 'xl'
  if (rank <= 2) return 'lg'
  if (rank <= 5) return 'md'
  return 'sm'
}

export default function StockTrendsPage() {
  const { toast, showError } = useToast()
  const [period, setPeriod] = useState<PeriodDays>(30)
  const [data, setData] = useState<StocksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('totalViews')
  const [sortDesc, setSortDesc] = useState(true)
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError('')
      const { ok, data: res } = await authedFetchJson<StocksResponse>(`/api/v4/stocks?period=${period}`)
      if (cancelled) return
      setLoading(false)
      if (!ok || res?.error) {
        const message = res?.error || '종목 정보를 불러오지 못했습니다.'
        setError(message)
        showError(message)
        return
      }
      setData(res)
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, reloadKey])

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [period, query, sortKey, sortDesc])

  const items = useMemo(() => data?.items ?? [], [data])

  // 반응 좋은 종목 Top 3: 영상 1개당 평균 조회수 기준. 영상이 2개 이상인 종목이 3개 이상이면 그중에서만 뽑는다.
  const best = useMemo(() => {
    const pool = items.filter((s) => s.stockName !== NO_STOCK && s.totalViews > 0)
    const multi = pool.filter((s) => s.videoCount >= 2)
    const source = multi.length >= 3 ? multi : pool
    return [...source].sort((a, b) => b.avgViews - a.avgViews || b.totalViews - a.totalViews).slice(0, 3)
  }, [items])

  const tiles = useMemo(() => [...items].sort((a, b) => b.totalViews - a.totalViews).slice(0, TILE_COUNT), [items])
  const upCount = useMemo(() => items.filter((s) => s.trend === 'up').length, [items])
  const downCount = useMemo(() => items.filter((s) => s.trend === 'down').length, [items])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? items.filter((s) => s.stockName.toLowerCase().includes(q)) : items
    return [...filtered].sort((a, b) => (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]))
  }, [items, query, sortKey, sortDesc])
  const shown = rows.slice(0, visible)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((v) => !v)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const head = (key: SortKey, label: string, title?: string) => (
    <SortHead label={label} active={sortKey === key} desc={sortDesc} onClick={() => toggleSort(key)} title={title} />
  )

  const noData = !loading && !error && items.length === 0
  const scopeText = data?.scope === 'staff' ? '내 영상' : '팀 전체'

  return (
    <>
      <PageHeader
        title="종목 트렌드"
        subtitle="어떤 종목 영상이 조회수를 끌어오는지 봅니다."
        actions={<PeriodToggle value={period} onChange={setPeriod} disabled={loading} />}
      />
      <Toast toast={toast} />

      <div className="v4p">
        {error && !data ? (
          <ErrorPanel message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : noData ? (
          <EmptyPanel title="이 기간에 등록된 영상이 아직 없어요">
            이 화면은 종목별로 영상이 몇 개인지, 조회수가 얼마나 나왔는지 보여줘요. 영상을 등록할 때 종목명을 적으면 자동으로 모입니다.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${period}일 · ${scopeText} · ${data.range.start} ~ ${data.range.end}` : undefined}
              headline={
                best.length > 0 ? (
                  <>
                    이번 기간 반응이 좋은 종목 Top {best.length}: <span className="em">{best.map((s) => s.stockName).join(' · ')}</span>
                  </>
                ) : (
                  '아직 조회수가 쌓인 종목이 없어요'
                )
              }
            >
              {best.length > 0 ? (
                <>
                  <p className="v4p-hero-detail">
                    <strong>{best[0].stockName}</strong> 영상이 1개당 평균 <strong>{fmtShort(best[0].avgViews)}회</strong> 조회돼서 가장 반응이 좋았어요. 이런 종목을 더 자주 다뤄 보세요.
                  </p>
                  <div className="v4p-top3">
                    {best.map((s, index) => (
                      <div className={`v4p-top3-item ${index === 0 ? 'first' : ''}`} key={s.stockName}>
                        <div className="v4p-top3-head">
                          <span className="v4p-medal">{index + 1}</span>
                          <span className="v4p-top3-name" title={s.stockName}>{s.stockName}</span>
                        </div>
                        <div className="v4p-top3-main" title={`영상 1개당 평균 ${fmtNumber(s.avgViews)}회`}>
                          {fmtShort(s.avgViews)}
                          <small>회 / 영상 1개</small>
                        </div>
                        <div className="v4p-top3-meta">
                          <span>영상 {fmtNumber(s.videoCount)}개{s.videoCount === 1 ? ' (1개뿐이라 참고만)' : ''}</span>
                          <TrendBadge trend={s.trend} ratio={s.changeRatio} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="v4p-hero-detail">영상은 있지만 조회수가 아직 없어요. 조회수는 유튜브에서 자동으로 가져오니 조금 기다려 보세요.</p>
              )}
            </Hero>

            <KpiRow>
              <Kpi label="다룬 종목" value={`${fmtNumber(data?.totals.stockCount)}개`} hint={`이 기간에 영상으로 다룬 종목 수예요. (영상 ${fmtNumber(data?.totals.videoCount)}개)`} loading={!data} />
              <Kpi label="뜨는 종목" value={`${fmtNumber(upCount)}개`} hint="지난 기간보다 조회수가 5% 넘게 늘어난 종목이에요." tone={upCount > 0 ? 'good' : 'neutral'} loading={!data} />
              <Kpi label="식는 종목" value={`${fmtNumber(downCount)}개`} hint="지난 기간보다 조회수가 5% 넘게 줄어든 종목이에요." tone={downCount > 0 ? 'bad' : 'neutral'} loading={!data} />
            </KpiRow>

            <Card title="한눈에 보기" sub={`타일이 클수록 이 기간 총 조회수가 많은 종목이에요. 조회수 상위 ${TILE_COUNT}개만 보여줘요.`}>
              {!data ? (
                <SkelRows rows={3} />
              ) : (
                <div className="v4p-tiles">
                  {tiles.map((s, index) => (
                    <div className={`v4p-tile ${tileSize(index)}`} key={s.stockName} title={`${s.stockName} · 영상 ${fmtNumber(s.videoCount)}개 · 총 ${fmtNumber(s.totalViews)}회`}>
                      <div className="v4p-tile-name">{s.stockName}</div>
                      <div className="v4p-tile-meta">
                        <span>조회수 {fmtShort(s.totalViews)}회</span>
                        <span>영상 {fmtNumber(s.videoCount)}개</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="전체 종목 목록"
              sub="열 제목을 누르면 정렬돼요. 위 타일에 없는 종목도 여기서 찾을 수 있어요."
              actions={<input className="input" style={{ width: 220, padding: '8px 12px' }} placeholder="종목 이름으로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="종목 검색" />}
            >
              {!data ? (
                <SkelRows rows={5} />
              ) : rows.length === 0 ? (
                <EmptyPanel title="찾는 종목이 없어요" action={null}>
                  종목 이름을 다시 확인해 주세요. 이 기간에 영상이 없는 종목은 나타나지 않아요.
                </EmptyPanel>
              ) : (
                <div className={`v4p-tbl ${loading ? 'busy' : ''}`} role="table" aria-label="종목 목록">
                  <div className="v4p-tr head" style={ROW_STYLE} role="row">
                    <div role="columnheader">#</div>
                    <div role="columnheader">종목</div>
                    {head('videoCount', '영상 수')}
                    {head('totalViews', '총 조회수')}
                    {head('avgViews', '영상당 평균', '총 조회수 ÷ 영상 수')}
                    {head('changeRatio', '지난 기간 대비', '직전 같은 길이 기간의 총 조회수와 비교해요')}
                  </div>
                  {shown.map((s, index) => (
                    <div className="v4p-tr" style={ROW_STYLE} key={s.stockName} role="row">
                      <div role="cell"><span className="v4p-rank">{index + 1}</span></div>
                      <div className="v4p-title-cell" role="cell">
                        <span className="t" title={s.stockName}>{s.stockName}</span>
                        <div className="v4p-sub">마지막 영상 {fmtDateKst(s.lastMentionedAt)} · 담당 {fmtNumber(s.ownerCount)}명</div>
                      </div>
                      <div className="v4p-td-r" role="cell">{fmtNumber(s.videoCount)}개</div>
                      <div className="v4p-td-r v4p-num" title={`${fmtNumber(s.totalViews)}회`} role="cell">{fmtShort(s.totalViews)}</div>
                      <div className="v4p-td-r" title={`${fmtNumber(s.avgViews)}회`} role="cell">{fmtShort(s.avgViews)}</div>
                      <div className="v4p-td-r" role="cell"><TrendBadge trend={s.trend} ratio={s.changeRatio} /></div>
                    </div>
                  ))}
                </div>
              )}
              {data && rows.length > PAGE_SIZE ? (
                <div className="v4p-pager">
                  <span className="small muted">전체 {fmtNumber(rows.length)}개 중 {fmtNumber(shown.length)}개 표시</span>
                  <div className="row" style={{ gap: 8 }}>
                    {visible > PAGE_SIZE ? (
                      <button type="button" className="button secondary" onClick={() => setVisible(PAGE_SIZE)}>
                        접기
                      </button>
                    ) : null}
                    {rows.length > visible ? (
                      <button type="button" className="button secondary" onClick={() => setVisible((v) => v + 20)}>
                        더 보기
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <Formula>
                <p>영상당 평균 = 종목의 총 조회수 ÷ 그 종목 영상 수. 영상이 1개뿐인 종목은 우연일 수 있어서, 영상이 2개 이상인 종목이 3개 이상이면 그중에서만 Top 3를 뽑아요.</p>
                <p>지난 기간 대비 = (이번 기간 총 조회수 − 직전 같은 길이 기간 총 조회수) ÷ 직전 기간 총 조회수. 비교 기간: {data ? `${data.previousRange.start} ~ ${data.previousRange.end}` : '직전 같은 길이'}.</p>
                <p>±5% 이내는 &quot;비슷해요&quot;, 지난 기간에 영상이 없던 종목은 &quot;새로 등장&quot;으로 표시해요.</p>
              </Formula>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
