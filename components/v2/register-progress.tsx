'use client'

import { useEffect, useRef, useState } from 'react'
import { clampGoal, progressSummary, type StockCount } from './register-flow'

const MAX_CHIPS = 10

type Props = {
  count: number
  goal: number
  onGoalChange: (goal: number) => void
  // 관리자는 팀 전체 영상이 함께 보이므로 개인 목표 막대 대신 개수만 보여 준다
  teamView: boolean
  loaded: boolean
}

// "오늘 7 / 12" 진행 막대 + 차분한 한 줄 문구. 목표 숫자는 눌러서 바꿀 수 있다(이 기기에 저장).
export function TodayProgress({ count, goal, onGoalChange, teamView, loaded }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(goal))
  const inputRef = useRef<HTMLInputElement | null>(null)
  const editBtnRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  const settled = useRef(false)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      editBtnRef.current?.focus()
    }
  }, [editing])

  if (teamView) {
    return (
      <div className="v2-progress" role="group" aria-label="오늘 등록 현황">
        <div className="v2-progress-head">
          <span className="v2-progress-count">
            오늘 팀 전체 <b>{loaded ? count : '–'}</b>개 등록
          </span>
          <span className="v2-progress-msg">담당자별 순위는 「성과 요약」에서 볼 수 있어요.</span>
        </div>
      </div>
    )
  }

  const p = progressSummary(count, goal)

  const commit = () => {
    settled.current = true
    onGoalChange(clampGoal(draft))
    restoreFocus.current = true
    setEditing(false)
  }

  return (
    <div className="v2-progress" role="group" aria-label="오늘 등록 현황">
      <div className="v2-progress-head">
        <span className="v2-progress-count">
          오늘 <b>{loaded ? count : '–'}</b> / {editing ? null : goal}
          {editing ? (
            <>
              <label className="v2-sr-only" htmlFor="v2-goal-input">
                하루 목표 영상 수
              </label>
              <input
                id="v2-goal-input"
                ref={inputRef}
                className="input compact v2-goal-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    commit()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.nativeEvent.stopPropagation()
                    settled.current = true
                    restoreFocus.current = true
                    setEditing(false)
                  }
                }}
                onBlur={() => {
                  if (!settled.current) {
                    onGoalChange(clampGoal(draft))
                    setEditing(false)
                  }
                }}
              />
              개
            </>
          ) : null}
        </span>
        <span className="v2-progress-msg" aria-live="polite">
          {loaded ? p.message : ''}
        </span>
        {!editing ? (
          <button
            ref={editBtnRef}
            type="button"
            className="v2-text-btn v2-goal-btn"
            onClick={() => {
              setDraft(String(goal))
              settled.current = false
              setEditing(true)
            }}
          >
            목표 {goal}개 바꾸기
          </button>
        ) : null}
      </div>
      <div
        className={`v2-progress-track ${p.done ? 'done' : ''}`}
        role="progressbar"
        aria-label="오늘 등록 진행"
        aria-valuemin={0}
        aria-valuemax={clampGoal(goal)}
        aria-valuenow={Math.min(count, clampGoal(goal))}
        aria-valuetext={`목표 ${clampGoal(goal)}개 중 ${count}개 등록`}
      >
        <div className="v2-progress-fill" style={{ width: `${loaded ? p.pct : 0}%` }} />
      </div>
    </div>
  )
}

// 오늘 다룬 종목: 종목별 개수(많은 순). 눌러서 고르는 칩이 아니라 "오늘 뭘 다뤘는지" 확인용 목록.
export function TodayStocks({ groups }: { groups: StockCount[] }) {
  if (groups.length === 0) return null
  const shown = groups.slice(0, MAX_CHIPS)
  const rest = groups.length - shown.length
  return (
    <div className="v2-today-stocks">
      <span className="small muted" id="v2-today-stocks-label">
        오늘 다룬 종목
      </span>
      <ul className="v2-chips v2-today-list" aria-labelledby="v2-today-stocks-label">
        {shown.map((g) => (
          <li className="v2-chip" key={g.stock}>
            {g.stock} <b>{g.count}</b>
          </li>
        ))}
        {rest > 0 ? <li className="v2-chip v2-chip-rest">외 {rest}종목</li> : null}
      </ul>
    </div>
  )
}
