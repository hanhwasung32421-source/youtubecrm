'use client'

import { Suspense, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/v4/app-shell'
import { PeriodToggle } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { useUrlFilters } from '@/lib/v4/use-url-filters'
import { useV4Query } from '@/lib/v4/use-v4-query'
import type { Kpis, PeriodDays, StaffStat } from '@/lib/v4/analytics'
import { STAFF_SPEC, rankingHref, type StaffFilters } from '@/lib/v4/page-filters'
import { buildCsv, csvFilename } from '@/lib/v4/csv'
import { downloadCsvFile } from '@/lib/v4/download'
import { buildStaffTeamLite, staffStrength } from '@/lib/v4/insights'
import { DAILY_TARGET, kstHourOf, todayStatus, type TodayState } from '@/lib/v4/staff-today'
import { CopyLinkButton, CsvButton, GlossaryHint, GlossaryList, SyncStatsButton } from '@/lib/v4/page-tools'
import { Badge, BarRow, Card, EmptyPanel, ErrorPanel, Formula, Hero, Kpi, KpiRow, MiniBars, Seg, SkelBars, SkelTable } from '@/lib/v4/analysis-ui'
import { fmtDeltaVsMean, fmtNumber, fmtNumberOr, fmtPercentOr, fmtShortOr, fmtYmdKo, ratioOf, shortYmd } from '@/lib/v4/format'
import { addDaysToYmd, getKstYmd } from '@/lib/attendance/time'
import '../pages.css'

// todayCount / dailyTarget 은 API 가 나중에 추가한 값이라 옛 응답에는 없을 수 있다.
type StaffRow = StaffStat & { todayCount?: number; dailyTarget?: number }

type StaffResponse = {
  period: PeriodDays
  range: { start: string; end: string }
  rows: StaffRow[]
  team: Kpis
  todayYmd?: string
  dailyTarget?: number
  error?: string
}

type Metric = StaffFilters['metric']

const LOAD_ERROR = '담당자별 성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
const METRIC_LABEL: Record<Metric, string> = { totalViews: '조회수 합계', videoCount: '올린 영상 수', avgViews: '영상당 평균 조회수' }
const ROW_STYLE = { '--cols': '36px minmax(150px, 1.8fr) 68px 96px 96px minmax(120px, 1.2fr) 80px 76px' } as CSSProperties
const NO_ROWS: StaffRow[] = []

const unit = (metric: Metric, value: number) => (metric === 'videoCount' ? `${fmtNumberOr(value)}개` : `${fmtShortOr(value)}회`)
const exactOf = (metric: Metric, value: number) => (metric === 'videoCount' ? `${fmtNumberOr(value)}개` : `${fmtNumberOr(value)}회`)

// 오늘 등록 상태를 말투는 담담하게, 색은 "주의(노랑)" 정도로만
const TODAY_BADGE: Record<TodayState, { tone: 'good' | 'neutral' | 'warn'; label: string }> = {
  done: { tone: 'good', label: '목표 달성' },
  'on-track': { tone: 'neutral', label: '진행 중' },
  behind: { tone: 'warn', label: '오늘 등록이 적어요' },
  none: { tone: 'neutral', label: '목표 없음' }
}

export default function StaffComparisonPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 안에 있어야 한다 (Next 16).
  return (
    <Suspense
      fallback={
        <div className="v4p" style={{ padding: 16 }}>
          <SkelBars rows={5} />
        </div>
      }
    >
      <StaffScreen />
    </Suspense>
  )
}

function StaffScreen() {
  const { toast, showSuccess, showError } = useToast()
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError

  const { filters, ready, set, shareUrl } = useUrlFilters<StaffFilters>('staff', STAFF_SPEC)
  const { period, metric } = filters

  const hasDataRef = useRef(false)
  const { data, stale, error, status, fetching, reload } = useV4Query<StaffResponse>(ready ? `/api/v4/staff?period=${period}` : null, {
    fallback: LOAD_ERROR,
    onError: (message, code) => {
      if (hasDataRef.current && code !== 403) showErrorRef.current(message)
    }
  })
  hasDataRef.current = data !== null

  const rows = data?.rows ?? NO_ROWS
  const active = useMemo(() => rows.filter((r) => r.videoCount > 0), [rows])
  const idle = useMemo(() => rows.filter((r) => r.videoCount === 0), [rows])

  // 총 조회수 1위 / 영상당 평균 1위
  const leader = useMemo(() => [...rows].sort((a, b) => b.totalViews - a.totalViews)[0] ?? null, [rows])
  const avgLeader = useMemo(() => [...active].sort((a, b) => b.avgViews - a.avgViews)[0] ?? null, [active])

  // 기준을 바꿔도 다시 요청하지 않고 받은 값으로 다시 그린다.
  const bars = useMemo(() => {
    const pool = metric === 'avgViews' ? active : rows
    return [...pool].sort((a, b) => b[metric] - a[metric])
  }, [rows, active, metric])
  const barMax = bars[0]?.[metric] ?? 0
  const barMean = bars.length > 0 ? bars.reduce((s, r) => s + r[metric], 0) / bars.length : 0

  // 담당자별 강점 한 문장 (팀 평균과 비교)
  const strengths = useMemo(() => {
    const teamLite = buildStaffTeamLite(rows, { avgViews: data?.team.avgViews ?? 0, likeRate: data?.team.likeRate ?? 0 })
    return new Map(rows.map((r) => [r.userId, staffStrength(r, teamLite)]))
  }, [rows, data?.team.avgViews, data?.team.likeRate])

  // 오늘 등록 현황 (지금 시각 기준으로 "이 시간엔 보통 몇 개쯤" 을 함께 본다). 데이터를 새로 받을 때마다 다시 계산한다.
  const todayRows = useMemo(() => {
    const hour = kstHourOf(Date.now())
    return rows
      .map((r) => ({ row: r, status: todayStatus(r.todayCount ?? 0, r.dailyTarget ?? 0, hour) }))
      .filter((x) => x.status.state !== 'none')
      .sort((a, b) => a.status.count - b.status.count || a.row.name.localeCompare(b.row.name, 'ko'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, data])
  const hasTodayData = rows.some((r) => typeof r.todayCount === 'number')
  const behind = todayRows.filter((x) => x.status.state === 'behind')
  const doneCount = todayRows.filter((x) => x.status.state === 'done').length
  const target = data?.dailyTarget ?? DAILY_TARGET

  const sentence = useMemo(() => {
    const first = bars[0]
    if (!first || first[metric] <= 0) return '아직 비교할 기록이 없어요.'
    const second = bars[1]
    const gap = second ? first[metric] - second[metric] : 0
    if (metric === 'totalViews')
      return `${first.name}님이 조회수 합계 ${fmtShortOr(first.totalViews)}회로 앞서 있어요.${second && gap > 0 ? ` 2위 ${second.name}님과는 ${fmtShortOr(gap)}회 차이예요.` : ''}`
    if (metric === 'videoCount')
      return `${first.name}님이 ${fmtNumberOr(first.videoCount)}개로 가장 많이 올렸어요.${second && gap > 0 ? ` 2위 ${second.name}님보다 ${fmtNumberOr(gap)}개 많아요.` : ''}`
    return `${first.name}님 영상이 1개당 평균 ${fmtShortOr(first.avgViews)}회로 가장 잘 나와요. (영상을 올린 담당자끼리 비교)`
  }, [bars, metric])

  const last7Labels = useMemo(() => {
    if (!data) return undefined
    const end = data.range.end || getKstYmd()
    return Array.from({ length: 7 }, (_, i) => shortYmd(addDaysToYmd(end, i - 6)))
  }, [data])

  const teamCount = rows.length
  const forbidden = status === 403 && Boolean(error)
  const failed = !forbidden && Boolean(error) && (!data || stale)
  const noData = Boolean(data) && !stale && !error && rows.length === 0
  const zeroViews = Boolean(data) && !stale && !error && rows.length > 0 && (data?.team.totalViews ?? 0) === 0 && (data?.team.videoCount ?? 0) > 0
  const perPerson = ratioOf(data?.team.videoCount, teamCount)
  const onSyncMessage = (message: string, tone: 'success' | 'error') => (tone === 'success' ? showSuccess(message) : showError(message))

  const exportCsv = () => {
    if (rows.length === 0) return
    const headers = ['순위', '담당자', '영상 수', '조회수 합계', '영상당 평균 조회수', '롱폼 수', '숏폼 수', '좋아요 비율(%)', '오늘 등록 수', '오늘 목표', '한 줄 강점']
    const body = rows.map((r) => [
      r.rank,
      r.name,
      r.videoCount,
      r.totalViews,
      r.videoCount > 0 ? r.avgViews : '',
      r.longformCount,
      r.shortformCount,
      r.videoCount > 0 ? Number((r.likeRate * 100).toFixed(2)) : '',
      r.todayCount ?? '',
      r.dailyTarget ?? '',
      strengths.get(r.userId) ?? ''
    ])
    downloadCsvFile(csvFilename(`담당자비교_최근${period}일`), buildCsv(headers, body))
    showSuccess(`담당자 ${fmtNumber(rows.length)}명의 표를 CSV로 저장했어요.`)
  }

  return (
    <>
      <PageHeader
        title="담당자 성과 비교"
        subtitle="담당자별로 얼마나 올리고 얼마나 조회됐는지 비교합니다."
        actions={
          <>
            <CopyLinkButton getUrl={shareUrl} onResult={(ok) => (ok ? showSuccess('이 화면 링크를 복사했어요. 받은 사람도 같은 조건으로 볼 수 있어요.') : showError('링크를 복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.'))} />
            <PeriodToggle value={period} onChange={(next) => set({ period: next })} />
          </>
        }
      />
      <Toast toast={toast} />

      <div className="v4p">
        {forbidden ? (
          <EmptyPanel
            title="관리자만 볼 수 있는 화면이에요"
            action={
              <Link href="/v4/ranking" className="button">
                내 영상 성과 보러 가기
              </Link>
            }
          >
            담당자끼리 성과를 비교하는 화면이라 관리자 계정에서만 열려요. 내 영상 성과는 &quot;콘텐츠 성과 랭킹&quot;에서 확인할 수 있어요.
          </EmptyPanel>
        ) : failed ? (
          <ErrorPanel message={error} status={status} onRetry={reload} busy={fetching} />
        ) : noData ? (
          <EmptyPanel title="비교할 담당자가 아직 없어요">
            이 화면은 담당자별로 올린 영상 수와 조회수를 나란히 보여줘요. 활동 중인 직원 계정이 있고 영상이 등록되면 여기에 나타납니다.
          </EmptyPanel>
        ) : (
          <>
            <Hero
              loading={!data}
              eyebrow={data ? `최근 ${data.period}일 · ${fmtYmdKo(data.range.start)} ~ ${fmtYmdKo(data.range.end)}` : undefined}
              headline={
                leader && leader.totalViews > 0 ? (
                  <>
                    이번 기간 가장 성과가 좋은 담당자: <span className="em">{leader.name}님</span>
                  </>
                ) : zeroViews ? (
                  '아직 조회수를 받아오지 않았어요'
                ) : (
                  '아직 이 기간에 조회수가 쌓인 담당자가 없어요'
                )
              }
            >
              {leader && leader.totalViews > 0 ? (
                <p className="v4p-hero-detail">
                  {leader.name}님이 영상 {fmtNumberOr(leader.videoCount)}개로 조회수 합계 <strong>{fmtShortOr(leader.totalViews)}회</strong>를 기록했어요.
                  {avgLeader && avgLeader.userId !== leader.userId ? (
                    <> 영상 1개당 평균은 <strong>{avgLeader.name}님</strong>이 {fmtShortOr(avgLeader.avgViews)}회로 가장 높아요.</>
                  ) : null}
                </p>
              ) : zeroViews ? (
                <>
                  <p className="v4p-hero-detail">영상은 등록되어 있지만 유튜브에서 조회수를 아직 받아오지 않았어요.</p>
                  <div className="v4p-hero-actions">
                    <SyncStatsButton onDone={reload} onMessage={onSyncMessage} />
                  </div>
                </>
              ) : null}
              {hasTodayData && behind.length > 0 ? (
                <div className="v4p-hero-note plain">
                  오늘 아직 등록이 적은 담당자: <strong>{behind.map((x) => `${x.row.name}(${x.status.count}개)`).join(', ')}</strong>. 오늘 목표 {target}개까지 남은 개수를 아래 “오늘 등록 현황”에서 볼 수 있어요.
                </div>
              ) : null}
              {idle.length > 0 ? (
                <div className="v4p-hero-note plain">
                  이 기간에 등록한 영상이 없는 담당자: <strong>{idle.map((s) => s.name).join(', ')}</strong>. 휴가나 교육 중일 수도 있으니 필요하면 확인해 보세요.
                </div>
              ) : null}
            </Hero>

            <KpiRow>
              <Kpi label="팀 조회수 합계" value={`${fmtShortOr(data?.team.totalViews)}회`} hint="모든 담당자가 올린 영상이 받은 조회수를 더한 값이에요." loading={!data} />
              <Kpi
                label="팀이 올린 영상"
                value={`${fmtNumberOr(data?.team.videoCount)}개`}
                hint={`담당자 ${fmtNumberOr(teamCount)}명, 1인 평균 ${perPerson === null ? '-' : perPerson.toFixed(1)}개예요.`}
                loading={!data}
              />
              <Kpi label="영상 1개당 평균 조회수" value={`${fmtShortOr(data?.team.avgViews)}회`} hint="팀 전체의 보통 수준이에요. 담당자별 평균과 비교해 보세요." loading={!data} term="avgViews" />
            </KpiRow>

            {hasTodayData || !data ? (
              <Card
                title="오늘 등록 현황"
                sub={`오늘(한국 시간) 등록한 영상 수와 하루 목표 ${target}개를 비교해요. 목표는 참고용이에요.`}
                actions={
                  <>
                    <GlossaryHint term="dailyTarget" />
                    <button type="button" className="v4p-link-btn" onClick={reload} disabled={fetching}>
                      {fetching ? '세는 중…' : '지금 다시 세기'}
                    </button>
                  </>
                }
              >
                {!data ? (
                  <SkelBars rows={4} />
                ) : todayRows.length === 0 ? (
                  <EmptyPanel title="오늘 목표를 비교할 담당자가 없어요" action={null}>
                    활동 중인 직원 계정이 있으면 오늘 등록한 영상 수가 여기에 나타나요.
                  </EmptyPanel>
                ) : (
                  <>
                    <p className="v4p-today-sum">
                      오늘 목표를 채운 담당자 <strong>{fmtNumberOr(doneCount)}명</strong> / {fmtNumberOr(todayRows.length)}명
                      {behind.length > 0 ? <> · 지금 시각 기준으로 등록이 적은 담당자 {fmtNumberOr(behind.length)}명</> : null}
                    </p>
                    <ul className="v4p-today-list" aria-label="담당자별 오늘 등록 현황">
                      {todayRows.map(({ row, status: st }) => {
                        const badge = TODAY_BADGE[st.state]
                        const pct = Math.min(100, Math.round((st.count / st.target) * 100))
                        return (
                          <li className={`v4p-today-item ${st.state}`} key={row.userId}>
                            <div className="v4p-today-name">
                              <Link href={rankingHref({ staff: row.userId, period })} title={`${row.name}님 영상 보기`}>
                                {row.name}
                              </Link>
                              <Badge tone={badge.tone}>{badge.label}</Badge>
                            </div>
                            <div
                              className="v4p-today-bar"
                              role="progressbar"
                              aria-label={`${row.name} 오늘 등록 진행`}
                              aria-valuemin={0}
                              aria-valuemax={st.target}
                              aria-valuenow={Math.min(st.count, st.target)}
                              aria-valuetext={`${st.count}개 / 목표 ${st.target}개`}
                            >
                              <span style={{ width: `${pct}%` }} />
                            </div>
                            <div className="v4p-today-text">{st.text}</div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </Card>
            ) : null}

            <Card
              title="담당자 비교"
              sub={sentence}
              actions={<Seg label="비교 기준" value={metric} options={(Object.keys(METRIC_LABEL) as Metric[]).map((k) => [k, METRIC_LABEL[k]])} onChange={(next) => set({ metric: next })} />}
            >
              {!data ? (
                <SkelBars rows={5} />
              ) : (
                <>
                  <div className="v4p-bars" role="list" aria-label={`담당자별 ${METRIC_LABEL[metric]}`}>
                    {bars.map((row, index) => (
                      <div role="listitem" key={row.userId}>
                        <BarRow
                          label={row.name}
                          value={row[metric]}
                          max={barMax}
                          valueText={unit(metric, row[metric])}
                          exact={`${METRIC_LABEL[metric]} ${exactOf(metric, row[metric])}`}
                          sub={`${metric === 'videoCount' ? `조회수 ${fmtShortOr(row.totalViews)}회` : `영상 ${fmtNumberOr(row.videoCount)}개`} · 평균 대비 ${fmtDeltaVsMean(row[metric], barMean)}`}
                          leader={index === 0 && row[metric] > 0}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="v4p-axis-cap">막대 길이 = {METRIC_LABEL[metric]}({metric === 'videoCount' ? '개' : '회'}). ▲▼는 비교한 담당자들의 평균보다 높은지 낮은지예요.</p>
                </>
              )}
              {metric === 'avgViews' && data && idle.length > 0 ? <p className="small muted" style={{ marginTop: 10 }}>영상을 올리지 않은 담당자는 이 비교에서 뺐어요.</p> : null}
            </Card>

            <Card
              title="담당자별 자세히 보기"
              sub="조회수 합계가 높은 순이에요. 이름을 누르면 그 담당자의 영상 순위로 넘어가요. 막대 7개는 최근 7일 동안 하루에 몇 개 올렸는지 보여줘요."
              actions={<CsvButton onExport={exportCsv} disabled={!data || rows.length === 0} />}
            >
              {!data ? (
                <SkelTable rows={5} />
              ) : (
                <div className={`v4p-tbl ${fetching && stale ? 'busy' : ''}`} role="table" aria-label="담당자별 상세">
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
                      <div className="v4p-cell-rank" role="cell">
                        <span className={`v4p-rank ${row.rank <= 3 && row.totalViews > 0 ? 'top' : ''}`}>{row.rank}</span>
                      </div>
                      <div className="v4p-title-cell" role="cell">
                        <Link href={rankingHref({ staff: row.userId, period })} title={`${row.name}님 영상 순위 보기`}>
                          {row.name}
                        </Link>
                        {row.videoCount === 0 ? <Badge tone="neutral">등록한 영상 없음</Badge> : null}
                        <div className="v4p-strength">{strengths.get(row.userId)}</div>
                      </div>
                      <div className="v4p-td-r" data-label="영상 수" role="cell">{fmtNumberOr(row.videoCount)}개</div>
                      <div className="v4p-td-r v4p-num" data-label="조회수 합계" title={`${fmtNumberOr(row.totalViews)}회`} role="cell">{fmtShortOr(row.totalViews)}</div>
                      <div className="v4p-td-r" data-label="영상당 평균" title={row.videoCount > 0 ? `${fmtNumberOr(row.avgViews)}회` : undefined} role="cell">{row.videoCount > 0 ? fmtShortOr(row.avgViews) : '-'}</div>
                      <div data-label="롱폼 / 숏폼" className="v4p-share-cell" role="cell">
                        {row.videoCount > 0 ? (
                          <>
                            <div className="small">롱폼 {fmtNumberOr(row.longformCount)} · 숏폼 {fmtNumberOr(row.shortformCount)}</div>
                            <div className="v4p-share" aria-hidden="true">
                              <span style={{ width: `${row.longformShare * 100}%` }} />
                              <span style={{ width: `${(1 - row.longformShare) * 100}%` }} />
                            </div>
                          </>
                        ) : (
                          <span className="muted small">-</span>
                        )}
                      </div>
                      <div className="v4p-td-r" data-label="좋아요 비율" role="cell">{row.videoCount > 0 ? fmtPercentOr(row.likeRate, 1) : '-'}</div>
                      <div data-label="최근 7일" role="cell"><MiniBars values={row.sparkline} labels={last7Labels} /></div>
                    </div>
                  ))}
                </div>
              )}
              <Formula>
                <p>영상당 평균 = 조회수 합계 ÷ 올린 영상 수. 많이 올린 사람과 적게 올린 사람을 공평하게 비교할 때 써요.</p>
                <p>좋아요 비율 = 좋아요 수 ÷ 조회수. 영상을 본 사람 중 좋아요를 누른 비율이에요.</p>
                <p>순위는 조회수 합계 기준이고, 롱폼 = 긴 영상, 숏폼 = 짧은 영상이에요.</p>
                <p>“한 줄 강점”은 팀 평균보다 1.2배 이상 높은 점(영상당 평균 조회수, 좋아요 비율, 등록 개수)을 최대 2가지 골라 적어요. 뒤처지는 점은 적지 않아요.</p>
                <p>오늘 등록 현황은 오늘 0시(한국 시간)부터 등록한 영상 수예요. 하루 목표 {target}개는 참고용이고, 하루를 오전 10시~오후 8시로 보고 “이 시간엔 보통 몇 개쯤”을 계산해서 그보다 적을 때만 “오늘 등록이 적어요”로 알려줘요.</p>
              </Formula>
              <GlossaryList terms={['avgViews', 'likeRate', 'dailyTarget']} />
            </Card>
          </>
        )}
      </div>
    </>
  )
}
