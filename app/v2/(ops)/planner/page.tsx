'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AdminOnly } from '@/components/v2/auth-guard'
import { PageHeader } from '@/components/v2/app-shell'
import { Toast, useToast } from '@/components/toast'
import { NextSteps } from '@/lib/v2/actions-ui'
import { Answer, EmptyGuide, FieldError, HowTo, InlineConfirm, Kpi, KpiRow, LoadError, RefreshNote, SkeletonPlanner, SkeletonSummary } from '@/lib/v2/analysis-ui'
import { v2Delete, v2Patch, v2Post } from '@/lib/v2/client'
import type { CsvValue } from '@/lib/v2/csv'
import { addDays, formatYmdLabel, isRealYmd, kstYmd, weekStartMonday, WEEKDAY_LABELS, weekdayOf } from '@/lib/v2/dates'
import { ActiveFilters, type FilterChip } from '@/lib/v2/filters-ui'
import { withQuery, type FilterSpec } from '@/lib/v2/filters'
import { formatCountOrDash, safeRatio } from '@/lib/v2/format'
import { GlossaryDetails, Term } from '@/lib/v2/glossary-ui'
import type { NextLink } from '@/lib/v2/next-actions'
import { STATE_SYMBOL, STATE_WORD, behindByStaff, cellState, countLabel, nextFreeHour, summarizePlan } from '@/lib/v2/plan-state'
import { ShareBar } from '@/lib/v2/share-ui'
import { useV2Query } from '@/lib/v2/swr'
import { describeTiming, slotLabel } from '@/lib/v2/timing'
import { useUrlFilters } from '@/lib/v2/use-url-filters'
import type { PlannedSlot, PlannerPayload } from '@/lib/v2/types'

const EMPTY: PlannerPayload = {
  weekStart: kstYmd(),
  days: [],
  staff: [],
  planned: {},
  actual: {},
  timingHint: { weekday: null, hour: null, avgViews: 0, sampleSize: 0 }
}

const isPlanner = (data: unknown) => {
  const d = data as Partial<PlannerPayload> | null
  return Boolean(d && Array.isArray(d.days) && Array.isArray(d.staff) && d.planned && typeof d.planned === 'object' && d.actual && typeof d.actual === 'object' && d.timingHint)
}

const LOAD_ERROR = '업로드 계획을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const SAVE_ERROR = '계획을 저장하지 못했어요. 다시 시도해 주세요.'
const DUP_MESSAGE = '이 시간에는 이미 계획이 있어요. 다른 시간을 골라 주세요.'

// 주소(?week=2026-09-14&staff=…)와 같은 이름이라, 링크로 공유·북마크할 수 있다. week 는 그 주 월요일 날짜(비우면 이번 주).
const FILTER_SPEC = {
  week: { default: '', pattern: /^\d{4}-\d{2}-\d{2}$/, transient: true },
  staff: { default: '' }
} as const satisfies FilterSpec

// 열려 있는 입력 칸: 새로 추가하거나, 기존 계획(slot)을 고친다.
type Editor = { staffId: string; day: string; slot: PlannedSlot | null }

function PlannerBody() {
  const { toast, showError } = useToast()
  const today = kstYmd()
  const { filters, setFilters, reset, shareHref } = useUrlFilters('planner', FILTER_SPEC)
  const thisWeek = weekStartMonday(today)
  // 주소의 날짜가 잘못됐거나 없으면 이번 주. 어느 날짜든 그 주 월요일로 맞춘다.
  const weekStart = weekStartMonday(isRealYmd(filters.week) ? filters.week : today)
  const setWeekStart = (fn: (w: string) => string) => {
    const next = weekStartMonday(fn(weekStart))
    setFilters({ week: next === thisWeek ? '' : next })
  }
  // 주를 넘길 때마다 그 주 주소로 조회한다. 이미 본 주는 바로 보이고, 빠르게 넘기면 앞선 요청은 취소된다.
  const query = useV2Query<PlannerPayload>(`/api/v2/planner?weekStart=${weekStart}`, { fallback: LOAD_ERROR, validate: isPlanner })
  // 새 주를 받는 동안에는 직전 주 표를 흐리게 남겨 화면이 깜빡이지 않게 한다.
  const lastRef = useRef<PlannerPayload | null>(null)
  if (query.data) lastRef.current = query.data
  const staleData = !query.data && !query.error ? lastRef.current : null
  const payload = query.data ?? staleData ?? EMPTY
  const switching = Boolean(staleData)
  const loaded = Boolean(query.data || staleData) || Boolean(query.error)
  const loadError = query.error

  const [editor, setEditor] = useState<Editor | null>(null)
  const [hour, setHour] = useState(19)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const savingRef = useRef(false)
  const deletingRef = useRef(false)
  const hourRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    setEditor(null)
  }, [weekStart])

  // 입력 칸이 열리면 첫 입력(시간)으로 포커스
  useEffect(() => {
    if (editor) hourRef.current?.focus()
  }, [editor?.staffId, editor?.day, editor?.slot?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const hint = payload.timingHint
  const hasHint = hint.weekday !== null && hint.hour !== null

  const slotsOf = (staffId: string, day: string) => payload.planned[staffId]?.[day] || []

  const mutateSlots = (staffId: string, day: string, fn: (slots: PlannedSlot[]) => PlannedSlot[]) => {
    query.setData((prev) => ({
      ...prev,
      planned: { ...prev.planned, [staffId]: { ...prev.planned[staffId], [day]: fn(prev.planned[staffId]?.[day] || []).sort((a, b) => a.planned_hour - b.planned_hour) } }
    }))
  }

  const openAdd = (staffId: string, day: string) => {
    if (switching) return
    const used = slotsOf(staffId, day).map((s) => s.planned_hour)
    setEditor({ staffId, day, slot: null })
    setHour(nextFreeHour(used, hasHint ? (hint.hour as number) : 19))
    setNote('')
    setFormError('')
  }

  const openEdit = (staffId: string, day: string, slot: PlannedSlot) => {
    if (switching) return
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
    if (!editor || saving || savingRef.current) return
    if (duplicateHour) {
      setFormError(DUP_MESSAGE)
      return
    }
    savingRef.current = true
    setSaving(true)
    setFormError('')

    if (editor.slot) {
      const slot = editor.slot
      const res = await v2Patch<{ ok?: boolean; item?: PlannedSlot }>('/api/v2/planner', { id: slot.id, plannedHour: hour, note: note.trim() || null }, SAVE_ERROR)
      savingRef.current = false
      setSaving(false)
      query.noteStatus(res.status)
      if (!res.ok || !res.data.item) {
        setFormError(res.error || SAVE_ERROR)
        if (res.status === 404) {
          closeEditor()
          query.reload()
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
    savingRef.current = false
    setSaving(false)
    query.noteStatus(res.status)
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
    if (!editor?.slot || deleting || deletingRef.current) return
    const { staffId, day, slot } = editor
    deletingRef.current = true
    setDeleting(true)
    mutateSlots(staffId, day, (slots) => slots.filter((s) => s.id !== slot.id))
    closeEditor()
    const res = await v2Delete(`/api/v2/planner?id=${encodeURIComponent(slot.id)}`, '계획을 지우지 못했어요. 다시 시도해 주세요.')
    deletingRef.current = false
    setDeleting(false)
    query.noteStatus(res.status)
    if (!res.ok) {
      mutateSlots(staffId, day, (slots) => [...slots, slot])
      showError(res.error)
    }
  }

  // 담당자 필터: 고른 사람 줄만 보이고, 요약 숫자도 그 사람 기준이 된다.
  const staffFilter = payload.staff.some((s) => s.name === filters.staff) ? filters.staff : ''
  const visibleStaff = useMemo(() => (staffFilter ? payload.staff.filter((s) => s.name === staffFilter) : payload.staff), [payload.staff, staffFilter])

  // 이번 주 요약: 지나간 날(오늘 포함) 계획 중 얼마나 지켰는지
  const summary = useMemo(
    () =>
      summarizePlan(
        visibleStaff.map((s) => s.id),
        payload.days,
        payload.planned,
        payload.actual,
        today
      ),
    [payload, visibleStaff, today]
  )
  const fillRate = safeRatio(summary.met, summary.plannedDue)
  const behind = useMemo(
    () =>
      behindByStaff(
        visibleStaff.map((s) => s.id),
        payload.days,
        payload.planned,
        payload.actual,
        today
      ),
    [payload, visibleStaff, today]
  )
  const timing = useMemo(() => describeTiming(hint), [hint])

  const rangeLabel = `${formatYmdLabel(payload.days[0] || weekStart)} ~ ${formatYmdLabel(payload.days[6] || addDays(weekStart, 6))}`
  const chips: FilterChip[] = []
  if (weekStart !== thisWeek) chips.push({ key: 'week', label: `주: ${rangeLabel}`, onClear: () => setFilters({ week: '' }) })
  if (filters.staff) chips.push({ key: 'staff', label: `담당자: ${filters.staff}`, onClear: () => setFilters({ staff: '' }) })
  const nameOf = (id: string) => payload.staff.find((s) => s.id === id)?.name || ''
  const nextSteps: NextLink[] = behind.slice(0, 3).map((b) => ({
    key: b.staffId,
    tone: 'bad' as const,
    text: `${nameOf(b.staffId)}님이 지난 날 계획보다 ${b.missing}건 적게 올렸어요 (${b.cells}개 칸).`,
    href: withQuery('/v2/report', { staff: nameOf(b.staffId), period: '30' }),
    label: '이 담당자 성과 보기'
  }))
  const csvTable = () => {
    const rows: CsvValue[][] = []
    for (const s of visibleStaff) {
      for (const day of payload.days) {
        const slots = slotsOf(s.id, day)
        const actualCount = payload.actual[s.id]?.[day] ?? 0
        const state = cellState(day, today, slots.length, actualCount)
        rows.push([s.name, day, WEEKDAY_LABELS[weekdayOf(day)], slots.map((x) => `${String(x.planned_hour).padStart(2, '0')}:00`).join(' / '), slots.length, actualCount, STATE_WORD[state] || ''])
      }
    }
    return { name: `업로드 계획 ${payload.days[0] || weekStart}`, headers: ['담당자', '날짜', '요일', '계획한 시간', '계획 건수', '실제 등록 건수', '상태'], rows }
  }
  const weekName = weekStart === thisWeek ? '이번 주' : '선택한 주'

  return (
    <>
      <PageHeader title="업로드 계획" subtitle="담당자별로 어느 요일에 영상을 올릴지 계획하고, 실제로 올렸는지 확인하는 곳이에요." />
      <Toast toast={toast} />
      {(loaded && loadError) || query.expired ? <LoadError message={loadError} expired={query.expired} onRetry={query.reload} /> : null}
      <RefreshNote show={query.refreshing} />

      {!loaded ? (
        <>
          <SkeletonSummary />
          <div className="panel">
            <SkeletonPlanner rows={3} />
          </div>
        </>
      ) : loadError && payload.days.length === 0 ? null : (
        <>
          <Answer tone={summary.behind > 0 ? 'bad' : summary.plannedAll > 0 ? 'good' : 'neutral'}>
            {summary.plannedAll === 0 ? (
              <>{weekName}에 잡아 둔 업로드 계획이 없어요. 아래 표에서 담당자·요일 칸의 ‘+ 계획’을 눌러 추가해 보세요.</>
            ) : summary.plannedDue === 0 ? (
              <>{weekName} 계획은 <b>{summary.plannedAll}건</b>이에요. 아직 시작 전이라 확인할 결과는 없어요.</>
            ) : summary.behind > 0 ? (
              <>
                <span aria-hidden="true">▼ </span>지나간 날 중 계획보다 적게 올린 칸이 <b>{summary.behind}개</b> 있어요. 계획 {summary.plannedDue}건 중 {summary.met}건을 채웠어요.
              </>
            ) : (
              <>
                <span aria-hidden="true">✓ </span>지금까지 계획 {summary.plannedDue}건 중 <b>{summary.met}건</b>을 채웠어요. 밀린 곳은 없어요.
              </>
            )}
          </Answer>

          <section className="v2a-best" aria-label="추천 업로드 시간">
            <div className="v2a-best-label">
              <Term k="best" />
            </div>
            {timing ? (
              <>
                <div className="v2a-best-slot">{timing.headline}</div>
                <p className="v2a-best-evidence">근거: {timing.evidence}.</p>
                {timing.compare ? <p className="v2a-best-compare">▲ {timing.compare}</p> : null}
                {hint.runnerUps && hint.runnerUps.length > 0 ? (
                  <ul className="v2a-best-others" aria-label="그다음으로 좋았던 시간">
                    {hint.runnerUps.map((slot) => (
                      <li key={`${slot.weekday}-${slot.hour}`}>
                        다음으로 좋은 시간: {slotLabel(slot.weekday, slot.hour)} (평균 조회 {formatCountOrDash(slot.avgViews)}회, 영상 {slot.sampleSize}개)
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div>
                  <Link className="v2a-inline-link" href={withQuery('/v2/report', { period: '30' })}>
                    지난 30일 성과 순위 보기 →
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="v2a-best-evidence">
                  아직 ‘몇 시에 올리면 좋은지’ 알려 드리기 어려워요. 지난 {hint.windowDays ?? 30}일 동안 조회수를 확인한 영상이 {(hint.totalVideos ?? 0).toLocaleString('ko-KR')}개인데, 같은 요일·시간에 올린 영상이 더 쌓여야 비교할 수 있어요.
                </p>
                <div>
                  <Link className="v2a-inline-link" href="/v2/register">
                    영상 등록하러 가기 →
                  </Link>
                </div>
              </>
            )}
          </section>

          <NextSteps items={nextSteps} title="지금 챙길 담당자" />

          <KpiRow>
            <Kpi label={`${weekName} 계획`} value={summary.plannedAll.toLocaleString('ko-KR')} unit="건" hint="이 주에 올리기로 정해 둔 영상 수예요." />
            <Kpi
              label={<Term k="plan">지금까지 채운 계획</Term>}
              value={summary.plannedDue === 0 ? '-' : `${summary.met.toLocaleString('ko-KR')}/${summary.plannedDue.toLocaleString('ko-KR')}`}
              unit={summary.plannedDue === 0 ? undefined : '건'}
              tone={summary.plannedDue === 0 ? 'neutral' : summary.met >= summary.plannedDue ? 'good' : 'warn'}
              hint={`오늘까지 계획한 것 중 실제로 등록된 영상 수예요.${fillRate === null ? '' : ` (${Math.round(fillRate * 100)}%)`}`}
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
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {payload.staff.length > 1 ? (
                  <>
                    <label className="small muted" htmlFor="plan-staff">
                      담당자
                    </label>
                    <select id="plan-staff" className="select compact" value={staffFilter} onChange={(e) => setFilters({ staff: e.target.value })}>
                      <option value="">전체</option>
                      {payload.staff.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                <button className="button secondary xs" onClick={() => setWeekStart((w) => addDays(w, -7))}>
                  ← 지난주
                </button>
                <button className="button secondary xs" disabled={weekStart === thisWeek} onClick={() => setFilters({ week: "" })}>
                  이번 주
                </button>
                <button className="button secondary xs" onClick={() => setWeekStart((w) => addDays(w, 7))}>
                  다음 주 →
                </button>
              </div>
            </div>

            <ActiveFilters chips={chips} onReset={reset} />
            <ShareBar getCsv={csvTable} csvDisabledReason={visibleStaff.length === 0 ? '저장할 표가 없어요' : undefined} getLink={shareHref} />

            {payload.staff.length === 0 ? (
              <EmptyGuide title="계획을 세울 직원이 없어요" href="/admin/users" action="직원 관리 화면 열기">
                이 표는 근무 중인 직원마다 한 줄씩 만들어져요. 직원 계정이 없거나 모두 퇴사 처리돼 있으면 비어 있어요. 직원을 추가하거나 상태를 확인해 주세요.
              </EmptyGuide>
            ) : visibleStaff.length === 0 ? (
              <EmptyGuide title="이 담당자는 표에 없어요" action="필터 초기화" onAction={reset}>
                링크의 담당자 이름이 지금 직원 목록에 없어요. 필터를 초기화하면 전체 직원이 보여요.
              </EmptyGuide>
            ) : (
              <div className={`v2a-plan-scroll ${switching ? 'v2a-fading' : ''}`} aria-busy={switching}>
                <div className="v2a-plan-grid" role="table" aria-label={`${rangeLabel} 담당자별 업로드 계획`}>
                  <div className="v2a-plan-row head" role="row">
                    <div role="columnheader">
                      <span className="v2a-vh">담당자</span>
                    </div>
                    {payload.days.map((day) => (
                      <div className={`v2a-plan-head ${day === today ? 'today' : ''}`} key={day} role="columnheader">
                        {WEEKDAY_LABELS[weekdayOf(day)]}
                        <small>
                          {Number(day.slice(5, 7))}/{Number(day.slice(8, 10))}
                          {day === today ? ' 오늘' : ''}
                        </small>
                      </div>
                    ))}
                  </div>
                  {visibleStaff.map((s) => (
                    <div className="v2a-plan-row" role="row" key={s.id}>
                      <div className="v2a-plan-name" role="rowheader">
                        {s.name}
                      </div>
                      {payload.days.map((day) => {
                        const slots = slotsOf(s.id, day)
                        const actualCount = payload.actual[s.id]?.[day] ?? 0
                        const plannedCount = slots.length
                        const state = cellState(day, today, plannedCount, actualCount)
                        const isOpen = editor?.staffId === s.id && editor.day === day
                        const label = `${WEEKDAY_LABELS[weekdayOf(day)]} ${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}${day === today ? ' 오늘' : ''}`
                        const count = countLabel(state, day, today, plannedCount, actualCount)
                        return (
                          <div className={`v2a-plan-cell ${state} ${day === today ? 'today' : ''} ${isOpen ? 'selected' : ''}`} key={`${s.id}-${day}`} role="cell" data-label={label}>
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
                            <button type="button" className="v2a-plan-add" aria-label={`${s.name} ${formatYmdLabel(day)} 계획 추가`} onClick={() => openAdd(s.id, day)}>
                              + 계획
                            </button>
                            <div className="v2a-plan-count" title={STATE_WORD[state] || undefined}>
                              {count}
                              {STATE_WORD[state] ? <span className="v2a-vh"> ({STATE_WORD[state]})</span> : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
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

            <ul className="v2a-legend" aria-label="칸 색과 기호 설명">
              <li style={{ color: '#4ade80' }}>
                <i />
                {STATE_SYMBOL.good} {STATE_WORD.good}
              </li>
              <li style={{ color: '#fbbf24' }}>
                <i />
                {STATE_SYMBOL.pending} {STATE_WORD.pending}
              </li>
              <li style={{ color: '#f87171' }}>
                <i />
                {STATE_SYMBOL.bad} {STATE_WORD.bad}
              </li>
              <li>
                <i style={{ borderStyle: 'dashed' }} />
                {STATE_WORD.future}
              </li>
            </ul>

            <GlossaryDetails keys={['plan', 'best']} />
            <HowTo>
              <p>칸의 ‘계획’은 그 담당자·요일에 정해 둔 시간 수, ‘등록’은 그날 실제로 등록된 영상 수예요. 등록이 계획 이상이면 초록색(✓)이에요.</p>
              <p>추천 시간은 지난 30일에 올린 영상을 요일·시간대별로 묶어, 올린 뒤 하루당 평균 조회수가 가장 높은 곳을 찾은 결과예요. 오래된 영상은 조회수가 더 쌓여 있으니 하루당으로 나눠 공평하게 견줘요. 같은 요일·시간에 올린 영상이 2개(영상이 150개 이상이면 3개) 미만인 시간대는 우연일 수 있어 제외해요.</p>
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
      {/* 필터를 주소에서 읽기 때문에 Suspense 로 감싸야 한다 (Next.js 요구사항). */}
      <Suspense fallback={<SkeletonSummary />}>
        <PlannerBody />
      </Suspense>
    </AdminOnly>
  )
}
