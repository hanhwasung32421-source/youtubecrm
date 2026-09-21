'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { v4Fetch } from '@/lib/v4/client'
import { isPeriodValue, useStoredState } from '@/lib/v4/use-stored-state'
import type { HeatCell, PeriodDays } from '@/lib/v4/analytics'
import { BarRow, Card, EmptyPanel, ErrorPanel, Formula, Hero, Kpi, KpiRow, Seg, SkelRows } from '@/lib/v4/analysis-ui'
import { WEEKDAY_LABELS, fmtHourKo, fmtHourRangeKo, fmtNumber, fmtShort } from '@/lib/v4/format'
import '../pages.css'

type TimingResponse = {
  scope: 'admin' | 'staff'
  period: PeriodDays
  range: { start: string; end: string }
  sampleCount: number
  cells: HeatCell[]
  recommendations: HeatCell[]
  maxCount: number
  maxAvg: number
  error?: string
}

type HeatMode = 'avg' | 'count'

// 월요일부터 보여준다 (일 = 0)
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const slotLabel = (c: { weekday: number; hour: number }) => `${WEEKDAY_LABELS[c.weekday]}요일 ${fmtHourRangeKo(c.hour)}`

export default function UploadTimingPage() {
  const { toast, showError } = useToast()
  const [period, setPeriod, ready] = useStoredState<PeriodDays>('v4:timing:period', 30, isPeriodValue)
  const [data, setData] = useState<TimingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [mode, setMode] = useStoredState<HeatMode>('v4:timing:mode', 'avg', (v): v is HeatMode => v === 'avg' || v === 'count')

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError('')
      const result = await v4Fetch<TimingResponse>(`/api/v4/timing?period=${period}`, {}, '업로드 시간대 분석을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
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

  // 추천: API의 추천(같은 칸에 영상 2개 이상)을 우선, 없으면 1개짜리라도 참고용으로 상위 3개
  const { picks, isReference } = useMemo(() => {
    if (!data) return { picks: [] as HeatCell[], isReference: false }
    if (data.recommendations.length > 0) return { picks: data.recommendations, isReference: false }
    const fallback = data.cells
      .filter((c) => c.count >= 1 && c.avgViews > 0)
      .sort((a, b) => b.avgViews - a.avgViews)
      .slice(0, 3)
    return { picks: fallback, isReference: fallback.length > 0 }
  }, [data])

  const byWeekday = useMemo(() => {
    if (!data) return []
    return WEEK_ORDER.map((weekday) => {
      const cells = data.cells.filter((c) => c.weekday === weekday)
      const count = cells.reduce((s, c) => s + c.count, 0)
      const views = cells.reduce((s, c) => s + c.totalViews, 0)
      return { weekday, count, avg: count > 0 ? Math.round(views / count) : 0 }
    })
  }, [data])

  const byHour = useMemo(() => {
    if (!data) return []
    return Array.from({ length: 24 }, (_, hour) => {
      const cells = data.cells.filter((c) => c.hour === hour)
      const count = cells.reduce((s, c) => s + c.count, 0)
      const views = cells.reduce((s, c) => s + c.totalViews, 0)
      return { hour, count, avg: count > 0 ? Math.round(views / count) : 0 }
    })
  }, [data])

  const bestDay = useMemo(() => {
    const pool = byWeekday.filter((d) => d.count >= 2 && d.avg > 0)
    return [...pool].sort((a, b) => b.avg - a.avg)[0] ?? null
  }, [byWeekday])
  const bestHour = useMemo(() => {
    const pool = byHour.filter((h) => h.count >= 2 && h.avg > 0)
    return [...pool].sort((a, b) => b.avg - a.avg)[0] ?? null
  }, [byHour])
  const busiestHour = useMemo(() => [...byHour].sort((a, b) => b.count - a.count)[0] ?? null, [byHour])

  const highlight = useMemo(() => new Set(picks.map((c) => `${c.weekday}-${c.hour}`)), [picks])

  const noData = !loading && !error && data !== null && data.sampleCount === 0
  const scopeText = data?.scope === 'staff' ? '내 영상' : '팀 전체'
  const maxWeekdayAvg = Math.max(...byWeekday.map((d) => d.avg), 0)

  const heatMax = mode === 'avg' ? data?.maxAvg ?? 0 : data?.maxCount ?? 0
  const valueOf = (c: HeatCell) => (mode === 'avg' ? c.avgViews : c.count)
  const rgb = mode === 'avg' ? '16, 185, 129' : '79, 70, 229'

  return (
    <>
      <PageHeader
        title="업로드 타이밍 분석"
        subtitle="언제 올린 영상이 조회수가 잘 나오는지 봅니다."
        actions={<PeriodToggle value={period} onChange={setPeriod} disabled={loading} />}
      />
      <Toast toast={toast} />

      <div className="v4p">
        {error && !data ? (
          <ErrorPanel message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : noData ? (
          <EmptyPanel title="이 기간에 등록된 영상이 아직 없어요">
            이 화면은 영상을 올린 요일·시간대별로 평균 조회수를 비교해서 &quot;언제 올리면 좋은지&quot; 알려줘요. 영상이 어느 정도 쌓이면 추천 시간대가 나타납니다. 기간을 더 길게 바꿔 볼 수도 있어요.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${period}일 · ${scopeText} · 영상 ${fmtNumber(data.sampleCount)}개 기준` : undefined}
              headline={
                picks.length > 0 ? (
                  <>
                    이 시간대에 올리면 평균 조회수가 가장 높아요: <span className="em">{slotLabel(picks[0])}</span>
                  </>
                ) : (
                  '아직 추천할 시간대를 정하기엔 영상이 부족해요'
                )
              }
            >
              {picks.length > 0 ? (
                <>
                  <p className="v4p-hero-detail">
                    그 시간대에 올린 영상 {fmtNumber(picks[0].count)}개가 평균 <strong>{fmtShort(picks[0].avgViews)}회</strong> 조회됐어요.
                    {isReference ? ' (같은 시간대 영상이 1개씩뿐이라 참고용이에요.)' : ''}
                  </p>
                  <div className="v4p-top3">
                    {picks.map((c, index) => (
                      <div className={`v4p-top3-item ${index === 0 ? 'first' : ''}`} key={`${c.weekday}-${c.hour}`}>
                        <div className="v4p-top3-head">
                          <span className="v4p-medal">{index + 1}</span>
                          <span className="v4p-top3-name">{slotLabel(c)}</span>
                        </div>
                        <div className="v4p-top3-main" title={`평균 ${fmtNumber(c.avgViews)}회`}>
                          {fmtShort(c.avgViews)}
                          <small>회 평균</small>
                        </div>
                        <div className="v4p-top3-meta">
                          <span>영상 {fmtNumber(c.count)}개</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {busiestHour && bestHour && busiestHour.count > 0 && busiestHour.hour !== bestHour.hour ? (
                    <div className="v4p-hero-note plain">
                      지금은 <strong>{fmtHourKo(busiestHour.hour)}</strong>대에 가장 많이 올리고 있지만, 평균 조회수는 <strong>{fmtHourKo(bestHour.hour)}</strong>대가 더 높아요. 올리는 시간을 조금 옮겨 보세요.
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="v4p-hero-detail">같은 요일·시간대에 영상이 2개 이상 쌓이면 추천해 드려요. 영상을 꾸준히 등록해 주세요.</p>
              )}
            </Hero>

            <KpiRow>
              <Kpi
                label="반응이 좋은 요일"
                value={bestDay ? `${WEEKDAY_LABELS[bestDay.weekday]}요일` : '-'}
                hint={bestDay ? `이 요일에 올린 영상은 평균 ${fmtShort(bestDay.avg)}회 조회됐어요.` : '영상이 2개 이상 쌓인 요일이 아직 없어요.'}
                tone={bestDay ? 'good' : 'neutral'}
                loading={!data}
              />
              <Kpi
                label="반응이 좋은 시간대"
                value={bestHour ? fmtHourRangeKo(bestHour.hour) : '-'}
                hint={bestHour ? `요일과 상관없이, 이 시간대 영상이 평균 ${fmtShort(bestHour.avg)}회 조회됐어요.` : '영상이 2개 이상 쌓인 시간대가 아직 없어요.'}
                tone={bestHour ? 'good' : 'neutral'}
                loading={!data}
              />
              <Kpi
                label="가장 많이 올리는 시간대"
                value={busiestHour && busiestHour.count > 0 ? fmtHourRangeKo(busiestHour.hour) : '-'}
                hint={busiestHour && busiestHour.count > 0 ? `이 시간대에 영상 ${fmtNumber(busiestHour.count)}개를 올렸어요. 반응 좋은 시간대와 비교해 보세요.` : '아직 올린 영상이 없어요.'}
                loading={!data}
              />
            </KpiRow>

            <Card
              title="요일 × 시간대 한눈에 보기"
              sub="진하게 칠해진 칸일수록 값이 커요. 칸에 마우스를 올리면 자세한 숫자가 나와요."
              actions={
                <Seg
                  label="보기 방식"
                  value={mode}
                  options={[
                    ['avg', '평균 조회수'],
                    ['count', '올린 영상 수']
                  ]}
                  onChange={setMode}
                />
              }
            >
              {!data ? (
                <SkelRows rows={4} />
              ) : (
                <>
                  <div className="v4p-heat">
                    <div className="v4p-heat-grid" role="table" aria-label={mode === 'avg' ? '요일별 시간대별 평균 조회수' : '요일별 시간대별 올린 영상 수'}>
                      <div />
                      {Array.from({ length: 24 }, (_, hour) => (
                        <div className="v4p-heat-label" key={hour}>
                          {hour % 3 === 0 ? `${hour}시` : ''}
                        </div>
                      ))}
                      {WEEK_ORDER.map((weekday) => (
                        <div style={{ display: 'contents' }} key={weekday} role="row">
                          <div className="v4p-heat-label">{WEEKDAY_LABELS[weekday]}</div>
                          {Array.from({ length: 24 }, (_, hour) => {
                            const cell = data.cells[weekday * 24 + hour]
                            const value = cell ? valueOf(cell) : 0
                            const alpha = heatMax > 0 && value > 0 ? 0.12 + (value / heatMax) * 0.78 : 0
                            const key = `${weekday}-${hour}`
                            const thin = mode === 'avg' && cell && cell.count === 1
                            return (
                              <div
                                key={key}
                                role="cell"
                                className={`v4p-heat-cell ${highlight.has(key) ? 'rec' : ''} ${thin ? 'thin' : ''}`}
                                style={{ background: alpha > 0 ? `rgba(${rgb}, ${alpha.toFixed(2)})` : undefined }}
                                title={`${WEEKDAY_LABELS[weekday]}요일 ${fmtHourRangeKo(hour)} · 올린 영상 ${fmtNumber(cell?.count || 0)}개${cell && cell.count > 0 ? ` · 평균 조회수 ${fmtNumber(cell.avgViews)}회` : ''}`}
                              >
                                {value > 0 ? (mode === 'avg' ? fmtShort(value) : fmtNumber(value)) : ''}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="v4p-legend">
                    <span className="v4p-legend-item">
                      {mode === 'avg' ? '낮음' : '적음'}
                      <i className="v4p-legend-scale" style={{ background: `linear-gradient(to right, rgba(${rgb}, 0.12), rgba(${rgb}, 0.9))` }} />
                      {mode === 'avg' ? `높음 (최고 ${fmtShort(heatMax)}회)` : `많음 (최대 ${fmtNumber(heatMax)}개)`}
                    </span>
                    <span className="v4p-legend-item"><i className="v4p-swatch" /> 올린 영상 없음</span>
                    <span className="v4p-legend-item"><i className="v4p-swatch rec" /> 추천 시간대</span>
                    {mode === 'avg' ? <span className="v4p-legend-item"><i className="v4p-swatch thin" /> 흐린 칸 = 영상 1개뿐이라 참고만</span> : null}
                  </div>
                </>
              )}
            </Card>

            <Card title="요일별로 보면" sub="요일마다 올린 영상의 평균 조회수예요. 가장 높은 요일이 진하게 표시돼요.">
              {!data ? (
                <SkelRows rows={4} />
              ) : (
                <div className="v4p-bars">
                  {byWeekday.map((d) => (
                    <BarRow
                      key={d.weekday}
                      label={`${WEEKDAY_LABELS[d.weekday]}요일`}
                      value={d.avg}
                      max={maxWeekdayAvg}
                      valueText={d.count > 0 ? `${fmtShort(d.avg)}회` : '-'}
                      sub={`영상 ${fmtNumber(d.count)}개`}
                      leader={bestDay?.weekday === d.weekday}
                    />
                  ))}
                </div>
              )}
              <Formula>
                <p>평균 조회수 = 그 칸(또는 요일)에 올린 영상들의 조회수 합계 ÷ 영상 수.</p>
                <p>추천 시간대 = 같은 요일·시간대에 영상이 2개 이상 있는 칸 중 평균 조회수가 높은 순 Top 3. 영상이 1개뿐인 칸은 우연일 수 있어서 제외해요.</p>
                <p>시각은 한국 시간 기준이며, 유튜브 게시 시각(없으면 CRM 등록 시각)으로 계산해요.</p>
              </Formula>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
