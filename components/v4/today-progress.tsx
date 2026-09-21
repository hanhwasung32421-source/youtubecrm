'use client'

import { memo } from 'react'
import { progressCopy, type StockCount } from '@/components/v4/register-logic'

// 화면 위쪽의 작은 "오늘 N / 목표" 표시 (숫자 + 막대).
export const TodayChip = memo(function TodayChip({ count, target, source }: { count: number | null; target: number; source: 'personal' | 'default' }) {
  const copy = progressCopy(count, target)
  const label = source === 'personal' ? '내 이번 달 목표를 날짜 수로 나눈 값이에요' : '기본 목표예요 (관리자가 개인 목표를 정하면 그 값으로 바뀌어요)'
  return (
    <div className="v4-today-chip" title={`오늘(한국 시간) 내가 등록한 영상 수 · 하루 목표 ${target}개 · ${label}`}>
      <div>
        오늘 <strong>{count === null ? '–' : count}</strong> / {target}개 <span className="v4-today-goal">· 하루 목표</span>
      </div>
      <div className="v4-today-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={count ?? 0} aria-label="오늘 등록 진행">
        <span className={copy.tone === 'done' ? 'done' : ''} style={{ width: `${Math.round(copy.ratio * 100)}%` }} />
      </div>
    </div>
  )
})

// 오늘 등록한 영상을 종목별로 묶어 보여 주는 작은 카드. 차분한 한 줄 응원과 함께.
export const TodayPanel = memo(function TodayPanel({ count, target, groups, showGroups }: { count: number | null; target: number; groups: StockCount[]; showGroups: boolean }) {
  const copy = progressCopy(count, target)
  const listed = groups.reduce((sum, g) => sum + g.count, 0)
  const others = count !== null && count > listed ? count - listed : 0
  return (
    <div className="panel v4-today-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">오늘 등록한 종목</div>
          <p className="panel-subtitle" aria-live="polite">
            {copy.text || '오늘 등록 수를 불러오는 중이에요.'}
          </p>
        </div>
      </div>
      {showGroups && groups.length > 0 ? (
        <ul className="v4-today-groups" aria-label="오늘 등록한 종목별 개수">
          {groups.map((g) => (
            <li className="v4-today-group" key={g.stock}>
              <span>{g.stock}</span>
              <strong>{g.count}개</strong>
            </li>
          ))}
          {others > 0 ? (
            <li className="v4-today-group quiet" title="목록에 아직 불러오지 못한 영상이에요">
              <span>그 밖</span>
              <strong>{others}개</strong>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
})
