'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AdminOnly } from '@/components/v2/auth-guard'
import { PageHeader } from '@/components/v2/app-shell'
import { Toast, useToast } from '@/components/toast'
import { Answer, EmptyGuide, FieldError, HowTo, InlineConfirm, Kpi, KpiRow, LoadError, LoadingLine, SampleNote } from '@/lib/v2/analysis-ui'
import { v2Delete, v2Get, v2Patch, v2Post } from '@/lib/v2/client'
import { addDays, formatYmdLabel, kstYmd, weekStartMonday, WEEKDAY_LABELS, weekdayOf } from '@/lib/v2/dates'
import { formatCount } from '@/lib/v2/format'
import { V2_MISSING_TABLE_MESSAGE } from '@/lib/v2/tables'
import type { PlannedSlot, PlannerPayload } from '@/lib/v2/types'

const EMPTY: PlannerPayload = {
  weekStart: kstYmd(),
  days: [],
  staff: [],
  planned: {},
  actual: {},
  timingHint: { weekday: null, hour: null, avgViews: 0, sampleSize: 0 }
}

const LOAD_ERROR = '업로드 계획을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const SAVE_ERROR = '계획을 저장하지 못했어요. 다시 시도해 주세요.'
const DUP_MESSAGE = '이 시간에는 이미 계획이 있어요. 다른 시간을 골라 주세요.'

type CellState = 'none' | 'future' | 'good' | 'bad' | 'pending'

// 열려 있는 입력 칸: 새로 추가하거나, 기존 계획(slot)을 고친다.
type Editor = { staffId: string; day: string; slot: PlannedSlot | null }

// 칸의 상태: 지난 날에 계획보다 적게 올렸으면 bad, 오늘은 아직 진행 중(pending), 앞으로 올 날은 future.
function cellState(day: string, today: string, planned: number, actual: number): CellState {
  if (planned === 0) return day > today ? 'future' : 'none'
  if (day > today) return 'future'
  if (actual >= planned) return 'good'
  return day === today ? 'pending' : 'bad'
}

// 이미 계획된 시간을 피해 다음으로 비어 있는 시간을 찾는다.
function nextFreeHour(used: number[], from: number): number {
  for (let i = 0; i < 24; i += 1) {
    const h = (from + i) % 24
    if (!used.includes(h)) return h
  }
  return from
}

function PlannerBody() {
  const { toast, showError } = useToast()
  const today = kstYmd()
  const [weekStart, setWeekStart] = useState(() => weekStartMonday(kstYmd()))
  const [payload, setPayload] = useState<PlannerPayload>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [hour, setHour] = useState(19)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const requestId = useRef(0)
  const hourRef = useRef<HTMLSelectElement>(null)

  const load = async (week: string) => {
    const id = ++requestId.current
    setLoading(true)
    const res = await v2Get<PlannerPayload>(`/api/v2/planner?weekStart=${week}`, LOAD_ERROR)
    // 주를 빠르게 넘길 때 늦게 도착한 이전 응답이 화면을 덮어쓰지 않게 한다.
    if (id !== requestId.current) return
    setLoading(false)
    setLoaded(true)
    if (!res.ok) {
      setLoadError(res.error)
      return
    }
    setLoadError('')
    setPayload(res.data)
  }

  useEffect(() => {
    setEditor(null)
    void load(weekStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  // 입력 칸이 열리면 첫 입력(시간)으로 포커스
  useEffect(() => {
    if (editor) hourRef.current?.focus()
  }, [editor?.staffId, editor?.day, editor?.slot?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const guardSample = () => {
    if (payload.sample) {
      setFormError(V2_MISSING_TABLE_MESSAGE)
      return true
    }
    return false
  }

  const hint = payload.timingHint
  const hasHint = hint.weekday !== null && hint.hour !== null

  const slotsOf = (staffId: string, day: string) => payload.planned[staffId]?.[day] || []

  const mutateSlots = (staffId: string, day: string, fn: (slots: PlannedSlot[]) => PlannedSlot[]) => {
    setPayload((prev) => ({
      ...prev,
      planned: { ...prev.planned, [staffId]: { ...prev.planned[staffId], [day]: fn(prev.planned[staffId]?.[day] || []).sort((a, b) => a.planned_hour - b.planned_hour) } }
    }))
  }

  const openAdd = (staffId: string, day: string) => {
    const used = slotsOf(staffId, day).map((s) => s.planned_hour)
    setEditor({ staffId, day, slot: null })
    setHour(nextFreeHour(used, hasHint ? (hint.hour as number) : 19))
    setNote('')
    setFormError('')
  }

  const openEdit = (staffId: string, day: string, slot: PlannedSlot) => {
    setEditor({ staffId, day, slot })
    setHour(slot.planned_hour)
    setNote(slot.note || '')
    setFormError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setFormError('')
  }

  const openStaff = editor ? payload.staff.find((s) => s.id === editor.staffId) : null
  const otherSlots = editor ? slotsOf(editor.staffId, editor.day).filter((s) => s.id !== editor.slot?.id) : []
  const duplicateHour = otherSlots.some((slot) => slot.planned_hour === hour)
  const unchanged = Boolean(editor?.slot && editor.slot.planned_hour === hour && (editor.slot.note || '') === note.trim())

  const submit = async () => {
    if (!editor || saving) return
    if (duplicateHour) {
      setFormError(DUP_MESSAGE)
      return
    }
    if (guardSample()) return
    setSaving(true)
    setFormError('')

    if (editor.slot) {
      const slot = editor.slot
      const res = await v2Patch<{ ok?: boolean; item?: PlannedSlot }>('/api/v2/planner', { id: slot.id, plannedHour: hour, note: note.trim() || null }, SAVE_ERROR)
      setSaving(false)
      if (!res.ok || !res.data.item) {
        setFormError(res.error || SAVE_ERROR)
        if (res.status === 404) {
          closeEditor()
          void load(weekStart)
        }
        return
      }
      const saved = res.data.item
      mutateSlots(editor.staffId, editor.day, (slots) => slots.map((s) => (s.id === saved.id ? saved : s)))
      closeEditor()
      return
    }

    const res = await v2Post<{ ok?: boolean; item?: PlannedSlot }>(
      '/api/v2/planner',
      { staffUserId: editor.staffId, plannedDate: editor.day, plannedHour: hour, note: note.trim() || null },
      SAVE_ERROR
    )
    setSaving(false)
    if (!res.ok || !res.data.item) {
      setFormError(res.error || SAVE_ERROR)
      return
    }
    const created = res.data.item
    const used = [...slotsOf(editor.staffId, editor.day).map((s) => s.planned_hour), created.planned_hour]
    mutateSlots(editor.staffId, editor.day, (slots) => [...slots, created])
    // 같은 칸에 이어서 넣을 수 있도록 입력 칸은 열어 두고, 다음 빈 시간으로 옮긴 뒤 처음 입력으로 포커스를 돌려준다.
    setHour(nextFreeHour(used, created.planned_hour + 1))
    setNote('')
    hourRef.current?.focus()
  }

  // 지우기: 칸에서 바로 사라지고, 실패하면 다시 나타난다.
  const removeSlot = async () => {
    if (!editor?.slot || deleting) return
    if (guardSample()) return
    const { staffId, day, slot } = editor
    setDeleting(true)
    mutateSlots(staffId, day, (slots) => slots.filter((s) => s.id !== slot.id))
    closeEditor()
    const res = await v2Delete(`/api/v2/planner?id=${encodeURIComponent(slot.id)}`, '계획을 지우지 못했어요. 다시 시도해 주세요.')
    setDeleting(false)
    if (!res.ok) {
      mutateSlots(staffId, day, (slots) => [...slots, slot])
      showError(res.error)
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
      {loaded && loadError ? <LoadError message={loadError} onRetry={() => void load(weekStart)} /> : null}

      {!loaded ? (
        <LoadingLine />
      ) : loadError && payload.days.length === 0 ? null : (
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
                  칸 안의 ‘+ 계획’을 눌러 올릴 시간을 정하고, 시간 칩을 누르면 고치거나 지울 수 있어요. 아래 숫자는 실제로 등록된 영상 수예요.
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
              <div className={`v2a-plan-scroll ${loading ? 'v2a-fading' : ''}`} aria-busy={loading}>
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
                        const slots = slotsOf(s.id, day)
                        const actualCount = payload.actual[s.id]?.[day] ?? 0
                        const plannedCount = slots.length
                        const state = cellState(day, today, plannedCount, actualCount)
                        const isOpen = editor?.staffId === s.id && editor.day === day
                        return (
                          <div className={`v2a-plan-cell ${state} ${isOpen ? 'selected' : ''}`} key={`${s.id}-${day}`}>
                            {slots.map((slot) => (
                              <div className={`v2a-plan-slot ${editor?.slot?.id === slot.id ? 'editing' : ''}`} key={slot.id} title={slot.note || `${slot.planned_hour}시 업로드 계획`}>
                                <button
                                  type="button"
                                  className="v2a-plan-slot-main"
                                  aria-label={`${s.name} ${formatYmdLabel(day)} ${slot.planned_hour}시 계획 고치기`}
                                  onClick={() => openEdit(s.id, day, slot)}
                                >
                                  {String(slot.planned_hour).padStart(2, '0')}:00
                                  {slot.note ? <span className="dot">•</span> : null}
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

            {editor && openStaff ? (
              <form
                className="v2a-plan-form"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    closeEditor()
                  }
                }}
              >
                <div style={{ flexBasis: '100%', fontWeight: 700, fontSize: 14 }}>
                  {openStaff.name} · {formatYmdLabel(editor.day)} {editor.slot ? '계획 고치기' : '계획 추가'}
                </div>
                <div className="field">
                  <label className="label" htmlFor="plan-hour">
                    몇 시에 올릴까요?
                  </label>
                  <select
                    id="plan-hour"
                    ref={hourRef}
                    className="select compact"
                    value={hour}
                    aria-invalid={duplicateHour}
                    onChange={(e) => {
                      setHour(Number(e.target.value))
                      setFormError('')
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00{hasHint && hint.hour === h ? ' (추천)' : ''}
                        {otherSlots.some((s) => s.planned_hour === h) ? ' · 이미 있음' : ''}
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
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="button success xs" type="submit" disabled={saving || deleting || duplicateHour || unchanged}>
                    {saving ? '저장 중…' : editor.slot ? '저장' : '추가'}
                  </button>
                  <button className="button secondary xs" type="button" disabled={saving} onClick={closeEditor}>
                    {editor.slot ? '취소' : '닫기'}
                  </button>
                  {editor.slot ? <InlineConfirm prompt="이 계획을 지울까요?" confirmLabel="지우기" label="지우기" busyLabel="지우는 중…" busy={deleting} disabled={saving} onConfirm={() => void removeSlot()} /> : null}
                </div>
                {duplicateHour ? <div className="v2a-field-warn" style={{ flexBasis: '100%' }}>{DUP_MESSAGE}</div> : null}
                {formError ? (
                  <div style={{ flexBasis: '100%' }}>
                    <FieldError>{formError}</FieldError>
                  </div>
                ) : null}
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
              <p>시간 칩 옆의 ‘•’ 표시는 메모가 있다는 뜻이에요. 담당자나 날짜를 바꾸고 싶으면 계획을 지우고 새로 추가해 주세요.</p>
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
