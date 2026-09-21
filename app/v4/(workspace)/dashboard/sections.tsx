'use client'

// 성장 현황의 아래쪽 구역들. 위쪽(한눈에 요약 · 다음 할 일 · 핵심 숫자)이 먼저 그려지도록 따로 떼어 두었고,
// 각 구역은 memo 라서 목표 칸에 글자를 쳐도 목록·그래프가 다시 그려지지 않는다.

import dynamic from 'next/dynamic'
import { memo, useEffect, useRef, useState } from 'react'
import { ProgressRing, ShareBar } from '@/components/v4/mini-charts'
import { ChartSkeleton } from '@/components/v4/skeleton'
import { SampleBanner, EmptyState } from '@/components/v4/ui'
import { useInView } from '@/components/v4/use-in-view'
import type { DailyPoint } from '@/lib/v4/analytics'
import { fmtCompact, fmtNumber, fmtRelative } from '@/lib/v4/format'
import { goalProgress, goalSummaryText, type GoalNumbers } from './goal-math'

// 일별 그래프는 크기가 커서, 화면에 가까워질 때 내려받는다.
const TimelineChart = dynamic(() => import('@/components/v4/charts').then((m) => m.TimelineChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={230} />
})

export type FeedItem = {
  id: string
  title: string
  stockName: string
  ownerName: string
  contentType: string
  viewCount: number
  createdAt: string
  thumbnailUrl: string | null
  youtubeUrl: string
}

export type GoalInfo = GoalNumbers & {
  month: string
  teamGoal: { targetVideos: number; targetViews: number } | null
  sample: boolean
}

const GOAL_SCOPE_LABEL: Record<GoalNumbers['scope'], string> = {
  team: '팀 목표',
  user: '개인 목표',
  derived: '팀 목표를 인원수로 나눈 값',
  none: '목표 미설정'
}

// ------------------------------------------------------------------ 하루하루의 흐름

export const TimelineBody = memo(function TimelineBody({ points, target, longform, shortform }: { points: DailyPoint[]; target: number; longform: number; shortform: number }) {
  const { ref, seen } = useInView<HTMLDivElement>()
  return (
    <>
      <div ref={ref}>{seen ? <TimelineChart points={points} target={target} /> : <ChartSkeleton height={230} />}</div>
      <div className="v4-share-row">
        <div className="card-title">롱폼 · 숏폼 비중</div>
        <ShareBar a={longform} b={shortform} />
      </div>
    </>
  )
})

// ------------------------------------------------------------------ 방금 올라온 영상

export const FeedList = memo(function FeedList({ items, showOwner }: { items: FeedItem[]; showOwner: boolean }) {
  return (
    <ul className="v4-feed">
      {items.map((item) => (
        <li className={`v4-feed-item ${item.contentType === 'shortform' ? 'short' : ''}`} key={item.id}>
          {item.thumbnailUrl ? (
            <img className="v4-thumb" src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" width={72} height={42} />
          ) : (
            <div className="v4-thumb-placeholder" aria-hidden="true">
              썸네일 없음
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="v4-feed-title">
              {item.youtubeUrl ? (
                <a href={item.youtubeUrl} target="_blank" rel="noopener noreferrer" title={item.title}>
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </div>
            <div className="v4-feed-meta">
              <span>종목 {item.stockName}</span>
              {showOwner ? <span>담당 {item.ownerName}</span> : null}
              <span>{item.contentType === 'shortform' ? '숏폼' : '롱폼'}</span>
            </div>
          </div>
          <div className="v4-feed-right">
            <strong>{fmtNumber(item.viewCount)}회</strong>
            {fmtRelative(item.createdAt)}
          </div>
        </li>
      ))}
    </ul>
  )
})

// ------------------------------------------------------------------ 이번 달 목표

// state: 값을 아직 못 받았으면 loading, 못 불러왔으면 error.
// 입력 칸의 글자는 이 안에서만 다룬다 → 글자를 칠 때 대시보드 전체가 다시 그려지지 않는다.
export const GoalSection = memo(function GoalSection({
  goal,
  state,
  isAdmin,
  onSave
}: {
  goal: GoalInfo | null
  state: 'ready' | 'loading' | 'error'
  isAdmin: boolean
  onSave: (input: { month: string; targetVideos: number; targetViews: number }) => Promise<boolean>
}) {
  const [videos, setVideos] = useState('')
  const [views, setViews] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirtyRef = useRef(false)
  const aliveRef = useRef(true)

  // 새로 받은 목표를 칸에 채운다. 고치는 중인 칸은 덮어쓰지 않는다.
  const teamVideos = goal?.teamGoal?.targetVideos
  const teamViews = goal?.teamGoal?.targetViews
  useEffect(() => {
    if (dirtyRef.current) return
    if (teamVideos !== undefined && teamViews !== undefined) {
      setVideos(String(teamVideos))
      setViews(String(teamViews))
    }
  }, [teamVideos, teamViews])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const progress = goalProgress(goal)

  const save = async () => {
    if (!goal || saving) return
    const targetVideos = Number(videos.trim() === '' ? 0 : videos)
    const targetViews = Number(views.trim() === '' ? 0 : views)
    if (!Number.isInteger(targetVideos) || targetVideos < 0 || !Number.isInteger(targetViews) || targetViews < 0) {
      setError('0 이상의 숫자(소수점 없이)로 적어 주세요.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const ok = await onSave({ month: goal.month, targetVideos, targetViews })
      if (ok) dirtyRef.current = false
    } finally {
      if (aliveRef.current) setSaving(false)
    }
  }

  return (
    <details className="panel v4-goal">
      <summary>
        <span className="v4-goal-title">{goal?.month || '이번 달'} 목표</span>
        <span className="v4-goal-summary">{goal ? goalSummaryText(goal) : ''}</span>
      </summary>
      <div className="v4-goal-body">
        <SampleBanner show={Boolean(goal?.sample)} what="이번 달 목표" />
        {goal && goal.scope !== 'none' ? (
          <>
            <p className="small muted">{GOAL_SCOPE_LABEL[goal.scope]} 기준으로, 이번 달 1일부터 오늘까지 얼마나 채웠는지 보여 줘요.</p>
            <div className="v4-ring-row">
              {progress.hasVideoTarget ? <ProgressRing value={progress.videoRatio} label="영상 수" sublabel={`${fmtNumber(goal.actualVideos)} / ${fmtNumber(goal.targetVideos)}개`} /> : null}
              {progress.hasViewTarget ? (
                <ProgressRing value={progress.viewRatio} label="조회수" sublabel={`${fmtCompact(goal.actualViews)} / ${fmtCompact(goal.targetViews)}`} color="#10b981" />
              ) : null}
              {!progress.hasVideoTarget && !progress.hasViewTarget ? <p className="small muted">목표 숫자가 모두 0이라 달성률을 그릴 수 없어요.</p> : null}
            </div>
          </>
        ) : goal ? (
          <EmptyState title="이번 달 목표가 아직 없어요">
            {isAdmin ? '아래에서 팀 목표를 정하면 달성률이 여기에 나와요.' : '관리자가 팀 목표를 정하면, 나에게 맞게 나눈 목표가 여기에 나와요.'}
          </EmptyState>
        ) : (
          <div className="small muted">{state === 'error' ? '목표를 불러오지 못했어요.' : '불러오는 중…'}</div>
        )}

        {isAdmin && goal ? (
          <form
            className="v4-goal-edit"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="panel-title">팀 목표 정하기</div>
            <p className="small muted">팀 전체가 이번 달에 달성할 영상 수와 조회수예요. 직원 화면에는 인원수로 나눈 값이 보여요.</p>
            <div className="v4-goal-form">
              <div className="field">
                <label className="label" htmlFor="v4-goal-videos">
                  목표 영상 수 (개)
                </label>
                <input
                  id="v4-goal-videos"
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  autoComplete="off"
                  value={videos}
                  onChange={(e) => {
                    dirtyRef.current = true
                    setVideos(e.target.value)
                    setError('')
                  }}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="v4-goal-views">
                  목표 조회수 (회)
                </label>
                <input
                  id="v4-goal-views"
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  autoComplete="off"
                  value={views}
                  onChange={(e) => {
                    dirtyRef.current = true
                    setViews(e.target.value)
                    setError('')
                  }}
                />
              </div>
              <button type="submit" className="button" disabled={saving}>
                {saving ? '저장 중…' : '목표 저장'}
              </button>
            </div>
            {error ? (
              <div className="v4-hint warn" role="alert">
                {error}
              </div>
            ) : null}
          </form>
        ) : null}
      </div>
    </details>
  )
})
