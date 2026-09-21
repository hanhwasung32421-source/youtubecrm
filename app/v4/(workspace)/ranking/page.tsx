'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { v4Fetch } from '@/lib/v4/client'
import { isPeriodValue, useStoredState } from '@/lib/v4/use-stored-state'
import type { PeriodDays, RankedVideo } from '@/lib/v4/analytics'
import { Card, EmptyPanel, ErrorPanel, FormatBadge, Formula, Hero, Kpi, KpiRow, Seg, SkelRows, SortHead } from '@/lib/v4/analysis-ui'
import { fmtDateKst, fmtNumber, fmtPercent, fmtShort } from '@/lib/v4/format'
import '../pages.css'

type RankingResponse = {
  scope: 'admin' | 'staff'
  period: PeriodDays
  range: { start: string; end: string }
  items: RankedVideo[]
  staffOptions: Array<{ id: string; name: string }>
  error?: string
}

type SortKey = 'viewCount' | 'likeCount' | 'commentCount' | 'daysSincePublished' | 'velocity' | 'likeRate'

const PAGE_SIZE = 10

export default function ContentRankingPage() {
  const { isAdmin } = useV4Me()
  const { toast, showError } = useToast()
  const [period, setPeriod, ready] = useStoredState<PeriodDays>('v4:ranking:period', 30, isPeriodValue)
  const [data, setData] = useState<RankingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('viewCount')
  const [sortDesc, setSortDesc] = useState(true)
  // 마지막에 고른 담당자/형식/자세히 보기는 다음에 열 때도 유지한다 (저장된 담당자가 목록에 없으면 무시).
  const [storedStaffId, setStaffId] = useStoredState<string>('v4:ranking:staff', '')
  const [format, setFormat] = useStoredState<string>('v4:ranking:format', '', (v): v is string => v === '' || v === 'longform' || v === 'shortform')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [detail, setDetail] = useStoredState<boolean>('v4:ranking:detail', false)
  const staffId = storedStaffId && data && !data.staffOptions.some((s) => s.id === storedStaffId) ? '' : storedStaffId

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError('')
      const result = await v4Fetch<RankingResponse>(`/api/v4/ranking?period=${period}`, {}, '영상 순위를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        // 이미 화면에 값이 있으면 그대로 두고 알림만, 처음부터 실패했으면 다시 불러오기 화면
        setError(result.message)
        showError(result.message)
        return
      }
      setData(result.data)
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, reloadKey, ready])

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [period, staffId, format, query, sortKey, sortDesc])

  const items = useMemo(() => data?.items ?? [], [data])

  // ---- 답: 가장 잘 나가는 영상 / 요즘 빠르게 오르는 영상
  const top = useMemo(() => {
    let best: RankedVideo | null = null
    for (const v of items) if (v.viewCount > 0 && (!best || v.viewCount > best.viewCount)) best = v
    return best
  }, [items])

  const rising = useMemo(() => {
    const recent = items.filter((v) => v.daysSincePublished <= 7 && v.viewCount > 0 && v.id !== top?.id)
    return recent.sort((a, b) => b.velocity - a.velocity)[0] ?? null
  }, [items, top])

  const totals = useMemo(() => {
    const totalViews = items.reduce((s, v) => s + v.viewCount, 0)
    return { totalViews, avg: items.length ? Math.round(totalViews / items.length) : 0 }
  }, [items])

  // ---- 표
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items.filter((v) => {
      if (staffId && v.ownerId !== staffId) return false
      if (format && v.contentType !== format) return false
      if (q && !v.stockName.toLowerCase().includes(q) && !v.title.toLowerCase().includes(q)) return false
      return true
    })
    return [...filtered].sort((a, b) => (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]))
  }, [items, staffId, format, query, sortKey, sortDesc])

  const shown = rows.slice(0, visible)
  const filtered = Boolean(staffId || format || query.trim())

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((v) => !v)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const clearFilters = () => {
    setStaffId('')
    setFormat('')
    setQuery('')
  }

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

  const sortHead = (key: SortKey, label: string, title?: string) => (
    <SortHead label={label} active={sortKey === key} desc={sortDesc} onClick={() => toggleSort(key)} title={title} />
  )

  const noData = !loading && !error && items.length === 0
  const scopeText = data?.scope === 'staff' ? '내 영상' : '팀 전체'

  return (
    <>
      <PageHeader
        title="콘텐츠 성과 랭킹"
        subtitle="어떤 영상이 잘 나가고 있는지 한눈에 봅니다."
        actions={<PeriodToggle value={period} onChange={setPeriod} disabled={loading} />}
      />
      <Toast toast={toast} />

      <div className="v4p">
        {error && !data ? (
          <ErrorPanel message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : noData ? (
          <EmptyPanel title="이 기간에 등록된 영상이 아직 없어요">
            이 화면은 등록한 영상을 조회수 순으로 보여줘요. 영상을 등록하면 유튜브에서 조회수를 자동으로 가져와 여기에 순위가 나타납니다. 기간을 더 길게 바꿔 볼 수도 있어요.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${period}일 · ${scopeText} · ${data.range.start} ~ ${data.range.end}` : undefined}
              headline={top ? <>지금 가장 잘 나가는 영상: <span className="em">{top.title}</span></> : '아직 조회수가 쌓인 영상이 없어요'}
            >
              {top ? (
                <p className="v4p-hero-detail">
                  <strong>{top.stockName}</strong>
                  {isAdmin ? <> · {top.ownerName} 담당</> : null} · 조회수 <strong title={`${fmtNumber(top.viewCount)}회`}>{fmtShort(top.viewCount)}회</strong>
                  {' '}(하루 평균 {fmtNumber(top.velocity)}회)
                  {top.youtubeUrl ? (
                    <>
                      {' · '}
                      <a href={top.youtubeUrl} target="_blank" rel="noopener noreferrer">
                        유튜브에서 보기 ↗
                      </a>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="v4p-hero-detail">영상은 등록되어 있지만 조회수가 아직 0이에요. 조회수는 유튜브에서 자동으로 가져오니 조금 기다려 보세요.</p>
              )}
              {rising ? (
                <div className="v4p-hero-note plain">
                  요즘 빠르게 오르는 영상: <strong>{rising.title}</strong> — 올린 지 {fmtNumber(rising.daysSincePublished)}일 만에 {fmtShort(rising.viewCount)}회 ({rising.stockName})
                </div>
              ) : null}
            </Hero>

            <KpiRow>
              <Kpi label="등록한 영상" value={`${fmtNumber(items.length)}개`} hint="이 기간에 등록된 영상의 수예요." loading={!data} />
              <Kpi label="총 조회수" value={`${fmtShort(totals.totalViews)}회`} hint="이 영상들이 지금까지 받은 조회수를 모두 더한 값이에요." loading={!data} />
              <Kpi label="영상 1개당 평균 조회수" value={`${fmtShort(totals.avg)}회`} hint="이 숫자보다 높으면 평균 이상으로 잘 나가는 영상이에요." loading={!data} />
            </KpiRow>

            <Card
              title="영상 순위"
              sub="기본은 조회수가 많은 순 Top 10이에요. 제목을 누르면 유튜브가 열려요."
              actions={
                <label className="v4p-toggle">
                  <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
                  좋아요·댓글 등 자세히 보기
                </label>
              }
            >
              <div className="v4p-filters">
                <input className="input search" placeholder="종목이나 제목으로 찾기 (예: 삼성전자)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="종목 또는 제목 검색" />
                {isAdmin ? (
                  <select className="select" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="담당자">
                    <option value="">담당자 전체</option>
                    {(data?.staffOptions ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select className="select" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="영상 형식">
                  <option value="">롱폼·숏폼 모두</option>
                  <option value="longform">롱폼만</option>
                  <option value="shortform">숏폼만</option>
                </select>
                <Seg
                  label="정렬 방향"
                  value={sortKey === 'viewCount' ? (sortDesc ? 'desc' : 'asc') : null}
                  options={[
                    ['desc', '잘 나가는 순'],
                    ['asc', '반응 약한 순']
                  ]}
                  onChange={(next) => {
                    setSortKey('viewCount')
                    setSortDesc(next === 'desc')
                  }}
                />
                {filtered ? (
                  <button type="button" className="v4p-link-btn" onClick={clearFilters}>
                    필터 지우기
                  </button>
                ) : null}
              </div>

              {!data ? (
                <SkelRows rows={6} />
              ) : rows.length === 0 ? (
                <EmptyPanel
                  title="조건에 맞는 영상이 없어요"
                  action={
                    <button type="button" className="button secondary" onClick={clearFilters}>
                      필터 지우기
                    </button>
                  }
                >
                  검색어나 담당자, 형식을 바꿔 보세요.
                </EmptyPanel>
              ) : (
                <div className={`v4p-tbl ${loading ? 'busy' : ''}`} role="table" aria-label="영상 순위">
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
                  {shown.map((row, index) => (
                    <div className="v4p-tr" style={rowStyle} key={row.id} role="row">
                      <div role="cell">
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
                        <div className="v4p-sub">게시 {fmtDateKst(row.publishedAt || row.createdAt)}</div>
                      </div>
                      <div className="v4p-ellipsis" title={row.stockName} role="cell">{row.stockName}</div>
                      {has('owner') ? <div className="v4p-ellipsis" role="cell">{row.ownerName}</div> : null}
                      <div className="v4p-td-r v4p-num" title={`${fmtNumber(row.viewCount)}회`} role="cell">{fmtNumber(row.viewCount)}</div>
                      <div className="v4p-td-r" role="cell">{fmtNumber(row.velocity)}회/일</div>
                      {has('format') ? <div role="cell"><FormatBadge contentType={row.contentType} /></div> : null}
                      {has('like') ? <div className="v4p-td-r" role="cell">{fmtNumber(row.likeCount)}</div> : null}
                      {has('comment') ? <div className="v4p-td-r" role="cell">{fmtNumber(row.commentCount)}</div> : null}
                      {has('days') ? <div className="v4p-td-r" role="cell">{fmtNumber(row.daysSincePublished)}일</div> : null}
                      {has('rate') ? <div className="v4p-td-r" role="cell">{fmtPercent(row.likeRate, 1)}</div> : null}
                    </div>
                  ))}
                </div>
              )}

              {data && rows.length > 0 ? (
                <div className="v4p-pager">
                  <span className="small muted">
                    {filtered ? `조건에 맞는 영상 ${fmtNumber(rows.length)}개 중 ` : `전체 ${fmtNumber(rows.length)}개 중 `}
                    {fmtNumber(shown.length)}개 표시
                  </span>
                  <div className="row" style={{ gap: 8 }}>
                    {visible > PAGE_SIZE ? (
                      <button type="button" className="button secondary" onClick={() => setVisible(PAGE_SIZE)}>
                        접기
                      </button>
                    ) : null}
                    {rows.length > visible ? (
                      <button type="button" className="button secondary" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                        더 보기 ({fmtNumber(Math.min(PAGE_SIZE, rows.length - visible))}개 더)
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <Formula>
                <p>조회 속도 = 조회수 ÷ 올린 뒤 지난 날짜(최소 1일). 하루에 평균 몇 번 봤는지를 뜻해요. 최근에 올린 영상도 공정하게 비교할 수 있어요.</p>
                <p>좋아요 비율 = 좋아요 수 ÷ 조회수. 영상을 본 사람 중 얼마나 좋아요를 눌렀는지 보여줘요.</p>
                <p>올린 날짜는 유튜브 게시일 기준이고, 없으면 CRM에 등록한 시각을 씁니다.</p>
              </Formula>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
