'use client'

import Link from 'next/link'
import { useState } from 'react'
import { authedPostJson } from '@/lib/session/authed-fetch'
import { fmtNumber } from '@/lib/v4/format'
import type { ChecklistStep, NextAction } from '@/components/v4/next-actions'
import { Skel, SkelRegion } from '@/components/v4/skeleton'

// 성장 현황 맨 위 "다음 할 일". 카드 1~3개(이유 한 문장 + 버튼 하나) 또는, 영상이 아직 없을 때는 시작하기 3단계 체크리스트.
export function NextActionsPanel({
  loading,
  cards,
  checklist,
  isAdmin,
  syncing,
  onSync,
  goalMonth,
  goalSuggest,
  onGoalSaved
}: {
  loading: boolean
  cards: NextAction[]
  checklist: { steps: ChecklistStep[]; doneCount: number } | null
  isAdmin: boolean
  syncing: boolean
  onSync: () => void
  goalMonth: string
  goalSuggest: number
  onGoalSaved: () => void
}) {
  const [goalOpen, setGoalOpen] = useState(false)

  return (
    <section className="panel v4-next" aria-label="다음 할 일" aria-busy={loading || undefined}>
      <div className="v4-next-head">
        <div className="v4-hero-kicker">다음 할 일</div>
        {checklist ? <span className="v4-next-note">{checklist.doneCount} / {checklist.steps.length} 단계 완료</span> : null}
      </div>

      {loading ? (
        <SkelRegion label="다음 할 일을 정리하는 중">
          <div aria-hidden="true" className="v4-next-skel">
            <Skel w="46%" h={16} />
            <Skel w="82%" h={12} style={{ marginTop: 10, display: 'block' }} />
          </div>
        </SkelRegion>
      ) : checklist ? (
        <>
          <p className="v4-next-lead">아직 등록된 영상이 없어요. 아래 3단계를 차례로 하면 이 화면이 채워져요.</p>
          <ol className="v4-steps">
            {checklist.steps.map((step, index) => {
              const previousDone = checklist.steps.slice(0, index).every((s) => s.done)
              return (
                <li className={`v4-step ${step.done ? 'done' : ''}`} key={step.key}>
                  <span className="v4-step-mark" aria-hidden="true">
                    {step.done ? '✓' : ''}
                  </span>
                  <span className="v4-step-label">
                    {step.label}
                    <span className="v4-sr">{step.done ? ' (완료)' : ' (아직)'}</span>
                  </span>
                  <span className="v4-step-action">
                    {step.done ? (
                      <span className="v4-step-done">완료</span>
                    ) : step.key === 'register' ? (
                      <Link className="button v4-mini v4-touch" href="/v4/register">
                        영상 등록하러 가기
                      </Link>
                    ) : step.key === 'sync' ? (
                      isAdmin ? (
                        <button type="button" className="button secondary v4-mini v4-touch" onClick={onSync} disabled={syncing || !previousDone} title={previousDone ? undefined : '먼저 영상이 등록돼야 해요'}>
                          {syncing ? '받는 중…' : '조회수 받기'}
                        </button>
                      ) : (
                        <span className="v4-step-wait">관리자가 해요</span>
                      )
                    ) : isAdmin ? (
                      <button type="button" className="button secondary v4-mini v4-touch" onClick={() => setGoalOpen((v) => !v)} aria-expanded={goalOpen}>
                        {goalOpen ? '접기' : '목표 정하기'}
                      </button>
                    ) : (
                      <span className="v4-step-wait">관리자가 해요</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
          {isAdmin && goalOpen ? <GoalInline month={goalMonth} suggest={goalSuggest} onSaved={() => { setGoalOpen(false); onGoalSaved() }} /> : null}
        </>
      ) : (
        <ol className="v4-next-list">
          {cards.map((card, index) => (
            <li className={`v4-next-card tone-${card.tone}`} key={card.id}>
              <span className="v4-next-rank" aria-hidden="true">
                {index + 1}
              </span>
              <div className="v4-next-body">
                <div className="v4-next-title">{card.title}</div>
                <p className="v4-next-reason">{card.reason}</p>
                {card.action.kind === 'goal' && goalOpen ? <GoalInline month={goalMonth} suggest={goalSuggest} onSaved={() => { setGoalOpen(false); onGoalSaved() }} /> : null}
              </div>
              <div className="v4-next-action">
                {card.action.kind === 'link' ? (
                  <Link className={`button v4-touch ${index === 0 ? '' : 'secondary'}`} href={card.action.href}>
                    {card.action.label}
                  </Link>
                ) : card.action.kind === 'sync' ? (
                  <button type="button" className={`button v4-touch ${index === 0 ? '' : 'secondary'}`} onClick={onSync} disabled={syncing}>
                    {syncing ? '받는 중…' : card.action.label}
                  </button>
                ) : (
                  <button type="button" className={`button v4-touch ${index === 0 ? '' : 'secondary'}`} onClick={() => setGoalOpen((v) => !v)} aria-expanded={goalOpen}>
                    {goalOpen ? '접기' : card.action.label}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// 목표를 카드 안에서 바로 정한다 (영상 수만 넣어도 저장돼요). 저장 API 는 기존 /api/v4/goals.
function GoalInline({ month, suggest, onSaved }: { month: string; suggest: number; onSaved: () => void }) {
  const [videos, setVideos] = useState('')
  const [views, setViews] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (saving) return
    const targetVideos = Number(videos)
    if (!videos.trim() || !Number.isFinite(targetVideos) || targetVideos < 1 || !Number.isInteger(targetVideos)) {
      setError('목표 영상 수를 1 이상의 숫자로 적어 주세요.')
      return
    }
    const targetViews = views.trim() ? Number(views) : 0
    if (!Number.isFinite(targetViews) || targetViews < 0 || !Number.isInteger(targetViews)) {
      setError('목표 조회수는 0 이상의 숫자로 적거나, 비워 두세요.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { ok, status, data } = await authedPostJson<{ error?: string }>('/api/v4/goals', { month, userId: null, targetVideos, targetViews })
      if (!ok || data?.error) {
        setError(
          status === 401
            ? '로그인이 풀렸어요. 화면을 새로고침해서 다시 로그인한 뒤 저장해 주세요.'
            : `${data?.error || '목표를 저장하지 못했어요.'} 잠시 후 다시 눌러 주세요.`
        )
        return
      }
      onSaved()
    } catch {
      setError('인터넷 연결이 끊긴 것 같아요. 입력한 숫자는 그대로예요. 연결을 확인하고 다시 저장해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="v4-next-goal"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="field">
        <label className="label" htmlFor="v4-next-goal-videos">
          이번 달 팀 목표 영상 수 (개)
        </label>
        <input
          id="v4-next-goal-videos"
          className="input"
          type="number"
          min={1}
          inputMode="numeric"
          autoComplete="off"
          placeholder={suggest > 0 ? `예: ${fmtNumber(suggest)}` : ''}
          value={videos}
          onChange={(e) => {
            setVideos(e.target.value)
            setError('')
          }}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="v4-next-goal-views">
          목표 조회수 (회, 선택)
        </label>
        <input
          id="v4-next-goal-views"
          className="input"
          type="number"
          min={0}
          inputMode="numeric"
          autoComplete="off"
          value={views}
          onChange={(e) => {
            setViews(e.target.value)
            setError('')
          }}
        />
      </div>
      <button type="submit" className="button v4-touch" disabled={saving}>
        {saving ? '저장 중…' : '목표 저장'}
      </button>
      <div className="v4-next-goal-msg">
        {error ? (
          <span className="v4-hint warn" role="alert">
            {error}
          </span>
        ) : (
          <span className="v4-hint">직원 화면에는 인원수로 나눈 값이 보여요. 나중에 아래 &quot;목표&quot; 칸에서 고칠 수 있어요.</span>
        )}
      </div>
    </form>
  )
}
