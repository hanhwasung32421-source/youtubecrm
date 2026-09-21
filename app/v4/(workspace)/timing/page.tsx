'use client'

import { Suspense, useMemo, useRef } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { useUrlFilters } from '@/lib/v4/use-url-filters'
import { useV4Query } from '@/lib/v4/use-v4-query'
import type { HeatCell, PeriodDays } from '@/lib/v4/analytics'
import { TIMING_SPEC, rankingHref, type TimingFilters } from '@/lib/v4/page-filters'
import { TIMING_RELIABLE_MIN, buildTimingAdvice, fmtMultiple, isThinCell } from '@/lib/v4/insights'
import { CopyLinkButton, CsvButton, GlossaryHint, GlossaryList, SyncStatsButton } from '@/lib/v4/page-tools'
import { BarRow, Card, EmptyPanel, ErrorPanel, Formula, Hero, Kpi, KpiRow, Seg, SkelBars, SkelHeat } from '@/lib/v4/analysis-ui'
import { Heatmap } from '@/lib/v4/heatmap'
import { WEEKDAY_LABELS, fmtHourKo, fmtHourRangeKo, fmtNumber, fmtNumberOr, fmtShortOr, fmtYmdKo } from '@/lib/v4/format'
import { WEEK_ORDER, bucketize, slotRangeName } from '@/lib/v4/timing-view'
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

export default function UploadTimingPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 안에 있어야 한다 (Next 16).
  return (
    <Suspense
      fallback={
        <div className="v4p" style={{ padding: 16 }}>
          <SkelHeat />
        </div>
      }
    >
      <TimingScreen />
    </Suspense>
  )
}

function TimingScreen() {
  const { isAdmin } = useV4Me()
  const { toast, showSuccess, showError } = useToast()
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError

  const { filters, ready, set, shareUrl } = useUrlFilters<TimingFilters>('timing', TIMING_SPEC)
  const { period, mode } = filters

  const hasDataRef = useRef(false)
  const { data, stale, error, status, fetching, reload } = useV4Query<TimingResponse>(ready ? `/api/v4/timing?period=${period}` : null, {
    fallback: LOAD_ERROR,
    onError: (message) => {
      if (hasDataRef.current) showErrorRef.current(message)
    }
  })
  hasDataRef.current = data !== null

  // 모드 전환(평균 ↔ 영상 수)은 이미 받은 값으로 화면에서만 바꾼다.
  const advice = useMemo(() => (data ? buildTimingAdvice(data.cells) : null), [data])
  // 추천 한 곳 말고도 믿을 만한(영상 3개 이상) 다른 후보를 최대 2곳 알려준다 (추천이 영상 적음이면 생략)
  const others = useMemo(() => {
    if (!data || !advice || advice.lowSample) return []
    return data.cells
      .filter((c) => c.count >= TIMING_RELIABLE_MIN && c.avgViews > 0 && !(c.weekday === advice.weekday && c.hour === advice.hour))
      .sort((a, b) => b.avgViews - a.avgViews || b.count - a.count)
      .slice(0, 2)
  }, [data, advice])
  const buckets = useMemo(() => (data ? bucketize(data.cells) : null), [data])

  const byWeekday = useMemo(() => (buckets ? WEEK_ORDER.map((weekday) => buckets.byWeekday[weekday]) : []), [buckets])
  const bestDay = useMemo(() => [...byWeekday.filter((d) => d.count >= TIMING_RELIABLE_MIN && d.avg > 0)].sort((a, b) => b.avg - a.avg)[0] ?? null, [byWeekday])
  const bestHour = useMemo(() => [...(buckets?.byHour ?? []).filter((h) => h.count >= TIMING_RELIABLE_MIN && h.avg > 0)].sort((a, b) => b.avg - a.avg)[0] ?? null, [buckets])
  const busiestHour = useMemo(() => [...(buckets?.byHour ?? [])].sort((a, b) => b.count - a.count || a.hour - b.hour)[0] ?? null, [buckets])
  const highlight = useMemo(() => {
    const keys = new Set<string>()
    if (advice) keys.add(`${advice.weekday}-${advice.hour}`)
    for (const c of others) keys.add(`${c.weekday}-${c.hour}`)
    return keys
  }, [advice, others])
  const maxWeekdayAvg = useMemo(() => byWeekday.reduce((m, d) => Math.max(m, d.avg), 0), [byWeekday])

  const failed = Boolean(error) && (!data || stale)
  const noData = Boolean(data) && !stale && !error && data?.sampleCount === 0
  const zeroViews = Boolean(data) && !stale && !error && (data?.sampleCount ?? 0) > 0 && (data?.maxAvg ?? 0) <= 0
  const scopeText = data?.scope === 'staff' ? '내 영상' : '팀 전체'
  const heatMax = mode === 'avg' ? data?.maxAvg ?? 0 : data?.maxCount ?? 0
  const hrefFor = (weekday: number, hour: number) => rankingHref({ period, dow: weekday, hour })
  const onSyncMessage = (message: string, tone: 'success' | 'error') => (tone === 'success' ? showSuccess(message) : showError(message))

  const exportCsv = async () => {
    if (!data) return
    const filled = data.cells.filter((c) => c.count > 0)
    if (filled.length === 0) return
    const [{ buildCsv, csvFilename }, { downloadCsvFile }] = await Promise.all([import('@/lib/v4/csv'), import('@/lib/v4/download')])
    const headers = ['요일', '시각(한국 시간)', '올린 영상 수', '조회수 합계', '평균 조회수', '참고']
    const rows = filled.map((c) => [`${WEEKDAY_LABELS[c.weekday]}요일`, fmtHourRangeKo(c.hour), c.count, c.totalViews, c.avgViews, isThinCell(c.count) ? '영상이 적어 참고만' : ''])
    downloadCsvFile(csvFilename(`업로드시간대_최근${period}일`), buildCsv(headers, rows))
    showSuccess(`시간대 ${fmtNumber(filled.length)}곳의 값을 엑셀 파일로 저장했어요.`)
  }

  return (
    <>
      <PageHeader
        title="업로드 타이밍 분석"
        subtitle="언제 올린 영상이 조회수가 잘 나오는지 보고, 올릴 시간을 정할 수 있어요."
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
            이 화면은 영상을 올린 요일·시간대별로 평균 조회수를 비교해서 &quot;언제 올리면 좋은지&quot; 알려줘요. 영상을 등록하면 하루 이틀 뒤부터 조회수와 함께 나타나고, 같은 시간대에 영상이 쌓이면 추천 시간대가 나와요. 기간을 더 길게 바꿔 볼 수도 있어요.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${data.period}일 · ${scopeText} · 영상 ${fmtNumberOr(data.sampleCount)}개 기준 · ${fmtYmdKo(data.range.start)} ~ ${fmtYmdKo(data.range.end)}` : undefined}
              headline={
                advice ? (
                  <>
                    <span className="em">{slotRangeName(advice.weekday, advice.hour)}</span>에 올려 보세요
                  </>
                ) : zeroViews ? (
                  '아직 조회수를 받아오지 않았어요'
                ) : (
                  '아직 추천할 시간대를 정하기엔 영상이 부족해요'
                )
              }
            >
              {advice ? (
                <>
                  <p className="v4p-hero-detail">
                    {advice.evidence}
                    {' · '}
                    <Link href={hrefFor(advice.weekday, advice.hour)}>이 시간대 영상 보기</Link>
                  </p>
                  {advice.lowSample ? (
                    <div className="v4p-hero-note">
                      {advice.caveat} <GlossaryHint term="sample" />
                    </div>
                  ) : null}
                  {others.length > 0 ? (
                    <>
                      <p className="v4p-hero-detail">다른 후보 (영상 {TIMING_RELIABLE_MIN}개 이상인 시간대)</p>
                      <ol className="v4p-top3" aria-label="다른 추천 시간대">
                        {others.map((c) => (
                          <li className="v4p-top3-item" key={`${c.weekday}-${c.hour}`}>
                            <div className="v4p-top3-head">
                              <Link className="v4p-top3-name" href={hrefFor(c.weekday, c.hour)} title={`${slotRangeName(c.weekday, c.hour)} — 이 시간대 영상 보기`}>
                                {slotRangeName(c.weekday, c.hour)}
                              </Link>
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
                    </>
                  ) : null}
                  {busiestHour && bestHour && busiestHour.count > 0 && busiestHour.hour !== bestHour.hour ? (
                    <div className="v4p-hero-note plain">
                      지금은 <strong>{fmtHourKo(busiestHour.hour)}</strong>대에 가장 많이 올리고 있지만, 평균 조회수는 <strong>{fmtHourKo(bestHour.hour)}</strong>대가 더 높아요. 올리는 시간을 조금 옮겨 보세요.
                    </div>
                  ) : null}
                </>
              ) : zeroViews ? (
                <>
                  <p className="v4p-hero-detail">영상은 등록되어 있지만 유튜브에서 조회수를 아직 받아오지 않았어요. 조회수를 받아오면 추천 시간대가 나와요.</p>
                  <div className="v4p-hero-actions">
                    {isAdmin ? <SyncStatsButton onDone={reload} onMessage={onSyncMessage} /> : <span className="small muted">관리자가 조회수를 받아오면 여기에 나타나요.</span>}
                  </div>
                </>
              ) : (
                <p className="v4p-hero-detail">조회수가 있는 영상이 아직 없어요. 영상을 꾸준히 등록하고 조회수를 받아오면, 같은 시간대에 영상이 쌓이는 대로 추천해 드려요.</p>
              )}
            </Hero>

            <KpiRow>
              <Kpi
                label="반응이 좋은 요일"
                value={bestDay ? `${WEEKDAY_LABELS[bestDay.weekday]}요일` : '-'}
                hint={bestDay ? `이 요일에 올린 영상은 평균 ${fmtShortOr(bestDay.avg)}회 조회됐어요. (영상 ${fmtNumberOr(bestDay.count)}개)` : `영상이 ${TIMING_RELIABLE_MIN}개 이상 쌓인 요일이 아직 없어요.`}
                tone={bestDay ? 'good' : 'neutral'}
                loading={!data}
              />
              <Kpi
                label="반응이 좋은 시간대"
                value={bestHour ? fmtHourRangeKo(bestHour.hour) : '-'}
                hint={bestHour ? `요일과 상관없이, 이 시간대 영상이 평균 ${fmtShortOr(bestHour.avg)}회 조회됐어요. (영상 ${fmtNumberOr(bestHour.count)}개)` : `영상이 ${TIMING_RELIABLE_MIN}개 이상 쌓인 시간대가 아직 없어요.`}
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
              sub={`진하게 칠해진 칸일수록 값이 커요. 점선 칸은 영상이 ${TIMING_RELIABLE_MIN}개 미만이라 참고만 하세요. 칸을 누르면 그 시간대에 올린 영상을 볼 수 있어요.`}
              actions={
                <>
                  <CsvButton onExport={() => void exportCsv()} disabled={!data || data.sampleCount === 0} />
                  <Seg
                    label="보기 방식"
                    value={mode}
                    options={[
                      ['avg', '평균 조회수'],
                      ['count', '올린 영상 수']
                    ]}
                    onChange={(next) => set({ mode: next })}
                  />
                </>
              }
            >
              {!data ? <SkelHeat /> : <Heatmap cells={data.cells} mode={mode} max={heatMax} sampleCount={data.sampleCount} highlight={highlight} hrefFor={hrefFor} />}
            </Card>

            <Card title="요일별로 보면" sub="요일마다 올린 영상의 평균 조회수(회)예요. 막대가 길수록 평균 조회수가 높고, 가장 높은 요일에는 ‘최고’ 표시가 붙어요.">
              {!data ? (
                <SkelBars rows={7} />
              ) : maxWeekdayAvg <= 0 ? (
                <EmptyPanel
                  title="아직 비교할 조회수가 없어요"
                  action={isAdmin ? <SyncStatsButton onDone={reload} onMessage={onSyncMessage} /> : null}
                >
                  영상은 있지만 조회수가 아직 0이에요. 조회수는 유튜브에서 가져와야 해요{isAdmin ? '. 아래 버튼으로 지금 받아올 수 있어요.' : '. 관리자가 받아오면 나타나요.'}
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
                        sub={`영상 ${fmtNumberOr(d.count)}개${isThinCell(d.count) ? ' · 영상이 적어요' : ''}`}
                        leader={bestDay?.weekday === d.weekday}
                      />
                    </div>
                  ))}
                </div>
              )}
              <Formula summary="이 기준은 어떻게 정했나요?">
                <p>평균 조회수 = 그 칸(또는 요일)에 올린 영상들의 조회수 합계 ÷ 영상 수.</p>
                <p>
                  추천 시간대 = 영상이 {TIMING_RELIABLE_MIN}개 이상 있는 칸 중 평균 조회수가 가장 높은 한 곳이에요{advice && advice.multiple !== null && advice.multiple >= 1.05 ? ` (지금 추천은 전체 평균의 ${fmtMultiple(advice.multiple)}배)` : ''}. 그런 칸이 없으면 2개 → 1개짜리 칸으로 물러서되 “영상이 적어요”라고 알려 드려요. 영상이 적으면 한 영상이 우연히 잘 나온 것일 수 있기 때문이에요.
                </p>
                <p>시각은 한국 시간 기준이며, 유튜브 게시 시각(없으면 CRM 등록 시각)으로 계산해요.</p>
              </Formula>
              <GlossaryList terms={['heatmap', 'sample', 'avgViews']} />
            </Card>
          </>
        )}
      </div>
    </>
  )
}
