'use client'

import { memo, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Kpi, Segment } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { errorText, v5Post } from '@/lib/v5/client'
import { formatCount, formatDayShort, formatKstFull } from '@/lib/v5/format'
import { AnswerBanner, EmptyBlock, LoadError, RelTime, fmtNum } from '@/lib/v5/page-parts'
import { ScoreboardSkeleton } from '@/lib/v5/skeleton'
import { ScoreBar, TierChip, TierDonut } from '@/lib/v5/score-viz'
import { SCORE_FACTORS, scoreParts, strongestWeakest, totalOf } from '@/lib/v5/score-view'
import { useSingleFlight, usePref } from '@/lib/v5/ui'
import { useV5Query } from '@/lib/v5/swr'
import { SCORE_TIER_LABEL, type ScoreTier, type ScoreboardRow } from '@/lib/v5/types'

type Period = 7 | 30 | 90
const PERIOD_OPTIONS: Array<{ value: `${Period}`; label: string }> = [
  { value: '7', label: '7일' },
  { value: '30', label: '30일' },
  { value: '90', label: '90일' }
]
const isPeriod = (v: unknown): v is Period => v === 7 || v === 30 || v === 90

type OwnerOption = { id: string; name: string; count: number }
type ScoreboardData = {
  items: ScoreboardRow[]
  shown: number
  days: Period
  since: string
  summary: { total: number; avg: number; strong: number; weak: number }
  distribution?: Array<{ tier: ScoreTier; count: number }>
  owners: OwnerOption[]
  unsynced: number
  lastSyncedAt: string | null
  earlyKnown?: number
  truncated: boolean
  snapshotsTruncated: boolean
}

const PAGE_STEP = 20

// 가장 강한/약한 요소를 한 줄로.
function reasonText(row: ScoreboardRow) {
  const { best, worst } = strongestWeakest(row)
  if (!best || !worst) return ''
  return row.tier === 'excellent' || row.tier === 'good' ? `강점: ${best.label}` : `보완할 점: ${worst.label}`
}

const ScoreRow = memo(function ScoreRow({ rank, row }: { rank: number; row: ScoreboardRow }) {
  const reason = reasonText(row)
  const title = row.video.title || '(제목 없음)'
  const views = row.video.view_count
  const parts = scoreParts(row)
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

export default function ScoreboardPage() {
  const me = useV5Me()
  const { toast, showSuccess, showError } = useToast()
  // showError 는 렌더마다 바뀔 수 있으므로 effect/콜백 의존성에 넣지 않고 ref 로만 쓴다.
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError
  const [days, setDays, daysReady] = usePref<Period>('v5.scoreboard.days', 30, isPeriod)
  const [owner, setOwner, ownerReady] = usePref<string>('v5.scoreboard.owner', '', (v): v is string => typeof v === 'string')
  const [syncing, setSyncing] = useState(false)
  const [limit, setLimit] = useState(PAGE_STEP)
  const once = useSingleFlight()

  const prefsReady = daysReady && ownerReady
  const url = prefsReady ? `/api/v5/scoreboard?days=${days}${owner ? `&owner=${encodeURIComponent(owner)}` : ''}` : null
  const q = useV5Query<ScoreboardData>(url, { errorFallback: '점수판을 불러오지 못했어요.' })
  const data = q.data

  // 저장돼 있던 담당자가 이 기간에 없으면(퇴사 등) 전체로 되돌린다.
  useEffect(() => {
    if (owner && data && !q.validating && !data.owners.some((o) => o.id === owner)) setOwner('')
  }, [owner, data, q.validating, setOwner])

  const changeDays = (value: `${Period}`) => {
    setLimit(PAGE_STEP)
    setDays(Number(value) as Period)
  }
  const changeOwner = (id: string) => {
    setLimit(PAGE_STEP)
    setOwner(id)
  }

  const onSync = () =>
    once(async () => {
      setSyncing(true)
      try {
        const res = await v5Post<{ updated: number; failed: number; total: number; remaining: number; nothingToDo?: boolean; stopped?: string | null }>('/api/v5/sync-stats', {})
        if (!res.ok) {
          showErrorRef.current(errorText(res, '조회수를 새로 가져오지 못했어요. 잠시 뒤 다시 해 주세요.'))
          return
        }
        const d = res.data
        if (d.nothingToDo) {
          showSuccess('방금 모두 새로 가져와서 더 가져올 영상이 없어요.')
        } else {
          const parts = [`${fmtNum(d.updated)}개 영상의 조회수를 새로 가져왔어요.`]
          if (d.failed) parts.push(`${fmtNum(d.failed)}개는 유튜브에서 찾지 못했어요.`)
          if (d.stopped === 'quota') parts.push('유튜브 한도 때문에 일부만 가져왔어요.')
          else if (d.remaining > 0) parts.push(`${fmtNum(d.remaining)}개가 남았어요. 한 번 더 누르면 이어서 가져와요.`)
          showSuccess(parts.join(' '))
        }
        q.reload()
      } finally {
        setSyncing(false)
      }
    })

  const rows = data?.items || []
  const summary = data?.summary
  const top = rows[0]
  const visibleRows = rows.slice(0, limit)
  const ownerName = owner ? data?.owners.find((o) => o.id === owner)?.name : ''

  return (
    <>
      <PageHeader
        title="영상 점수판"
        subtitle="영상마다 유튜브가 얼마나 잘 밀어주고 있는지 0~100점으로 비교해요."
        actions={
          me?.isAdmin ? (
            <button className="button secondary" disabled={syncing} onClick={() => void onSync()} title="유튜브에서 최신 조회수·좋아요·댓글을 다시 가져와요">
              {syncing ? '가져오는 중…' : '조회수 새로 가져오기'}
            </button>
          ) : undefined
        }
      />

      {/* 필터는 데이터가 다시 불러와지는 동안에도 자리를 지킨다(화면이 출렁이지 않게) */}
      <div className="v5p-toolbar v5p-filters">
        <span className="v5p-filter-group">
          <span className="small muted">기간</span>
          <Segment value={`${days}` as `${Period}`} onChange={changeDays} options={PERIOD_OPTIONS} />
        </span>
        <span className="v5p-filter-group">
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
        </span>
      </div>

      {q.error ? <LoadError message={q.error} status={q.status} onRetry={q.reload} /> : null}
      {q.loading && !q.error ? <ScoreboardSkeleton /> : null}

      {data ? (
        <div className={q.validating ? 'v5p-refreshing' : undefined} aria-busy={q.validating}>
          {summary && summary.total === 0 && !owner ? (
            <EmptyBlock
              title={`최근 ${data.days}일 안에 등록한 영상이 없어요`}
              action={
                <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
                  {data.days !== 90 ? (
                    <button className="button secondary" onClick={() => changeDays('90')}>
                      90일로 넓혀 보기
                    </button>
                  ) : null}
                  <Link className="button" href="/v5/register">
                    영상 등록하러 가기
                  </Link>
                </span>
              }
            >
              영상을 등록하면 조회수·좋아요·댓글을 바탕으로 점수가 자동으로 매겨져요.
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
                  조회수를 아직 가져오지 않은 영상이 <strong>{fmtNum(data.unsynced)}개</strong> 있어요. 이런 영상은 조회수 0으로 계산돼 점수가 낮게 보일 수 있어요.
                  {me?.isAdmin ? ' 위의 “조회수 새로 가져오기”를 눌러 주세요.' : ' 관리자에게 “조회수 새로 가져오기”를 부탁해 주세요.'}
                </div>
              ) : null}

              <div className="v5p-kpis">
                <Kpi
                  label="평균 점수 (0~100)"
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
                  meta="60점 이상 · 이 방식을 다음 영상에도 써 보세요"
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
                  meta="40점 미만 · 제목·썸네일을 다시 살펴보세요"
                  tone={(summary?.weak ?? 0) > 0 ? 'red' : undefined}
                />
              </div>

              {data.distribution && (summary?.total ?? 0) > 0 ? (
                <section className="v5p-board-card v5p-dist-card" aria-label="점수 구간 분포">
                  <TierDonut distribution={data.distribution} avg={summary?.avg} />
                </section>
              ) : null}

              <section className="v5p-board-card" aria-label="영상 순위">
                <div className="v5p-section-head">
                  <h2>영상 순위</h2>
                  <span className="small muted">
                    점수 높은 순 · {fmtNum(Math.min(limit, rows.length))} / {fmtNum(summary?.total ?? 0)}개 표시
                  </span>
                </div>
                <div className="v5p-score-legend small muted" aria-hidden>
                  막대는 {SCORE_FACTORS.map((f) => `${f.label} ${f.max}점`).join(' + ')} = 100점 만점이에요. 색이 칠해진 만큼이 받은 점수예요.
                </div>
                {rows.length === 0 ? (
                  <div className="v5p-pick-empty">표시할 영상이 없어요.</div>
                ) : (
                  <ul className="v5p-score-list">
                    {visibleRows.map((row, i) => (
                      <ScoreRow key={row.video.id} rank={i + 1} row={row} />
                    ))}
                  </ul>
                )}
                {rows.length > limit ? (
                  <button className="button secondary sm" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + PAGE_STEP)}>
                    더 보기 ({fmtNum(rows.length - limit)}개 남음)
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
