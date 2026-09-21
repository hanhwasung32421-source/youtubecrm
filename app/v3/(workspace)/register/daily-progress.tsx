'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { parseGoal, progressCopy, progressPercent } from './register-logic'

// "오늘 N / 목표" 진행 막대 + 오늘 등록한 영상을 종목별로 묶은 작은 목록.
// 목표 개수는 이 브라우저에만 기억한다(기본 12개). 재촉하지 않는 차분한 문구만 쓴다.

export const DailyProgress = memo(function DailyProgress({
  count,
  goal,
  groups,
  loaded,
  onGoalChange
}: {
  count: number
  goal: number
  groups: { name: string; count: number }[]
  loaded: boolean // 목록을 아직 못 받았으면 숫자 대신 자리만 잡는다
  onGoalChange: (goal: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(goal))
  const inputRef = useRef<HTMLInputElement | null>(null)
  const editBtnRef = useRef<HTMLButtonElement | null>(null)
  const wasEditing = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.select()
    else if (wasEditing.current) editBtnRef.current?.focus()
    wasEditing.current = editing
  }, [editing])

  const percent = progressPercent(count, goal)
  const done = loaded && count >= goal

  const commit = () => {
    onGoalChange(parseGoal(draft))
    setEditing(false)
  }

  return (
    <div className="v3-progress" role="group" aria-label="오늘 등록 현황">
      <div className="v3-progress-top">
        <div className="v3-progress-num">
          <span className="v3-progress-label">오늘</span>
          <strong>{loaded ? count : '–'}</strong>
          <span className="v3-progress-goal"> / {goal}</span>
        </div>
        <div className="v3-progress-copy">{loaded ? progressCopy(count, goal) : ' '}</div>
        {editing ? (
          <form
            className="v3-progress-edit"
            onSubmit={(e) => {
              e.preventDefault()
              commit()
            }}
          >
            <label className="v3-progress-edit-label" htmlFor="v3-goal-input">목표</label>
            <input
              id="v3-goal-input"
              ref={inputRef}
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(false)
                }
              }}
            />
            <span className="v3-progress-edit-unit">개</span>
            <button type="submit" className="button xs">저장</button>
            <button type="button" className="button secondary xs" onClick={() => setEditing(false)}>취소</button>
          </form>
        ) : (
          <button
            ref={editBtnRef}
            type="button"
            className="v3-text-button v3-progress-change"
            onClick={() => {
              setDraft(String(goal))
              setEditing(true)
            }}
          >
            목표 바꾸기
          </button>
        )}
      </div>

      <div
        className={`v3-progress-bar ${done ? 'done' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(count, goal)}
        aria-valuetext={loaded ? `오늘 ${count}개 등록, 목표 ${goal}개` : '불러오는 중'}
      >
        <div className="v3-progress-fill" style={{ width: `${loaded ? percent : 0}%` }} />
      </div>

      {loaded && groups.length > 0 ? (
        <ul className="v3-progress-groups" aria-label="오늘 종목별 등록 개수">
          {groups.map((group) => (
            <li key={group.name}>
              <span className="v3-progress-stock">{group.name}</span>
              <span className="v3-progress-n">{group.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
})
