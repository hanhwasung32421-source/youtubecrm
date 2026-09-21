'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import type { Kpis, PeriodDays, StaffStat } from '@/lib/v4/analytics'
import { Badge, BarRow, Card, EmptyPanel, ErrorPanel, Formula, Hero, Kpi, KpiRow, MiniBars, Seg, SkelRows } from '@/lib/v4/analysis-ui'
import { fmtNumber, fmtPercent, fmtShort, shortYmd } from '@/lib/v4/format'
import { addDaysToYmd, getKstYmd } from '@/lib/attendance/time'
import '../pages.css'

type StaffResponse = {
  period: PeriodDays
  range: { start: string; end: string }
  rows: StaffStat[]
  team: Kpis
  error?: string
}

type Metric = 'totalViews' | 'videoCount' | 'avgViews'

const METRIC_LABEL: Record<Metric, string> = { totalViews: '조회수 합계', videoCount: '올린 영상 수', avgViews: '영상당 평균 조회수' }
const ROW_STYLE = { '--cols': '36px minmax(90px, 1.2fr) 68px 96px 96px minmax(120px, 1.4fr) 80px 76px' } as CSSProperties

const unit = (metric: Metric, value: number) => (metric === 'videoCount' ? `${fmtNumber(value)}개` : `${fmtShort(value)}회`)

export default function StaffComparisonPage() {
  const { toast, showError } = useToast()
  const [period, setPeriod] = useState<PeriodDays>(30)
  const [data, setData] = useState<StaffResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [metric, setMetric] = useState<Metric>('totalViews')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError('')
      const { ok, status, data: res } = await authedFetchJson<StaffResponse>(`/api/v4/staff?period=${period}`)
      if (cancelled) return
      setLoading(false)
      if (!ok || res?.error) {
        if (status === 403) {
          setForbidden(true)
          return
        }
        const message = res?.error || '담당자별 성과를 불러오지 못했습니다.'
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

  const rows = useMemo(() => data?.rows ?? [], [data])
  const active = useMemo(() => rows.filter((r) => r.videoCount > 0), [rows])
  const idle = useMemo(() => rows.filter((r) => r.videoCount === 0), [rows])

  // 총 조회수 1위 / 영상당 평균 1위
  const leader = useMemo(() => [...rows].sort((a, b) => b.totalViews - a.totalViews)[0] ?? null, [rows])
  const avgLeader = useMemo(() => [...active].sort((a, b) => b.avgViews - a.avgViews)[0] ?? null, [active])

  const bars = useMemo(() => {
    const pool = metric === 'avgViews' ? active : rows
    return [...pool].sort((a, b) => b[metric] - a[metric])
  }, [rows, active, metric])
  const barMax = bars[0]?.[metric] ?? 0

  // 막대 위 한 문장
  const sentence = useMemo(() => {
    const first = bars[0]
    if (!first || first[metric] <= 0) return '아직 비교할 기록이 없어요.'
    const second = bars[1]
    const gap = second ? first[metric] - second[metric] : 0
    if (metric === 'totalViews')
      return `${first.name}님이 조회수 합계 ${fmtShort(first.totalViews)}회로 앞서 있어요.${second && gap > 0 ? ` 2위 ${second.name}님과는 ${fmtShort(gap)}회 차이예요.` : ''}`
    if (metric === 'videoCount')
      return `${first.name}님이 ${fmtNumber(first.videoCount)}개로 가장 많이 올렸어요.${second && gap > 0 ? ` 2위 ${second.name}님보다 ${fmtNumber(gap)}개 많아요.` : ''}`
    return `${first.name}님 영상이 1개당 평균 ${fmtShort(first.avgViews)}회로 가장 잘 나와요. (영상을 올린 담당자끼리 비교)`
  }, [bars, metric])

  const last7Labels = useMemo(() => {
    if (!data) return undefined
    const end = data.range.end || getKstYmd()
    return Array.from({ length: 7 }, (_, i) => shortYmd(addDaysToYmd(end, i - 6)))
  }, [data])

  const teamCount = rows.length
  const noData = !loading && !error && !forbidden && data !== null && rows.length === 0

  return (
    <>
      <PageHeader
        title="담당자 성과 비교"
        subtitle="담당자별로 얼마나 올리고 얼마나 조회됐는지 비교합니다."
        actions={<PeriodToggle value={period} onChange={setPeriod} disabled={loading || forbidden} />}
      />
      <Toast toast={toast} />

      <div className="v4p">
        {forbidden ? (
          <EmptyPanel title="관리자만 볼 수 있는 화면이에요" action={null}>
            담당자끼리 성과를 비교하는 화면이라 관리자 계정에서만 열려요. 내 영상 성과는 &quot;콘텐츠 성과 랭킹&quot;에서 확인할 수 있어요.
          </EmptyPanel>
        ) : error && !data ? (
          <ErrorPanel message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : noData ? (
          <EmptyPanel title="비교할 담당자가 아직 없어요">
            이 화면은 담당자별로 올린 영상 수와 조회수를 나란히 보여줘요. 직원 계정이 만들어지고 영상이 등록되면 여기에 나타납니다.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${period}일 · ${data.range.start} ~ ${data.range.end}` : undefined}
              headline={
                leader && leader.totalViews > 0 ? (
                  <>
                    이번 기간 가장 성과가 좋은 담당자: <span className="em">{leader.name}님</span>
                  </>
                ) : (
                  '아직 이 기간에 조회수가 쌓인 담당자가 없어요'
                )
              }
            >
              {leader && leader.totalViews > 0 ? (
                <p className="v4p-hero-detail">
                  {leader.name}님이 영상 {fmtNumber(leader.videoCount)}개로 조회수 합계 <strong>{fmtShort(leader.totalViews)}회</strong>를 기록했어요.
                  {avgLeader && avgLeader.userId !== leader.userId ? (
                    <> 영상 1개당 평균은 <strong>{avgLeader.name}님</strong>이 {fmtShort(avgLeader.avgViews)}회로 가장 높아요.</>
                  ) : null}
                </p>
              ) : null}
              {idle.length > 0 ? (
                <div className="v4p-hero-note bad">
                  이 기간에 영상을 하나도 올리지 않은 담당자: <strong>{idle.map((s) => s.name).join(', ')}</strong>. 확인해 보세요.
                </div>
              ) : null}
            </Hero>

            <KpiRow>
              <Kpi label="팀 조회수 합계" value={`${fmtShort(data?.team.totalViews)}회`} hint="모든 담당자가 올린 영상이 받은 조회수를 더한 값이에요." loading={!data} />
              <Kpi
                label="팀이 올린 영상"
                value={`${fmtNumber(data?.team.videoCount)}개`}
                hint={`담당자 ${fmtNumber(teamCount)}명, 1인 평균 ${teamCount ? (((data?.team.videoCount ?? 0) / teamCount)).toFixed(1) : '0'}개예요.`}
                loading={!data}
              />
              <Kpi label="영상 1개당 평균 조회수" value={`${fmtShort(data?.team.avgViews)}회`} hint="팀 전체의 보통 수준이에요. 담당자별 평균과 비교해 보세요." loading={!data} />
            </KpiRow>

            <Card
              title="담당자 비교"
              sub={sentence}
              actions={<Seg label="비교 기준" value={metric} options={(Object.keys(METRIC_LABEL) as Metric[]).map((k) => [k, METRIC_LABEL[k]])} onChange={setMetric} />}
            >
              {!data ? (
                <SkelRows rows={4} />
              ) : (
                <div className="v4p-bars">
                  {bars.map((row, index) => (
                    <BarRow
                      key={row.userId}
                      label={row.name}
                      value={row[metric]}
                      max={barMax}
                      valueText={unit(metric, row[metric])}
                      sub={metric === 'videoCount' ? `조회수 ${fmtShort(row.totalViews)}회` : `영상 ${fmtNumber(row.videoCount)}개`}
                      leader={index === 0 && row[metric] > 0}
                    />
                  ))}
                </div>
              )}
              {metric === 'avgViews' && data && idle.length > 0 ? <p className="small muted" style={{ marginTop: 10 }}>영상을 올리지 않은 담당자는 이 비교에서 뺐어요.</p> : null}
            </Card>

            <Card title="담당자별 자세히 보기" sub="조회수 합계가 높은 순이에요. 막대 7개는 최근 7일 동안 하루에 몇 개 올렸는지 보여줘요.">
              {!data ? (
                <SkelRows rows={4} />
              ) : (
                <div className={`v4p-tbl ${loading ? 'busy' : ''}`} role="table" aria-label="담당자별 상세">
                  <div className="v4p-tr head" style={ROW_STYLE} role="row">
                    <div role="columnheader">순위</div>
                    <div role="columnheader">담당자</div>
                    <div className="v4p-td-r" role="columnheader">영상 수</div>
                    <div className="v4p-td-r" role="columnheader">조회수 합계</div>
                    <div className="v4p-td-r" role="columnheader">영상당 평균</div>
                    <div role="columnheader">롱폼 / 숏폼</div>
                    <div className="v4p-td-r" role="columnheader" title="조회수 대비 좋아요 수">좋아요 비율</div>
                    <div role="columnheader">최근 7일</div>
                  </div>
                  {rows.map((row) => (
                    <div className="v4p-tr" style={ROW_STYLE} key={row.userId} role="row">
                      <div role="cell">
                        <span className={`v4p-rank ${row.rank <= 3 && row.totalViews > 0 ? 'top' : ''}`}>{row.rank}</span>
                      </div>
                      <div role="cell" style={{ minWidth: 0 }}>
                        <div className="v4p-ellipsis" style={{ fontWeight: 700 }}>{row.name}</div>
                        {row.videoCount === 0 ? <Badge tone="bad">업로드 없음</Badge> : null}
                      </div>
                      <div className="v4p-td-r" role="cell">{fmtNumber(row.videoCount)}개</div>
                      <div className="v4p-td-r v4p-num" title={`${fmtNumber(row.totalViews)}회`} role="cell">{fmtShort(row.totalViews)}</div>
                      <div className="v4p-td-r" title={`${fmtNumber(row.avgViews)}회`} role="cell">{row.videoCount > 0 ? fmtShort(row.avgViews) : '-'}</div>
                      <div role="cell">
                        {row.videoCount > 0 ? (
                          <>
                            <div className="small">롱폼 {fmtNumber(row.longformCount)} · 숏폼 {fmtNumber(row.shortformCount)}</div>
                            <div className="v4p-share" aria-hidden="true">
                              <span style={{ width: `${row.longformShare * 100}%` }} />
                              <span style={{ width: `${(1 - row.longformShare) * 100}%` }} />
                            </div>
                          </>
                        ) : (
                          <span className="muted small">-</span>
                        )}
                      </div>
                      <div className="v4p-td-r" role="cell">{row.videoCount > 0 ? fmtPercent(row.likeRate, 1) : '-'}</div>
                      <div role="cell"><MiniBars values={row.sparkline} labels={last7Labels} /></div>
                    </div>
                  ))}
                </div>
              )}
              <Formula>
                <p>영상당 평균 = 조회수 합계 ÷ 올린 영상 수. 많이 올린 사람과 적게 올린 사람을 공평하게 비교할 때 써요.</p>
                <p>좋아요 비율 = 좋아요 수 ÷ 조회수. 영상을 본 사람 중 좋아요를 누른 비율이에요.</p>
                <p>순위는 조회수 합계 기준이고, 롱폼 = 긴 영상, 숏폼 = 짧은 영상이에요.</p>
              </Formula>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
