import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getKstYmd } from '@/lib/attendance/time'
import { firstIssueMessage } from '@/lib/v4/errors'
import { getSampleGoal } from '@/lib/v4/sample-data'
import { noStoreJson } from '@/lib/v4/http'
import { dbError, loadUsers, readJson, requireV4Admin, requireV4User, v4ErrorResponse, type V4Context } from '@/lib/v4/server'
import { MISSING_TABLE_MESSAGE, V4_TABLES, isMissingTableError } from '@/lib/v4/tables'

// 월은 1~12만 허용 (DB CHECK 는 자릿수만 검사한다)
const monthSchema = z
  .string({ error: '월을 선택해 주세요.' })
  .regex(/^\d{4}-\d{2}$/, '월은 YYYY-MM 형식이어야 합니다.')
  .refine((v) => {
    const m = Number(v.slice(5, 7))
    return m >= 1 && m <= 12
  }, '월은 01~12 사이여야 합니다.')

const goalInputSchema = z.object({
  month: monthSchema,
  userId: z.uuid({ error: '직원을 다시 선택해 주세요.' }).nullable().optional(),
  targetVideos: z.coerce.number({ error: '목표 영상 수는 숫자로 입력해 주세요.' }).int('목표 영상 수는 정수로 입력해 주세요.').min(0, '목표 영상 수는 0 이상이어야 합니다.').max(1000000, '목표 영상 수가 너무 큽니다.'),
  targetViews: z.coerce.number({ error: '목표 조회수는 숫자로 입력해 주세요.' }).int('목표 조회수는 정수로 입력해 주세요.').min(0, '목표 조회수는 0 이상이어야 합니다.').max(1e12, '목표 조회수가 너무 큽니다.')
})

const GOAL_SELECT = 'id, month, user_id, target_videos, target_views'

function mapGoal(row: any) {
  return {
    id: row.id as string,
    month: row.month as string,
    userId: (row.user_id as string | null) ?? null,
    targetVideos: Number(row.target_videos || 0),
    targetViews: Number(row.target_views || 0)
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireV4User(request)
    const url = new URL(request.url)
    const monthParam = url.searchParams.get('month')
    const month = monthSchema.safeParse(monthParam).success ? (monthParam as string) : getKstYmd().slice(0, 7)

    let q = ctx.supabaseAdmin.from(V4_TABLES.growthGoals).select(GOAL_SELECT).eq('month', month).order('created_at', { ascending: true })
    if (!ctx.isAdmin) q = q.or(`user_id.is.null,user_id.eq.${ctx.profile.id}`)

    const { data, error } = await q
    if (error) {
      if (isMissingTableError(error)) {
        const { staff } = await loadUsers(ctx.supabaseAdmin)
        return NextResponse.json({ sample: true, month, items: [getSampleGoal(month, staff.length)] })
      }
      throw dbError(error)
    }
    return NextResponse.json({ sample: false, month, items: (data || []).map(mapGoal) })
  } catch (e) {
    return v4ErrorResponse(e, '성장 목표 조회 실패')
  }
}

// (month, user_id) 조합에 해당하는 목표 1건을 찾는다.
// user_id 가 NULL(팀 목표)이면 `= NULL` 이 아니라 `IS NULL` 로 찾아야 한다.
// (DB 는 coalesce 유니크 인덱스로 팀 목표 중복을 막지만, 코드에서도 같은 기준으로 찾아야 update 로 이어진다.)
async function findGoal(ctx: V4Context, month: string, userId: string | null) {
  let q = ctx.supabaseAdmin.from(V4_TABLES.growthGoals).select('id').eq('month', month).order('created_at', { ascending: true }).limit(1)
  q = userId ? q.eq('user_id', userId) : q.is('user_id', null)
  const { data, error } = await q
  if (error) throw error
  return (data?.[0] as { id: string } | undefined) || null
}

// 관리자만 목표를 저장한다. (month, user_id) 조합당 1건 — 있으면 update, 없으면 insert.
// 동시에 두 명이 저장해 insert 가 겹치면(유니크 위반) 한 번 더 찾아서 update 로 마무리한다.
export async function POST(request: Request) {
  try {
    const ctx = await requireV4Admin(request)
    const parsed = goalInputSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return noStoreJson({ error: firstIssueMessage(parsed.error) }, { status: 400 })
    }
    const input = parsed.data
    const userId = input.userId || null

    const values = {
      target_videos: input.targetVideos,
      target_views: input.targetViews,
      updated_at: new Date().toISOString()
    }
    const updateExisting = async (id: string) =>
      ctx.supabaseAdmin.from(V4_TABLES.growthGoals).update(values).eq('id', id).select(GOAL_SELECT).maybeSingle()

    let existing: { id: string } | null
    try {
      existing = await findGoal(ctx, input.month, userId)
    } catch (e) {
      if (isMissingTableError(e)) return noStoreJson({ error: MISSING_TABLE_MESSAGE }, { status: 409 })
      throw dbError(e)
    }

    let result = existing
      ? await updateExisting(existing.id)
      : await ctx.supabaseAdmin
          .from(V4_TABLES.growthGoals)
          .insert({ month: input.month, user_id: userId, ...values })
          .select(GOAL_SELECT)
          .single()

    if (!existing && result.error?.code === '23505') {
      // 그 사이 다른 사람이 같은 목표를 먼저 만들었다 → 그 행을 갱신한다.
      const raced = await findGoal(ctx, input.month, userId).catch(() => null)
      if (raced) result = await updateExisting(raced.id)
    }
    if (result.error) throw dbError(result.error)
    if (!result.data) return noStoreJson({ error: '목표를 찾을 수 없어요. 화면을 새로 열어 다시 시도해 주세요.' }, { status: 404 })

    return noStoreJson({ item: mapGoal(result.data) })
  } catch (e) {
    return v4ErrorResponse(e, '성장 목표 저장 실패')
  }
}

// 목표 지우기: DELETE /api/v4/goals?month=YYYY-MM[&userId=uuid]  (userId 없으면 팀 목표)
export async function DELETE(request: Request) {
  try {
    const ctx = await requireV4Admin(request)
    const url = new URL(request.url)
    const month = monthSchema.safeParse(url.searchParams.get('month'))
    if (!month.success) return noStoreJson({ error: firstIssueMessage(month.error, '월을 확인해 주세요.') }, { status: 400 })
    const userParam = url.searchParams.get('userId')
    if (userParam && !z.uuid().safeParse(userParam).success) {
      return noStoreJson({ error: '직원을 다시 선택해 주세요.' }, { status: 400 })
    }
    let q = ctx.supabaseAdmin.from(V4_TABLES.growthGoals).delete().eq('month', month.data)
    q = userParam ? q.eq('user_id', userParam) : q.is('user_id', null)
    const { error } = await q
    if (error) {
      if (isMissingTableError(error)) return noStoreJson({ error: MISSING_TABLE_MESSAGE }, { status: 409 })
      throw dbError(error)
    }
    return noStoreJson({ ok: true })
  } catch (e) {
    return v4ErrorResponse(e, '성장 목표 삭제 실패')
  }
}
