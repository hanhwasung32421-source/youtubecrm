'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Badge, Kpi, Segment } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { errorText, v5Get, v5Post } from '@/lib/v5/client'
import { formatDateTime } from '@/lib/v5/format'
import { AnswerBanner, EmptyBlock, LoadError, LoadingLine, fmtNum } from '@/lib/v5/page-parts'
import { usePref } from '@/lib/v5/ui'
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
  owners: OwnerOption[]
  unsynced: number
  lastSyncedAt: string | null
  truncated: boolean
  snapshotsTruncated: boolean
}

const PAGE_STEP = 20

const TIER_TONE: Record<ScoreTier, 'green' | 'indigo' | 'amber' | 'red'> = {
  excellent: 'green',
  good: 'indigo',
  fair: 'amber',
  poor: 'red'
}

// 점수 구성 요소: 사람이 읽는 이름 + 한 줄 뜻.
const FACTORS = [
  { key: 'velocity', label: '조회 속도', max: 45, meaning: '올라온 뒤 하루 평균 조회수가 다른 영상보다 얼마나 높은지' },
  { key: 'engagement', label: '반응', max: 35, meaning: '본 사람 중 좋아요·댓글을 남긴 비율이 다른 영상보다 얼마나 높은지' },
  { key: 'early', label: '초반 반응', max: 20, meaning: '올린 뒤 48시간 안에 조회수가 얼마나 빨리 늘었는지' }
] as const

function factorValue(row: ScoreboardRow, key: (typeof FACTORS)[number]['key']) {
  return key === 'velocity' ? row.viewVelocityScore : key === 'engagement' ? row.engagementScore : row.earlyGrowthScore
}

// 가장 강한/약한 요소를 한 줄로.
function reasonText(row: ScoreboardRow) {
  const usable = FACTORS.filter((f) => f.key !== 'early' || row.hasSnapshotData)
  const ranked = usable.map((f) => ({ f, ratio: factorValue(row, f.key) / f.max })).sort((a, b) => b.ratio - a.ratio)
  if (ranked.length === 0) return ''
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  if (row.tier === 'excellent' || row.tier === 'good') return `강점: ${best.f.label}`
  return `보완할 점: ${worst.f.label}`
}

function ScoreRow({ rank, row }: { rank: number; row: ScoreboardRow }) {
  const reason = reasonText(row)
  const title = row.video.title || '(제목 없음)'
  return (
    <li className="v5p-score-row">
      <div className="v5p-score-top">
        <span className={`v5-rank-badge ${rank <= 3 ? 'top' : ''}`}>{fmtNum(rank)}</span>
        <div className="v5p-score-main">
          <div className="v5p-score-title" title={row.video.title || ''}>
            {row.video.youtube_url ? (
              <a href={row.video.youtube_url} target="_blank" rel="noopener noreferrer" className="v5p-score-link" title="유튜브에서 영상 열기">
                {title}
              </a>
            ) : (
              title
            )}
          </div>
          <div className="small muted">
            {row.video.stock_name} · {row.video.owner_name || '담당자 없음'} · 조회수 {fmtNum(row.video.view_count ?? 0)}
            {reason ? ` · ${reason}` : ''}
          </div>
        </div>
        <div className="v5p-score-total">
          <div className="v5p-score-num">{fmtNum(row.totalScore)}</div>
          <Badge tone={TIER_TONE[row.tier]}>{SCORE_TIER_LABEL[row.tier]}</Badge>
        </div>
      </div>
      <details className="v5p-score-detail">
        <summary>점수 이유 보기</summary>
        <div className="v5p-bars">
          {FACTORS.map((f) => {
            const value = factorValue(row, f.key)
            const pending = f.key === 'early' && !row.hasSnapshotData
            return (
              <div className="v5p-bar-row" key={f.key}>
                <div className="v5p-bar-label">
                  <strong>{f.label}</strong>
                  <span className="small muted">{f.meaning}</span>
                </div>
                <div className="v5p-bar-track">
                  <div className={`v5p-bar-fill ${row.tier}`} style={{ width: `${(value / f.max) * 100}%` }} />
                </div>
                <div className="v5p-bar-value">
                  {value} / {f.max}
                  {pending ? <span className="small muted"> · 아직 기록이 없어 중간값</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      </details>
    </li>
  )
}

export default function ScoreboardPage() {
  const me = useV5Me()
  const { toast, showSuccess, showError } = useToast()
  const [days, setDays, daysReady] = usePref<Period>('v5.scoreboard.days', 30, isPeriod)
  const [owner, setOwner, ownerReady] = usePref<string>('v5.scoreboard.owner', '', (v): v is string => typeof v === 'string')
  const [data, setData] = useState<ScoreboardData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [limit, setLimit] = useState(PAGE_STEP)
  const seq = useRef(0)

  const prefsReady = daysReady && ownerReady

  const load = useCallback(async () => {
    const mine = ++seq.current
    setRefreshing(true)
    setLoadError('')
    const query = `days=${days}${owner ? `&owner=${encodeURIComponent(owner)}` : ''}`
    const res = await v5Get<ScoreboardData>(`/api/v5/scoreboard?${query}`)
    if (mine !== seq.current) return // 그 사이 필터를 또 바꿨다면 이전 응답은 버린다
    if (res.ok) {
      setData(res.data)
      // 저장돼 있던 담당자가 이 기간에 없으면(퇴사 등) 전체로 되돌린다.
      if (owner && !res.data.owners.some((o) => o.id === owner)) setOwner('')
    } else {
      setLoadError(errorText(res, '점수판을 불러오지 못했어요.'))
    }
    setRefreshing(false)
  }, [days, owner, setOwner])

  useEffect(() => {
    if (!prefsReady) return
    void load()
  }, [prefsReady, load])

  const changeDays = (value: `${Period}`) => {
    setLimit(PAGE_STEP)
    setDays(Number(value) as Period)
  }
  const changeOwner = (id: string) => {
    setLimit(PAGE_STEP)
    setOwner(id)
  }

  const onSync = async () => {
    setSyncing(true)
    try {
      const res = await v5Post<{ updated: number; failed: number; total: number; remaining: number; nothingToDo?: boolean; stopped?: string | null }>('/api/v5/sync-stats', {})
      if (!res.ok) {
        showError(errorText(res, '조회수를 새로 가져오지 못했어요. 잠시 뒤 다시 해 주세요.'))
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
      await load()
    } finally {
      setSyncing(false)
    }
  }

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
            <button className="button secondary" disabled={syncing} onClick={onSync} title="유튜브에서 최신 조회수·좋아요·댓글을 다시 가져와요">
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

      {loadError ? <LoadError message={loadError} onRetry={() => void load()} /> : null}
      {!data && !loadError ? <LoadingLine /> : null}

      {data ? (
        <div className={refreshing ? 'v5p-refreshing' : undefined}>
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
                    <strong>{top.video.title || top.video.stock_name}</strong> · {fmtNum(top.totalScore)}점
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

              <section className="v5p-board-card" aria-label="영상 순위">
                <div className="v5p-section-head">
                  <h2>영상 순위</h2>
                  <span className="small muted">
                    점수 높은 순 · {fmtNum(Math.min(limit, rows.length))} / {fmtNum(summary?.total ?? 0)}개 표시
                  </span>
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
                {data.since} 이후에 등록한 영상 기준{data.lastSyncedAt ? ` · 조회수 마지막 갱신 ${formatDateTime(data.lastSyncedAt)}` : ''}
                {data.snapshotsTruncated ? ' · 초반 반응 기록이 많아 일부만 반영했어요' : ''}
              </div>

              <details className="v5p-formula">
                <summary>점수 계산 방법</summary>
                <div className="v5p-formula-body">
                  <p>
                    점수는 <strong>같은 기간(최근 {data.days}일)에 등록한 다른 영상들과 비교한 순위</strong>예요. 세 가지를 더해서 100점 만점으로 계산해요.
                  </p>
                  <ul>
                    {FACTORS.map((f) => (
                      <li key={f.key}>
                        <strong>
                          {f.label} ({f.max}점)
                        </strong>{' '}
                        — {f.meaning}
                      </li>
                    ))}
                  </ul>
                  <p className="small muted">초반 반응은 올린 뒤 48시간 안의 조회수 기록이 있어야 계산돼요. 기록이 없으면 절반(10점)을 줘요.</p>
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
