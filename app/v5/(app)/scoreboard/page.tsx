'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Badge, Kpi } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { AnswerBanner, EmptyBlock, LoadError, LoadingLine, fmtNum } from '@/lib/v5/page-parts'
import { SCORE_TIER_LABEL, type ScoreTier, type ScoreboardRow } from '@/lib/v5/types'

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
  return (
    <li className="v5p-score-row">
      <div className="v5p-score-top">
        <span className={`v5-rank-badge ${rank <= 3 ? 'top' : ''}`}>{fmtNum(rank)}</span>
        <div className="v5p-score-main">
          <div className="v5p-score-title" title={row.video.title || ''}>
            {row.video.title || '(제목 없음)'}
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
  const [rows, setRows] = useState<ScoreboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [limit, setLimit] = useState(20)
  const [owner, setOwner] = useState('')

  const load = async () => {
    setLoading(true)
    setLoadError('')
    const res = await authedFetchJson<{ items: ScoreboardRow[]; error?: string }>('/api/v5/scoreboard')
    if (res.ok) {
      setRows(res.data.items || [])
    } else {
      setLoadError(res.data?.error || '점수판을 불러오지 못했어요.')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const onSync = async () => {
    setSyncing(true)
    try {
      const res = await authedPostJson<{ updated: number; failed: number; error?: string }>('/api/v5/sync-stats', {})
      if (!res.ok) {
        showError(res.data?.error || '조회수를 새로 가져오지 못했어요.')
        return
      }
      showSuccess(`${fmtNum(res.data.updated)}개 영상의 조회수를 새로 가져왔어요.${res.data.failed ? ` (${fmtNum(res.data.failed)}개는 실패)` : ''}`)
      await load()
    } finally {
      setSyncing(false)
    }
  }

  const owners = useMemo(() => Array.from(new Set(rows.map((r) => r.video.owner_name).filter((n): n is string => Boolean(n)))).sort((a, b) => a.localeCompare(b, 'ko')), [rows])
  const visible = useMemo(() => (owner ? rows.filter((r) => r.video.owner_name === owner) : rows), [rows, owner])

  const stats = useMemo(() => {
    const total = visible.length
    const avg = total > 0 ? Math.round(visible.reduce((s, r) => s + r.totalScore, 0) / total) : 0
    const strong = visible.filter((r) => r.tier === 'excellent' || r.tier === 'good').length
    const weak = visible.filter((r) => r.tier === 'poor').length
    return { total, avg, strong, weak }
  }, [visible])

  const top = visible[0]

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

      {loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingLine />
      ) : rows.length === 0 ? (
        <EmptyBlock
          title="아직 점수를 낼 영상이 없어요"
          action={
            <Link className="button" href="/v5/register">
              영상 등록하러 가기
            </Link>
          }
        >
          영상을 등록하면 조회수·좋아요·댓글을 바탕으로 점수가 자동으로 매겨져요.
        </EmptyBlock>
      ) : (
        <>
          <AnswerBanner
            label="지금 점수가 가장 높은 영상"
            tone="good"
            aside={
              owners.length > 1 ? (
                <select className="select v5p-owner-select" value={owner} onChange={(e) => { setOwner(e.target.value); setLimit(20) }} aria-label="담당자별로 보기">
                  <option value="">모든 담당자</option>
                  {owners.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : null
            }
          >
            {top ? (
              <>
                <strong>{top.video.title || top.video.stock_name}</strong> · {fmtNum(top.totalScore)}점
                <span className="v5p-answer-sub">
                  {top.video.stock_name} · {top.video.owner_name || '담당자 없음'} · 최근 등록한 영상 {fmtNum(stats.total)}개 중 1등
                </span>
              </>
            ) : (
              <>이 담당자의 영상이 아직 없어요.</>
            )}
          </AnswerBanner>

          <div className="v5p-kpis">
            <Kpi
              label="평균 점수 (0~100)"
              value={
                <>
                  {fmtNum(stats.avg)}
                  <small>점</small>
                </>
              }
              meta="높을수록 유튜브가 잘 밀어주는 영상이에요"
              tone={stats.avg >= 60 ? 'green' : stats.avg < 40 ? 'red' : undefined}
            />
            <Kpi
              label="잘 되는 영상"
              value={
                <>
                  {fmtNum(stats.strong)}
                  <small>개</small>
                </>
              }
              meta="60점 이상 · 이 방식을 다음 영상에도 써 보세요"
              tone={stats.strong > 0 ? 'green' : undefined}
            />
            <Kpi
              label="손봐야 할 영상"
              value={
                <>
                  {fmtNum(stats.weak)}
                  <small>개</small>
                </>
              }
              meta="40점 미만 · 제목·썸네일을 다시 살펴보세요"
              tone={stats.weak > 0 ? 'red' : undefined}
            />
          </div>

          <section className="v5p-board-card" aria-label="영상 순위">
            <div className="v5p-section-head">
              <h2>영상 순위</h2>
              <span className="small muted">
                점수 높은 순 · {fmtNum(Math.min(limit, visible.length))} / {fmtNum(visible.length)}개 표시
              </span>
            </div>
            {visible.length === 0 ? (
              <div className="v5p-pick-empty">표시할 영상이 없어요.</div>
            ) : (
              <ul className="v5p-score-list">
                {visible.slice(0, limit).map((row, i) => (
                  <ScoreRow key={row.video.id} rank={i + 1} row={row} />
                ))}
              </ul>
            )}
            {visible.length > limit ? (
              <button className="button secondary sm" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + 20)}>
                더 보기 ({fmtNum(visible.length - limit)}개 남음)
              </button>
            ) : null}
          </section>

          <details className="v5p-formula">
            <summary>점수 계산 방법</summary>
            <div className="v5p-formula-body">
              <p>
                점수는 <strong>다른 영상들과 비교한 순위</strong>예요. 세 가지를 더해서 100점 만점으로 계산해요.
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
              <p className="small muted">
                초반 반응은 올린 뒤 48시간 안의 조회수 기록이 있어야 계산돼요. 기록이 없으면 절반(10점)을 줘요.
              </p>
              <p className="small muted">
                {SCORE_TIER_LABEL.excellent} 80점 이상 · {SCORE_TIER_LABEL.good} 60점 이상 · {SCORE_TIER_LABEL.fair} 40점 이상 · {SCORE_TIER_LABEL.poor} 40점 미만
              </p>
            </div>
          </details>
        </>
      )}

      <Toast toast={toast} />
    </>
  )
}
