'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { AdminOnly } from '@/components/v2/auth-guard'
import { PageHeader } from '@/components/v2/app-shell'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { Answer, EmptyGuide, HowTo, Kpi, KpiRow, LoadingLine, SampleNote } from '@/lib/v2/analysis-ui'
import { authedDeleteJson } from '@/lib/v2/client'
import { addDays, formatYmdLabel, kstYmd, weekStartMonday, WEEKDAY_LABELS, weekdayOf } from '@/lib/v2/dates'
import { formatCount } from '@/lib/v2/format'
import { V2_MISSING_TABLE_MESSAGE } from '@/lib/v2/tables'
import type { PlannerPayload } from '@/lib/v2/types'

const EMPTY: PlannerPayload = {
  weekStart: kstYmd(),
  days: [],
  staff: [],
  planned: {},
  actual: {},
  timingHint: { weekday: null, hour: null, avgViews: 0, sampleSize: 0 }
}

type CellState = 'none' | 'future' | 'good' | 'bad' | 'pending'

// 칸의 상태: 지난 날에 계획보다 적게 올렸으면 bad, 오늘은 아직 진행 중(pending), 앞으로 올 날은 future.
function cellState(day: string, today: string, planned: number, actual: number): CellState {
  if (planned === 0) return day > today ? 'future' : 'none'
  if (day > today) return 'future'
  if (actual >= planned) return 'good'
  return day === today ? 'pending' : 'bad'
}

function PlannerBody() {
  const { toast, showSuccess, showError } = useToast()
  const today = kstYmd()
  const [weekStart, setWeekStart] = useState(() => weekStartMonday(kstYmd()))
  const [payload, setPayload] = useState<PlannerPayload>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [openCell, setOpenCell] = useState<{ staffId: string; day: string } | null>(null)
  const [hour, setHour] = useState(19)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const load = async (week: string) => {
    const { ok, data } = await authedFetchJson<PlannerPayload>(`/api/v2/planner?weekStart=${week}`)
    setLoaded(true)
    if (!ok) {
      showError(data?.error || '업로드 계획을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      return
    }
    setPayload(data)
  }

  useEffect(() => {
    void load(weekStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  const guardSample = () => {
    if (payload.sample) {
      showError(V2_MISSING_TABLE_MESSAGE)
      return true
    }
    return false
  }

  const hint = payload.timingHint
  const hasHint = hint.weekday !== null && hint.hour !== null

  const openAdd = (staffId: string, day: string) => {
    setOpenCell({ staffId, day })
    setHour(hasHint ? (hint.hour as number) : 19)
    setNote('')
  }

  const openStaff = openCell ? payload.staff.find((s) => s.id === openCell.staffId) : null
  const openSlots = openCell ? payload.planned[openCell.staffId]?.[openCell.day] || [] : []
  const duplicateHour = openSlots.some((slot) => slot.planned_hour === hour)

  const addSlot = async () => {
    if (!openCell || duplicateHour) return
    if (guardSample()) return
    setSaving(true)
    try {
      const { ok, data } = await authedPostJson<{ ok?: boolean; error?: string }>('/api/v2/planner', {
        staffUserId: openCell.staffId,
        plannedDate: openCell.day,
        plannedHour: hour,
        note: note.trim() || null
      })
      if (!ok) {
        showError(data?.error || '계획을 추가하지 못했어요. 다시 시도해 주세요.')
        return
      }
      showSuccess('계획을 추가했어요.')
      setOpenCell(null)
      await load(weekStart)
    } finally {
      setSaving(false)
    }
  }

  const removeSlot = async (id: string) => {
    if (guardSample()) return
    setRemovingId(id)
    try {
      const { ok, data } = await authedDeleteJson<{ ok?: boolean; error?: string }>(`/api/v2/planner?id=${id}`)
      if (!ok) {
        showError(data?.error || '계획을 지우지 못했어요. 다시 시도해 주세요.')
        return
      }
      showSuccess('계획을 지웠어요.')
      await load(weekStart)
    } finally {
      setRemovingId(null)
    }
  }

  // 이번 주 요약: 지나간 날(오늘 포함) 계획 중 얼마나 지켰는지
  const summary = useMemo(() => {
    let plannedAll = 0
    let plannedDue = 0
    let met = 0
    let behind = 0
    for (const s of payload.staff) {
      for (const day of payload.days) {
        const planned = payload.planned[s.id]?.[day]?.length || 0
        const actual = payload.actual[s.id]?.[day] ?? 0
        plannedAll += planned
        if (planned > 0 && day <= today) {
          plannedDue += planned
          met += Math.min(actual, planned)
          if (day < today && actual < planned) behind += 1
        }
      }
    }
    return { plannedAll, plannedDue, met, behind }
  }, [payload, today])

  const rangeLabel = `${formatYmdLabel(payload.days[0] || weekStart)} ~ ${formatYmdLabel(payload.days[6] || addDays(weekStart, 6))}`
  const thisWeek = weekStartMonday(today)
  const weekName = weekStart === thisWeek ? '이번 주' : '선택한 주'

  return (
    <>
      <PageHeader title="업로드 계획" subtitle="담당자별로 어느 요일에 영상을 올릴지 계획하고, 실제로 올렸는지 확인하는 곳이에요." />
      <Toast toast={toast} />
      <SampleNote show={payload.sample} />

      {!loaded ? (
        <LoadingLine />
      ) : (
        <>
          <Answer tone={summary.behind > 0 ? 'bad' : summary.plannedAll > 0 ? 'good' : 'neutral'}>
            {summary.plannedAll === 0 ? (
              <>{weekName}에 잡아 둔 업로드 계획이 없어요. 아래 표에서 담당자·요일 칸의 ‘+ 계획’을 눌러 추가해 보세요.</>
            ) : summary.plannedDue === 0 ? (
              <>{weekName} 계획은 <b>{summary.plannedAll}건</b>이에요. 아직 시작 전이라 확인할 결과는 없어요.</>
            ) : summary.behind > 0 ? (
              <>
                지나간 날 중 계획보다 적게 올린 칸이 <b>{summary.behind}개</b> 있어요. 계획 {summary.plannedDue}건 중 {summary.met}건을 채웠어요.
              </>
            ) : (
              <>
                지금까지 계획 {summary.plannedDue}건 중 <b>{summary.met}건</b>을 채웠어요. 밀린 곳은 없어요.
              </>
            )}
            {hasHint ? (
              <span className="v2a-sub" style={{ display: 'block', marginTop: 6, fontWeight: 500 }}>
                참고: 최근 영상을 보면 {WEEKDAY_LABELS[hint.weekday as number]}요일 {hint.hour}시에 올린 영상의 평균 조회수가 가장 높았어요 (평균 {formatCount(hint.avgViews)}회, 영상 {hint.sampleSize}개 기준).
                이 시간대에 계획을 몰아 보세요.
              </span>
            ) : (
              <span className="v2a-sub" style={{ display: 'block', marginTop: 6, fontWeight: 500 }}>
                아직 영상이 충분히 쌓이지 않아 ‘몇 시에 올리면 좋은지’는 알려드리기 어려워요.
              </span>
            )}
          </Answer>

          <KpiRow>
            <Kpi label={`${weekName} 계획`} value={summary.plannedAll.toLocaleString('ko-KR')} unit="건" hint="이 주에 올리기로 정해 둔 영상 수예요." />
            <Kpi
              label="지금까지 채운 계획"
              value={`${summary.met.toLocaleString('ko-KR')}/${summary.plannedDue.toLocaleString('ko-KR')}`}
              unit="건"
              tone={summary.plannedDue === 0 ? 'neutral' : summary.met >= summary.plannedDue ? 'good' : 'warn'}
              hint="오늘까지 계획한 것 중 실제로 등록된 영상 수예요."
            />
            <Kpi
              label="계획보다 적게 올린 칸"
              value={summary.behind.toLocaleString('ko-KR')}
              unit="칸"
              tone={summary.behind > 0 ? 'bad' : summary.plannedDue > 0 ? 'good' : 'neutral'}
              hint="이미 지난 날인데 계획보다 적게 등록한 담당자·요일이에요."
            />
          </KpiRow>

          <div className="panel">
            <div className="v2a-toolbar">
              <div>
                <div className="panel-title">{rangeLabel}</div>
                <p className="panel-subtitle" style={{ marginTop: 4 }}>
                  칸 안의 ‘+ 계획’을 눌러 올릴 시간을 정해요. 아래 숫자는 실제로 등록된 영상 수예요.
                </p>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="button secondary xs" onClick={() => setWeekStart((w) => addDays(w, -7))}>
                  ← 지난주
                </button>
                <button className="button secondary xs" disabled={weekStart === thisWeek} onClick={() => setWeekStart(thisWeek)}>
                  이번 주
                </button>
                <button className="button secondary xs" onClick={() => setWeekStart((w) => addDays(w, 7))}>
                  다음 주 →
                </button>
              </div>
            </div>

            {payload.staff.length === 0 ? (
              <EmptyGuide title="계획을 세울 직원이 없어요">활성 상태의 직원이 등록되면 이 표에 담당자별로 줄이 만들어져요.</EmptyGuide>
            ) : (
              <div className="v2a-plan-scroll">
                <div className="v2a-plan-grid">
                  <div />
                  {payload.days.map((day) => (
                    <div className={`v2a-plan-head ${day === today ? 'today' : ''}`} key={day}>
                      {WEEKDAY_LABELS[weekdayOf(day)]}
                      <small>
                        {Number(day.slice(5, 7))}/{Number(day.slice(8, 10))}
                        {day === today ? ' 오늘' : ''}
                      </small>
                    </div>
                  ))}
                  {payload.staff.map((s) => (
                    <Fragment key={s.id}>
                      <div className="v2a-plan-name">{s.name}</div>
                      {payload.days.map((day) => {
                        const slots = payload.planned[s.id]?.[day] || []
                        const actualCount = payload.actual[s.id]?.[day] ?? 0
                        const plannedCount = slots.length
                        const state = cellState(day, today, plannedCount, actualCount)
                        const isOpen = openCell?.staffId === s.id && openCell.day === day
                        return (
                          <div className={`v2a-plan-cell ${state} ${isOpen ? 'selected' : ''}`} key={`${s.id}-${day}`}>
                            {slots.map((slot) => (
                              <div className="v2a-plan-slot" key={slot.id} title={slot.note || `${slot.planned_hour}시 업로드 계획`}>
                                <span>{String(slot.planned_hour).padStart(2, '0')}:00</span>
                                <button type="button" disabled={removingId === slot.id} aria-label={`${slot.planned_hour}시 계획 지우기`} onClick={() => void removeSlot(slot.id)}>
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button type="button" className="v2a-plan-add" onClick={() => openAdd(s.id, day)}>
                              + 계획
                            </button>
                            <div className="v2a-plan-count">
                              {day > today && actualCount === 0 ? (plannedCount > 0 ? `${plannedCount}건 예정` : '') : `등록 ${actualCount}${plannedCount > 0 ? ` / 계획 ${plannedCount}` : ''}`}
                            </div>
                          </div>
                        )
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}

            {openCell && openStaff ? (
              <form
                className="v2a-plan-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!saving) void addSlot()
                }}
              >
                <div style={{ flexBasis: '100%', fontWeight: 700, fontSize: 14 }}>
                  {openStaff.name} · {formatYmdLabel(openCell.day)} 계획 추가
                </div>
                <div className="field">
                  <label className="label" htmlFor="plan-hour">
                    몇 시에 올릴까요?
                  </label>
                  <select id="plan-hour" className="select compact" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00{hasHint && hint.hour === h ? ' (추천)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 200 }}>
                  <label className="label" htmlFor="plan-note">
                    메모 (선택)
                  </label>
                  <input id="plan-note" className="input compact" maxLength={200} placeholder="예: 삼성전자 실적 영상" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="button success xs" type="submit" disabled={saving || duplicateHour}>
                    {saving ? '추가하는 중…' : '추가'}
                  </button>
                  <button className="button secondary xs" type="button" onClick={() => setOpenCell(null)}>
                    취소
                  </button>
                </div>
                {duplicateHour ? <div className="v2a-field-warn" style={{ flexBasis: '100%' }}>이 시간에는 이미 계획이 있어요. 다른 시간을 골라 주세요.</div> : null}
              </form>
            ) : null}

            <div className="v2a-legend">
              <span style={{ color: '#4ade80' }}>
                <i />
                계획대로 올렸어요
              </span>
              <span style={{ color: '#fbbf24' }}>
                <i />
                오늘 아직 진행 중
              </span>
              <span style={{ color: '#f87171' }}>
                <i />
                계획보다 적게 올렸어요
              </span>
              <span>
                <i style={{ borderStyle: 'dashed' }} />
                아직 오지 않은 날
              </span>
            </div>

            <HowTo>
              <p>칸의 ‘계획’은 그 담당자·요일에 정해 둔 시간 수, ‘등록’은 그날 실제로 등록된 영상 수예요. 등록이 계획 이상이면 초록색이에요.</p>
              <p>추천 시간은 최근 등록된 영상 500개를 요일·시간대별로 묶어 평균 조회수가 가장 높은 곳을 찾은 결과예요. 영상이 2개 미만인 시간대는 믿기 어려워 제외해요.</p>
            </HowTo>
          </div>
        </>
      )}
    </>
  )
}

export default function PlannerPage() {
  return (
    <AdminOnly>
      <PlannerBody />
    </AdminOnly>
  )
}
