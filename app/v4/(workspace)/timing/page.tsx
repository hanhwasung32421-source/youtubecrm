'use client'

import { useMemo, useRef } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { isPeriodValue, useStoredState } from '@/lib/v4/use-stored-state'
import { useV4Query } from '@/lib/v4/use-v4-query'
import type { HeatCell, PeriodDays } from '@/lib/v4/analytics'
import { BarRow, Card, EmptyPanel, ErrorPanel, Formula, Hero, Kpi, KpiRow, Seg, SkelBars, SkelHeat } from '@/lib/v4/analysis-ui'
import { Heatmap } from '@/lib/v4/heatmap'
import { WEEKDAY_LABELS, fmtHourKo, fmtHourRangeKo, fmtNumberOr, fmtShortOr, fmtYmdKo } from '@/lib/v4/format'
import { WEEK_ORDER, bucketize, pickSlots, slotRangeName, type HeatMode } from '@/lib/v4/timing-view'
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

const LOAD_ERROR = '업로드 시간대 분석을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
const NO_PICKS = { picks: [] as HeatCell[], isReference: false }

export default function UploadTimingPage() {
  const { toast, showError } = useToast()
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError

  const [period, setPeriod, ready] = useStoredState<PeriodDays>('v4:timing:period', 30, isPeriodValue)
  const [mode, setMode] = useStoredState<HeatMode>('v4:timing:mode', 'avg', (v): v is HeatMode => v === 'avg' || v === 'count')

  const hasDataRef = useRef(false)
  const { data, stale, error, status, fetching, reload } = useV4Query<TimingResponse>(ready ? `/api/v4/timing?period=${period}` : null, {
    fallback: LOAD_ERROR,
    onError: (message) => {
      if (hasDataRef.current) showErrorRef.current(message)
    }
  })
  hasDataRef.current = data !== null

  // 모드 전환(평균 ↔ 영상 수)은 이미 받은 값으로 화면에서만 바꾼다.
  const { picks, isReference } = useMemo(() => (data ? pickSlots(data.cells, data.recommendations) : NO_PICKS), [data])
  const buckets = useMemo(() => (data ? bucketize(data.cells) : null), [data])

  const byWeekday = useMemo(() => (buckets ? WEEK_ORDER.map((weekday) => buckets.byWeekday[weekday]) : []), [buckets])
  const bestDay = useMemo(() => [...byWeekday.filter((d) => d.count >= 2 && d.avg > 0)].sort((a, b) => b.avg - a.avg)[0] ?? null, [byWeekday])
  const bestHour = useMemo(() => [...(buckets?.byHour ?? []).filter((h) => h.count >= 2 && h.avg > 0)].sort((a, b) => b.avg - a.avg)[0] ?? null, [buckets])
  const busiestHour = useMemo(() => [...(buckets?.byHour ?? [])].sort((a, b) => b.count - a.count || a.hour - b.hour)[0] ?? null, [buckets])
  const highlight = useMemo(() => new Set(picks.map((c) => `${c.weekday}-${c.hour}`)), [picks])
  const maxWeekdayAvg = useMemo(() => byWeekday.reduce((m, d) => Math.max(m, d.avg), 0), [byWeekday])

  const failed = Boolean(error) && (!data || stale)
  const noData = Boolean(data) && !stale && !error && data?.sampleCount === 0
  const scopeText = data?.scope === 'staff' ? '내 영상' : '팀 전체'
  const heatMax = mode === 'avg' ? data?.maxAvg ?? 0 : data?.maxCount ?? 0
  const top = picks[0]

  return (
    <>
      <PageHeader
        title="업로드 타이밍 분석"
        subtitle="언제 올린 영상이 조회수가 잘 나오는지 봅니다."
        actions={<PeriodToggle value={period} onChange={setPeriod} />}
      />
      <Toast toast={toast} />

      <div className="v4p">
        {failed ? (
          <ErrorPanel message={error} status={status} onRetry={reload} busy={fetching} />
        ) : noData ? (
          <EmptyPanel title="이 기간에 등록된 영상이 아직 없어요">
            이 화면은 영상을 올린 요일·시간대별로 평균 조회수를 비교해서 &quot;언제 올리면 좋은지&quot; 알려줘요. 영상이 어느 정도 쌓이면 추천 시간대가 나타납니다. 기간을 더 길게 바꿔 볼 수도 있어요.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${data.period}일 · ${scopeText} · 영상 ${fmtNumberOr(data.sampleCount)}개 기준 · ${fmtYmdKo(data.range.start)} ~ ${fmtYmdKo(data.range.end)}` : undefined}
              headline={
                top ? (
                  <>
                    이 시간대에 올리면 평균 조회수가 가장 높아요: <span className="em">{slotRangeName(top.weekday, top.hour)}</span>
                  </>
                ) : (
                  '아직 추천할 시간대를 정하기엔 영상이 부족해요'
                )
              }
            >
              {top ? (
                <>
                  <p className="v4p-hero-detail">
                    그 시간대에 올린 영상 {fmtNumberOr(top.count)}개가 평균 <strong>{fmtShortOr(top.avgViews)}회</strong> 조회됐어요.
                    {isReference ? ' (같은 시간대 영상이 1개씩뿐이라 참고용이에요.)' : ''}
                  </p>
                  <ol className="v4p-top3" aria-label="추천 시간대 순위">
                    {picks.map((c, index) => (
                      <li className={`v4p-top3-item ${index === 0 ? 'first' : ''}`} key={`${c.weekday}-${c.hour}`}>
                        <div className="v4p-top3-head">
                          <span className="v4p-medal" aria-label={`${index + 1}위`}>{index + 1}</span>
                          <span className="v4p-top3-name" title={slotRangeName(c.weekday, c.hour)}>{slotRangeName(c.weekday, c.hour)}</span>
                        </div>
                        <div className="v4p-top3-main" title={`평균 ${fmtNumberOr(c.avgViews)}회`}>
                          {fmtShortOr(c.avgViews)}
                          <small>회 평균</small>
                        </div>
                        <div className="v4p-top3-meta">
                          <span>영상 {fmtNumberOr(c.count)}개</span>
                        </div>
                      </li>
                    ))}
                  </ol>
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
                hint={bestDay ? `이 요일에 올린 영상은 평균 ${fmtShortOr(bestDay.avg)}회 조회됐어요.` : '영상이 2개 이상 쌓인 요일이 아직 없어요.'}
                tone={bestDay ? 'good' : 'neutral'}
                loading={!data}
              />
              <Kpi
                label="반응이 좋은 시간대"
                value={bestHour ? fmtHourRangeKo(bestHour.hour) : '-'}
                hint={bestHour ? `요일과 상관없이, 이 시간대 영상이 평균 ${fmtShortOr(bestHour.avg)}회 조회됐어요.` : '영상이 2개 이상 쌓인 시간대가 아직 없어요.'}
                tone={bestHour ? 'good' : 'neutral'}
                loading={!data}
              />
              <Kpi
                label="가장 많이 올리는 시간대"
                value={busiestHour && busiestHour.count > 0 ? fmtHourRangeKo(busiestHour.hour) : '-'}
                hint={busiestHour && busiestHour.count > 0 ? `이 시간대에 영상 ${fmtNumberOr(busiestHour.count)}개를 올렸어요. 반응 좋은 시간대와 비교해 보세요.` : '아직 올린 영상이 없어요.'}
                loading={!data}
              />
            </KpiRow>

            <Card
              title="요일 × 시간대 한눈에 보기"
              sub="진하게 칠해진 칸일수록 값이 커요. 칸에 마우스를 올리거나 눌러 보면 정확한 숫자가 나와요."
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
              {!data ? <SkelHeat /> : <Heatmap cells={data.cells} mode={mode} max={heatMax} sampleCount={data.sampleCount} highlight={highlight} />}
            </Card>

            <Card title="요일별로 보면" sub="요일마다 올린 영상의 평균 조회수(회)예요. 막대가 길수록 평균 조회수가 높고, 가장 높은 요일에는 ‘최고’ 표시가 붙어요.">
              {!data ? (
                <SkelBars rows={7} />
              ) : maxWeekdayAvg <= 0 ? (
                <EmptyPanel title="아직 비교할 조회수가 없어요" action={null}>
                  영상은 있지만 조회수가 아직 0이에요. 조회수는 유튜브에서 자동으로 가져와요.
                </EmptyPanel>
              ) : (
                <div className="v4p-bars" role="list" aria-label="요일별 평균 조회수">
                  {byWeekday.map((d) => (
                    <div role="listitem" key={d.weekday}>
                      <BarRow
                        label={`${WEEKDAY_LABELS[d.weekday]}요일`}
                        value={d.avg}
                        max={maxWeekdayAvg}
                        valueText={d.count > 0 ? `${fmtShortOr(d.avg)}회` : '-'}
                        exact={d.count > 0 ? `평균 ${fmtNumberOr(d.avg)}회 · 영상 ${fmtNumberOr(d.count)}개` : '올린 영상 없음'}
                        sub={`영상 ${fmtNumberOr(d.count)}개`}
                        leader={bestDay?.weekday === d.weekday}
                      />
                    </div>
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
