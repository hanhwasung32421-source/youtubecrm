import { NextResponse } from 'next/server'
import { z } from 'zod'
import { TABLES } from '@/lib/supabase/tables'
import { V2_TABLES } from '@/lib/v2/tables'
import { addDays, isRealYmd, kstDayStart, kstDayEnd, kstYmd, weekStartMonday } from '@/lib/v2/dates'
import { cachedJson, handleDbError, handleRouteError, isUuid, loadStaff, noStoreJson, requireV2Admin, selectAllPages } from '@/lib/v2/server'
import { TIMING_WINDOW_DAYS, computeTimingEvidence } from '@/lib/v2/timing'
import type { PlannedSlot, PlannerPayload, TimingHint } from '@/lib/v2/types'

const READ_ERROR = '업로드 계획을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const SAVE_ERROR = '계획을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const DELETE_ERROR = '계획을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const DUP_ERROR = '이 담당자는 그 시간에 이미 계획이 있어요. 다른 시간을 골라 주세요.'
const SLOT_SELECT = 'id, staff_user_id, planned_date, planned_hour, note, created_at'

// 주를 넘기며 볼 때마다 같은 "지난 30일 발행 시간 통계"를 다시 계산하지 않도록 잠깐(60초) 기억해 둔다.
// (같은 서버 인스턴스 안에서만 적용되는 가벼운 캐시라, 없어져도 결과는 같다)
const TIMING_TTL_MS = 60_000
let timingCache: { at: number; value: TimingHint } | null = null
type TimingRow = { published_at: string | null; view_count: number | null }

// 발행 모멘텀 플래너: 요일 × 담당자 업로드 계획(planned_slots) vs 실제 등록 수, 최적 발행 시간 힌트
export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireV2Admin(request)
    const url = new URL(request.url)
    const requested = url.searchParams.get('weekStart') || ''
    const weekStart = weekStartMonday(isRealYmd(requested) ? requested : kstYmd())
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const weekEnd = days[days.length - 1]

    const staff = await loadStaff(supabaseAdmin)
    const staffIds = staff.map((s) => s.id)

    // 계획·실제 등록·발행 시간 통계는 서로 기다릴 필요가 없어 한꺼번에 조회한다.
    const emptyIds = ['00000000-0000-4000-8000-000000000000']
    const videoTask =
      staffIds.length > 0
        ? // 한 주에 등록되는 영상이 1000개를 넘을 수 있어 나눠서 모두 읽는다.
          selectAllPages<{ primary_owner_user_id: string; created_at: string }>(
            (from, to) =>
              supabaseAdmin
                .from(TABLES.videos)
                .select('primary_owner_user_id, created_at')
                .in('primary_owner_user_id', staffIds)
                .gte('created_at', kstDayStart(weekStart).toISOString())
                .lt('created_at', kstDayEnd(weekEnd).toISOString())
                .order('created_at', { ascending: true })
                .range(from, to),
            6000
          )
        : Promise.resolve([] as { primary_owner_user_id: string; created_at: string }[])

    // 추천 시간의 근거: 지난 30일에 발행된 영상(발행 시각·조회수). 잠깐 전에 계산한 값이 있으면 다시 읽지 않는다(null).
    // 읽다가 실패하면 undefined — 추천만 비우고 나머지 화면은 그대로 보여준다.
    const timingSince = new Date(Date.now() - TIMING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const timingTask: Promise<TimingRow[] | null | undefined> =
      timingCache && Date.now() - timingCache.at < TIMING_TTL_MS
        ? Promise.resolve(null)
        : selectAllPages<TimingRow>(
            (from, to) =>
              supabaseAdmin
                .from(TABLES.videos)
                .select('published_at, view_count')
                .gte('published_at', timingSince)
                .lte('published_at', new Date().toISOString())
                .order('published_at', { ascending: false })
                .range(from, to),
            3000
          ).catch((e) => {
            console.error('[v2] planner timing', e)
            return undefined
          })

    const [slotRes, videoRows, timingRows] = await Promise.all([
      supabaseAdmin
        .from(V2_TABLES.plannedSlots)
        .select(SLOT_SELECT)
        .in('staff_user_id', staffIds.length > 0 ? staffIds : emptyIds)
        .gte('planned_date', weekStart)
        .lte('planned_date', weekEnd)
        .order('planned_hour', { ascending: true }),
      videoTask,
      timingTask
    ])

    const { data: slotRows, error: slotError } = slotRes
    if (slotError) return handleDbError(slotError, READ_ERROR)

    const planned: PlannerPayload['planned'] = {}
    const actual: PlannerPayload['actual'] = {}
    for (const s of staff) {
      planned[s.id] = {}
      actual[s.id] = {}
      for (const day of days) {
        planned[s.id][day] = []
        actual[s.id][day] = 0
      }
    }
    for (const row of (slotRows || []) as PlannedSlot[]) {
      if (planned[row.staff_user_id] && planned[row.staff_user_id][row.planned_date]) {
        planned[row.staff_user_id][row.planned_date].push(row)
      }
    }
    for (const row of videoRows) {
      const day = kstYmd(new Date(row.created_at))
      if (actual[row.primary_owner_user_id] && day in actual[row.primary_owner_user_id]) {
        actual[row.primary_owner_user_id][day] += 1
      }
    }

    let timingHint: TimingHint
    if (timingRows) {
      timingHint = computeTimingEvidence(timingRows)
      timingCache = { at: Date.now(), value: timingHint }
    } else if (timingRows === null && timingCache) {
      timingHint = timingCache.value
    } else {
      timingHint = computeTimingEvidence([])
    }

    const payload: PlannerPayload = { weekStart, days, staff, planned, actual, timingHint }
    return cachedJson(payload)
  } catch (e) {
    return handleRouteError(e, READ_ERROR)
  }
}

const createSchema = z.object({
  staffUserId: z.string().uuid('담당자를 골라 주세요.'),
  plannedDate: z.string().refine(isRealYmd, '날짜가 올바르지 않아요.'),
  plannedHour: z.number('시간을 골라 주세요.').int('시간을 골라 주세요.').min(0, '시간은 0~23시 중에서 골라 주세요.').max(23, '시간은 0~23시 중에서 골라 주세요.'),
  note: z.string().trim().max(200, '메모는 200자까지 적을 수 있어요.').optional().nullable()
})

const patchSchema = z.object({
  id: z.string().uuid('계획 정보가 올바르지 않아요. 화면을 새로고침해 주세요.'),
  plannedHour: z.number('시간을 골라 주세요.').int('시간을 골라 주세요.').min(0, '시간은 0~23시 중에서 골라 주세요.').max(23, '시간은 0~23시 중에서 골라 주세요.').optional(),
  note: z.string().trim().max(200, '메모는 200자까지 적을 수 있어요.').optional().nullable()
})

export async function POST(request: Request) {
  try {
    const { supabaseAdmin } = await requireV2Admin(request)
    const body = createSchema.parse(await request.json())

    const { data, error } = await supabaseAdmin
      .from(V2_TABLES.plannedSlots)
      .insert({ staff_user_id: body.staffUserId, planned_date: body.plannedDate, planned_hour: body.plannedHour, note: body.note || null })
      .select(SLOT_SELECT)
      .single()
    if (error || !data) return handleDbError(error, SAVE_ERROR, DUP_ERROR)
    return noStoreJson({ ok: true, item: data })
  } catch (e) {
    return handleRouteError(e, SAVE_ERROR)
  }
}

// 시간·메모 수정 (담당자와 날짜를 바꾸려면 지우고 새로 추가한다)
export async function PATCH(request: Request) {
  try {
    const { supabaseAdmin } = await requireV2Admin(request)
    const body = patchSchema.parse(await request.json())

    const patch: Record<string, unknown> = {}
    if (body.plannedHour !== undefined) patch.planned_hour = body.plannedHour
    if (body.note !== undefined) patch.note = body.note || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: '바꿀 내용이 없어요.' }, { status: 400 })

    const { data, error } = await supabaseAdmin.from(V2_TABLES.plannedSlots).update(patch).eq('id', body.id).select(SLOT_SELECT).maybeSingle()
    if (error) return handleDbError(error, SAVE_ERROR, DUP_ERROR)
    if (!data) return NextResponse.json({ error: '이미 지워진 계획이에요. 목록을 새로 불러올게요.' }, { status: 404 })
    return noStoreJson({ ok: true, item: data })
  } catch (e) {
    return handleRouteError(e, SAVE_ERROR)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabaseAdmin } = await requireV2Admin(request)
    const id = new URL(request.url).searchParams.get('id') || ''
    if (!isUuid(id)) {
      return NextResponse.json({ error: '지울 계획을 찾지 못했어요. 화면을 새로고침해 주세요.' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from(V2_TABLES.plannedSlots).delete().eq('id', id)
    if (error) return handleDbError(error, DELETE_ERROR)
    return noStoreJson({ ok: true })
  } catch (e) {
    return handleRouteError(e, DELETE_ERROR)
  }
}
