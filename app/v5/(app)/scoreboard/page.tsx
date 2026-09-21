'use client'

import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Kpi, Segment } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { errorText, v5Post } from '@/lib/v5/client'
import { csvFileName, scoreboardCsv } from '@/lib/v5/csv'
import { SCORE_SORTS, SCORE_SORT_LABEL, SCORE_SPEC, type ScorePeriod, type ScoreSort } from '@/lib/v5/filters'
import { formatCount, formatDayShort, formatKstFull, todayYmd } from '@/lib/v5/format'
import { ActiveFilters, CopyLinkButton, ExportCsvButton, GlossaryTip, type FilterChip } from '@/lib/v5/insight-parts'
import { AnswerBanner, EmptyBlock, LoadError, RelTime, fmtNum } from '@/lib/v5/page-parts'
import { ScoreboardSkeleton } from '@/lib/v5/skeleton'
import { ScoreBar, TierChip, TierDonut } from '@/lib/v5/score-viz'
import { SCORE_FACTORS, scoreParts, sortScoreRows, strongestWeakest, totalOf } from '@/lib/v5/score-view'
import { downloadCsv } from '@/lib/v5/share'
import { experimentLink, nextStepFor, playbookLink } from '@/lib/v5/suggest'
import { useV5Query } from '@/lib/v5/swr'
import { useUrlFilters } from '@/lib/v5/use-filters'
import { SCORE_TIER_LABEL, type ScoreTier, type ScoreboardRow } from '@/lib/v5/types'

const PERIOD_OPTIONS: Array<{ value: `${ScorePeriod}`; label: string }> = [
  { value: '7', label: '7일' },
  { value: '30', label: '30일' },
  { value: '90', label: '90일' }
]

type OwnerOption = { id: string; name: string; count: number }
type ScoreboardData = {
  items: ScoreboardRow[]
  shown: number
  days: ScorePeriod
  since: string
  summary: { total: number; avg: number; strong: number; weak: number }
  distribution?: Array<{ tier: ScoreTier; count: number }>
  // 점수가 가장 낮은 "아쉬움" 영상(낮은 순). 오래된 응답에는 없을 수 있다.
  bottom?: ScoreboardRow[]
  owners: OwnerOption[]
  unsynced: number
  lastSyncedAt: string | null
  earlyKnown?: number
  truncated: boolean
  snapshotsTruncated: boolean
}

const PAGE_STEP = 20
const FILTER_KEY = 'v5.scoreboard.filters.v1'

// 보통 구간 등 다음 행동이 없는 영상에 붙이는 한 줄.
function reasonText(row: ScoreboardRow) {
  const { best, worst } = strongestWeakest(row)
  if (!best || !worst) return ''
  return row.tier === 'excellent' || row.tier === 'good' ? `강점: ${best.label}` : `보완할 점: ${worst.label}`
}

// "이유 + 버튼" 한 덩어리: 점수가 낮으면 실험 만들기, 높으면 성공 공식으로 저장.
function NextStep({ row, compact }: { row: ScoreboardRow; compact?: boolean }) {
  const step = nextStepFor(row)
  if (!step) return null
  const id = row.video.id
  return (
    <div className={`v5p-suggest ${step.kind === 'experiment' ? 'fix' : 'keep'} ${compact ? 'compact' : ''}`}>
      <div className="v5p-suggest-text">
        <b>{step.suggestion.headline}</b>
        <span className="v5p-suggest-why">이유: {step.suggestion.reason}</span>
      </div>
      {step.kind === 'experiment' ? (
        <Link className="button xs" href={experimentLink(id, step.suggestion.key)} prefetch={false}>
          이 영상으로 실험 만들기
        </Link>
      ) : (
        <Link className="button xs secondary" href={playbookLink(id, step.suggestion.note)} prefetch={false}>
          성공 공식으로 저장
        </Link>
      )}
    </div>
  )
}

const ScoreRow = memo(function ScoreRow({ rank, row }: { rank: number; row: ScoreboardRow }) {
  const title = row.video.title || '(제목 없음)'
  const views = row.video.view_count
  const parts = scoreParts(row)
  const hasStep = row.tier === 'poor' || row.tier === 'excellent' || row.tier === 'good'
  const reason = hasStep ? '' : reasonText(row)
  return (
    <li className="v5p-score-row">
      <div className="v5p-score-grid">
        <span className={`v5-rank-badge v5p-score-rank ${rank <= 3 ? 'top' : ''}`} aria-label={`${rank}위`}>
          {fmtNum(rank)}
        </span>
        <div className="v5p-score-main">
          <div className="v5p-score-title" title={row.video.title || ''}>
            {row.video.youtube_url ? (
              <a href={row.video.youtube_url} target="_blank" rel="noopener noreferrer" className="v5p-score-link" title={`유튜브에서 열기 · ${title}`}>
                {title}
              </a>
            ) : (
              title
            )}
          </div>
          <div className="small muted v5p-score-meta">
            <span className="v5p-ell">{row.video.stock_name}</span>
            <span aria-hidden>·</span>
            <span className="v5p-ell">{row.video.owner_name || '담당자 없음'}</span>
            <span aria-hidden>·</span>
            <span className="v5p-num" title={typeof views === 'number' && Number.isFinite(views) ? `조회수 ${fmtNum(views)}회` : undefined}>
              조회수 {formatCount(views ?? 0)}
            </span>
            {row.video.published_at ? (
              <>
                <span aria-hidden>·</span>
                <span title={`올린 시각 ${formatKstFull(row.video.published_at)}`}>{formatDayShort(row.video.published_at)} 올림</span>
              </>
            ) : null}
            {reason ? (
              <>
                <span aria-hidden>·</span>
                <span>{reason}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="v5p-score-viz">
          <ScoreBar row={row} />
        </div>
        <div className="v5p-score-total">
          <div className="v5p-score-num" title="0~100점">
            {fmtNum(totalOf(row))}
            <small>점</small>
          </div>
          <TierChip tier={row.tier} />
        </div>
      </div>
      {hasStep ? (
        <div className="v5p-score-step">
          <NextStep row={row} compact />
        </div>
      ) : null}
      <details className="v5p-score-detail">
        <summary>점수 이유 보기</summary>
        <ul className="v5p-why">
          {parts.map((p) => (
            <li key={p.key}>
              <strong>{p.label}</strong>
              <span className="v5p-num">
                {' '}
                {p.value} / {p.max}점
              </span>
              {p.pending ? <span className="small muted"> · 기록 부족 (기본 {p.value}점)</span> : null}
              <div className="small muted">{p.meaning}</div>
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
})

// "지금 할 일" 카드의 한 줄(영상 이름 + 점수 + 이유 + 버튼)
function NextItem({ row }: { row: ScoreboardRow }) {
  const title = row.video.title || row.video.stock_name || '(제목 없음)'
  return (
    <li className="v5p-next-item">
      <div className="v5p-next-head">
        <span className="v5p-next-title v5p-ell-inline" title={title}>
          {title}
        </span>
        <span className="v5p-num v5p-next-score">{fmtNum(totalOf(row))}점</span>
      </div>
      <NextStep row={row} />
    </li>
  )
}

function ScoreboardView() {
  const me = useV5Me()
  const { toast, showSuccess, showError } = useToast()
  // showError 는 렌더마다 바뀔 수 있으므로 effect/콜백 의존성에 넣지 않고 ref 로만 쓴다.
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError
  const { filters, setFilters, reset, ready, shareUrl } = useUrlFilters(SCORE_SPEC, FILTER_KEY)
  const { days, owner, sort } = filters
  const [syncing, setSyncing] = useState(false)
  const [limit, setLimit] = useState(PAGE_STEP)
  const syncInFlight = useRef(false)

  const url = ready ? `/api/v5/scoreboard?days=${days}${owner ? `&owner=${encodeURIComponent(owner)}` : ''}` : null
  const q = useV5Query<ScoreboardData>(url, { errorFallback: '점수판을 불러오지 못했어요.' })
  const data = q.data

  // 저장돼 있던(또는 링크로 받은) 담당자가 이 기간에 없으면 전체로 되돌린다.
  useEffect(() => {
    if (owner && data && !q.validating && !data.owners.some((o) => o.id === owner)) setFilters({ owner: '' })
  }, [owner, data, q.validating, setFilters])

  const changeDays = (value: `${ScorePeriod}`) => {
    setLimit(PAGE_STEP)
    setFilters({ days: Number(value) as ScorePeriod })
  }
  const changeOwner = (id: string) => {
    setLimit(PAGE_STEP)
    setFilters({ owner: id })
  }
  const changeSort = (value: ScoreSort) => {
    setLimit(PAGE_STEP)
    setFilters({ sort: value })
  }
  const onReset = () => {
    setLimit(PAGE_STEP)
    reset()
  }

  const onSync = async () => {
    if (syncInFlight.current) return
    syncInFlight.current = true
    setSyncing(true)
    try {
      const res = await v5Post<{ updated: number; failed: number; total: number; remaining: number; nothingToDo?: boolean; stopped?: string | null }>('/api/v5/sync-stats', {})
      if (!res.ok) {
        showErrorRef.current(errorText(res, '조회수를 가져오지 못했어요. 잠시 뒤 다시 해 주세요.'))
        return
      }
      const d = res.data
      if (d.nothingToDo) {
        showSuccess('방금 모두 받아 와서 더 받을 영상이 없어요.')
      } else {
        const parts = [`${fmtNum(d.updated)}개 영상의 조회수를 유튜브에서 받아 왔어요.`]
        if (d.failed) parts.push(`${fmtNum(d.failed)}개는 유튜브에서 찾지 못했어요.`)
        if (d.stopped === 'quota') parts.push('유튜브 한도 때문에 일부만 받아 왔어요.')
        else if (d.remaining > 0) parts.push(`${fmtNum(d.remaining)}개가 남았어요. 한 번 더 누르면 이어서 받아요.`)
        showSuccess(parts.join(' '))
      }
      q.reload()
    } finally {
      syncInFlight.current = false
      setSyncing(false)
    }
  }

  const rows = useMemo(() => data?.items || [], [data])
  const summary = data?.summary
  const top = rows[0]
  const rankById = useMemo(() => new Map(rows.map((r, i) => [r.video.id, i + 1])), [rows])
  const sortedRows = useMemo(() => sortScoreRows(rows, sort), [rows, sort])
  const visibleRows = sortedRows.slice(0, limit)
  const ownerName = owner ? data?.owners.find((o) => o.id === owner)?.name : ''

  // "지금 할 일": 가장 아쉬운 영상 3개 / 가장 잘 나간 영상 3개
  const worst = useMemo(() => (data?.bottom ? data.bottom : rows.filter((r) => r.tier === 'poor').slice(-3).reverse()).slice(0, 3), [data, rows])
  const best = useMemo(() => rows.filter((r) => r.tier === 'excellent' || r.tier === 'good').slice(0, 3), [rows])

  const chips: FilterChip[] = []
  if (days !== SCORE_SPEC.defaults.days) chips.push({ key: 'days', label: `기간: 최근 ${days}일`, onClear: () => changeDays('30') })
  if (owner) chips.push({ key: 'owner', label: `담당자: ${ownerName || '선택한 담당자'}`, onClear: () => changeOwner('') })
  if (sort !== 'score') chips.push({ key: 'sort', label: `정렬: ${SCORE_SORT_LABEL[sort]}`, onClear: () => changeSort('score') })

  const exportCsv = () => {
    if (sortedRows.length === 0) return
    const ok = downloadCsv(csvFileName('영상점수판', todayYmd()), scoreboardCsv(sortedRows, (r) => rankById.get(r.video.id) ?? 0))
    if (ok) showSuccess(`영상 ${fmtNum(sortedRows.length)}개를 CSV 파일로 저장했어요.`)
    else showErrorRef.current('파일을 저장하지 못했어요. 브라우저 설정을 확인해 주세요.')
  }

  const syncButtonLabel = syncing ? '받아 오는 중…' : '유튜브에서 조회수 받기'

  return (
    <>
      <PageHeader
        title="영상 점수판"
        subtitle="영상마다 유튜브가 얼마나 잘 밀어주고 있는지 0~100점으로 비교해요."
        actions={
          me?.isAdmin ? (
            <button className="button secondary" disabled={syncing} onClick={() => void onSync()} title="유튜브에서 최신 조회수·좋아요·댓글을 다시 받아 와요">
              {syncButtonLabel}
            </button>
          ) : undefined
        }
      />

      {/* 필터는 데이터가 다시 불러와지는 동안에도 자리를 지킨다(화면이 출렁이지 않게) */}
      <div className="v5p-toolbar v5p-filters">
        <span className="v5p-filter-group">
          <span className="small muted">기간</span>
          <Segment value={`${days}` as `${ScorePeriod}`} onChange={changeDays} options={PERIOD_OPTIONS} />
          {data && data.owners.length > 1 ? (
            <select className="select v5p-owner-select" value={owner} onChange={(e) => changeOwner(e.target.value)} aria-label="담당자별로 보기">
              <option value="">모든 담당자</option>
              {data.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({fmtNum(o.count)})
                </option>
              ))}
            </select>
          ) : null}
          <select className="select v5p-owner-select" value={sort} onChange={(e) => changeSort(e.target.value as ScoreSort)} aria-label="정렬">
            {SCORE_SORTS.map((s) => (
              <option key={s} value={s}>
                {SCORE_SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </span>
        <span className="v5p-toolbar-right">
          <CopyLinkButton getUrl={shareUrl} />
          <ExportCsvButton onExport={exportCsv} disabled={sortedRows.length === 0} />
        </span>
      </div>
      <ActiveFilters chips={chips} onReset={onReset} />

      {q.error ? <LoadError message={q.error} status={q.status} onRetry={q.reload} /> : null}
      {(q.loading || !ready) && !q.error ? <ScoreboardSkeleton /> : null}

      {data ? (
        <div className={q.validating ? 'v5p-refreshing' : undefined} aria-busy={q.validating}>
          {summary && summary.total === 0 && !owner ? (
            <EmptyBlock
              title={`최근 ${data.days}일 안에 등록한 영상이 없어요`}
              action={
                <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
                  <Link className="button" href="/v5/register">
                    영상 등록하러 가기
                  </Link>
                  {data.days !== 90 ? (
                    <button className="button secondary" onClick={() => changeDays('90')}>
                      90일로 넓혀 보기
                    </button>
                  ) : null}
                </span>
              }
            >
              점수는 등록한 영상의 조회수·좋아요·댓글을 다른 영상과 비교해서 매겨요. 그래서 영상을 먼저 등록해야 점수가 생겨요.
            </EmptyBlock>
          ) : (
            <>
              <AnswerBanner label={`최근 ${data.days}일, 지금 점수가 가장 높은 영상`} tone="good">
                {top ? (
                  <>
                    <strong className="v5p-ell-inline" title={top.video.title || top.video.stock_name}>
                      {top.video.title || top.video.stock_name}
                    </strong>{' '}
                    · {fmtNum(totalOf(top))}점
                    <span className="v5p-answer-sub">
                      {top.video.stock_name} · {top.video.owner_name || '담당자 없음'} · 최근 {data.days}일간 {ownerName ? `${ownerName}님이 ` : ''}등록한 영상 {fmtNum(summary?.total ?? 0)}개 중 1등
                    </span>
                  </>
                ) : (
                  <>이 담당자가 최근 {data.days}일 안에 등록한 영상이 없어요.</>
                )}
              </AnswerBanner>

              {data.unsynced > 0 ? (
                <div className="v5p-note v5p-sync-note" role="note">
                  조회수를 아직 받아 오지 않은 영상이 <strong>{fmtNum(data.unsynced)}개</strong> 있어요. 이런 영상은 조회수 0으로 계산돼 점수가 낮게 보일 수 있어요.
                  {me?.isAdmin ? (
                    <>
                      {' '}
                      <button type="button" className="button xs secondary" disabled={syncing} onClick={() => void onSync()}>
                        {syncButtonLabel}
                      </button>
                    </>
                  ) : (
                    ' 관리자에게 “유튜브에서 조회수 받기”를 부탁해 주세요.'
                  )}
                </div>
              ) : null}

              <div className="v5p-kpis">
                <Kpi
                  label={
                    <>
                      평균 반응 점수 (0~100) <GlossaryTip term="score" />
                    </>
                  }
                  value={
                    <>
                      {fmtNum(summary?.avg ?? 0)}
                      <small>점</small>
                    </>
                  }
                  meta="높을수록 유튜브가 잘 밀어주는 영상이에요"
                  tone={(summary?.avg ?? 0) >= 60 ? 'green' : (summary?.avg ?? 0) < 40 ? 'red' : undefined}
                />
                <Kpi
                  label="잘 되는 영상"
                  value={
                    <>
                      {fmtNum(summary?.strong ?? 0)}
                      <small>개</small>
                    </>
                  }
                  meta="60점 이상 · 이 방식을 성공 공식으로 남겨 보세요"
                  tone={(summary?.strong ?? 0) > 0 ? 'green' : undefined}
                />
                <Kpi
                  label="손봐야 할 영상"
                  value={
                    <>
                      {fmtNum(summary?.weak ?? 0)}
                      <small>개</small>
                    </>
                  }
                  meta="40점 미만 · 가장 약한 점부터 실험해 보세요"
                  tone={(summary?.weak ?? 0) > 0 ? 'red' : undefined}
                />
              </div>

              {(summary?.total ?? 0) > 0 ? (
                <section className="v5p-board-card v5p-next" aria-label="이 결과로 할 수 있는 일">
                  <div className="v5p-section-head">
                    <h2>이 결과로 이렇게 해 보세요</h2>
                    <span className="small muted">점수가 낮은 영상은 실험으로, 높은 영상은 성공 공식으로 남기면 다음 영상이 좋아져요</span>
                  </div>
                  <div className="v5p-next-grid">
                    <div className="v5p-next-col">
                      <h3 className="v5p-next-h">손봐야 할 영상</h3>
                      {worst.length > 0 ? (
                        <ul className="v5p-next-list">
                          {worst.map((r) => (
                            <NextItem key={r.video.id} row={r} />
                          ))}
                        </ul>
                      ) : (
                        <p className="small muted v5p-next-empty">40점 미만인 영상이 없어요. 지금은 실험보다 잘 되는 방식을 이어 가면 돼요.</p>
                      )}
                    </div>
                    <div className="v5p-next-col">
                      <h3 className="v5p-next-h">잘 나간 영상</h3>
                      {best.length > 0 ? (
                        <ul className="v5p-next-list">
                          {best.map((r) => (
                            <NextItem key={r.video.id} row={r} />
                          ))}
                        </ul>
                      ) : (
                        <p className="small muted v5p-next-empty">
                          아직 60점 이상인 영상이 없어요.{' '}
                          {data.unsynced > 0 ? '조회수를 아직 받지 않은 영상이 있어서 점수가 낮게 보일 수 있어요.' : '이 기간에 등록한 영상의 반응이 더 쌓이면 여기에 나타나요.'}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {data.distribution && (summary?.total ?? 0) > 0 ? (
                <section className="v5p-board-card v5p-dist-card" aria-label="점수 구간 분포">
                  <TierDonut distribution={data.distribution} avg={summary?.avg} />
                  <div className="small muted v5p-dist-help">
                    점수를 4단계(구간)로 나눈 모습이에요. <GlossaryTip term="tier" />
                  </div>
                </section>
              ) : null}

              <section className="v5p-board-card" aria-label="영상 순위">
                <div className="v5p-section-head">
                  <h2>영상 순위</h2>
                  <span className="small muted">
                    {SCORE_SORT_LABEL[sort]} · {fmtNum(Math.min(limit, sortedRows.length))} / {fmtNum(summary?.total ?? 0)}개 표시
                  </span>
                </div>
                <div className="v5p-score-legend small muted">
                  막대는 {SCORE_FACTORS.map((f) => `${f.label} ${f.max}점`).join(' + ')} = 100점 만점이에요. 색이 칠해진 만큼이 받은 점수예요. 조회 속도 <GlossaryTip term="velocity" /> 초기 성장 <GlossaryTip term="early" />
                </div>
                {sortedRows.length === 0 ? (
                  <div className="v5p-pick-empty">
                    {owner ? (
                      <>
                        이 담당자는 최근 {data.days}일 안에 등록한 영상이 없어서 표시할 영상이 없어요. 기간을 넓히거나{' '}
                        <button type="button" className="button xs secondary" onClick={onReset}>
                          필터 초기화
                        </button>
                        를 눌러 보세요.
                      </>
                    ) : (
                      '표시할 영상이 없어요.'
                    )}
                  </div>
                ) : (
                  <ul className="v5p-score-list">
                    {visibleRows.map((row) => (
                      <ScoreRow key={row.video.id} rank={rankById.get(row.video.id) ?? 0} row={row} />
                    ))}
                  </ul>
                )}
                {sortedRows.length > limit ? (
                  <button className="button secondary sm" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + PAGE_STEP)}>
                    더 보기 ({fmtNum(sortedRows.length - limit)}개 남음)
                  </button>
                ) : null}
                {summary && summary.total > rows.length ? (
                  <div className="small muted" style={{ marginTop: 12 }}>
                    순위는 상위 {fmtNum(rows.length)}개까지만 보여요. 평균 점수와 개수는 {fmtNum(summary.total)}개 전체 기준이에요. 담당자나 기간을 좁혀 보세요.
                  </div>
                ) : null}
                {data.truncated ? (
                  <div className="v5p-note" style={{ marginTop: 12 }} role="note">
                    영상이 너무 많아 일부만 계산에 넣었어요. 기간을 줄이면 더 정확해요.
                  </div>
                ) : null}
              </section>

              <div className="small muted v5p-foot-note">
                {data.since} 이후에 등록한 영상 기준
                {data.lastSyncedAt ? (
                  <>
                    {' '}
                    · 조회수 마지막 갱신 <RelTime value={data.lastSyncedAt} />
                  </>
                ) : null}
                {typeof data.earlyKnown === 'number' && summary && summary.total > 0 ? ` · 초기 성장 기록이 있는 영상 ${fmtNum(data.earlyKnown)}개 (나머지는 기본 10점)` : ''}
                {data.snapshotsTruncated ? ' · 초기 성장 기록이 많아 일부만 반영했어요' : ''}
              </div>

              <details className="v5p-formula">
                <summary>점수 계산 방법</summary>
                <div className="v5p-formula-body">
                  <p>
                    점수는 <strong>같은 기간(최근 {data.days}일)에 등록한 다른 영상들과 비교한 순위</strong>예요. 세 가지를 더해서 100점 만점으로 계산해요.
                  </p>
                  <ul>
                    {SCORE_FACTORS.map((f) => (
                      <li key={f.key}>
                        <strong>
                          {f.label} ({f.max}점)
                        </strong>{' '}
                        — {f.meaning}
                      </li>
                    ))}
                  </ul>
                  <p className="small muted">초기 성장은 올린 뒤 48시간 안의 조회수 기록이 2번 이상 있어야 계산돼요. 기록이 부족하면 절반(10점)을 기본으로 줘요.</p>
                  <p className="small muted">
                    {SCORE_TIER_LABEL.excellent} 80점 이상 · {SCORE_TIER_LABEL.good} 60점 이상 · {SCORE_TIER_LABEL.fair} 40점 이상 · {SCORE_TIER_LABEL.poor} 40점 미만
                  </p>
                </div>
              </details>
            </>
          )}
        </div>
      ) : null}

      <Toast toast={toast} />
    </>
  )
}

export default function ScoreboardPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 로 감싸야 한다(Next 16).
  return (
    <Suspense fallback={<ScoreboardSkeleton />}>
      <ScoreboardView />
    </Suspense>
  )
}
