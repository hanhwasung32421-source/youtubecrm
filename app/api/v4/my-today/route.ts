import { NextResponse } from 'next/server'
import { getKstDayEndIso, getKstDayStartIso, getKstYmd } from '@/lib/attendance/time'
import { requireV4User, v4ErrorResponse } from '@/lib/v4/server'
import { V4_TABLES } from '@/lib/v4/tables'

// 오늘(한국 시간 기준 0시~24시) 내가 등록한 영상 수. 관리자도 "내가 등록한 것"만 센다.
export async function GET(request: Request) {
  try {
    const ctx = await requireV4User(request)
    const dateKst = getKstYmd()
    const { count, error } = await ctx.supabaseAdmin
      .from(V4_TABLES.videos)
      .select('id', { count: 'exact', head: true })
      .eq('primary_owner_user_id', ctx.profile.id)
      .gte('created_at', getKstDayStartIso(dateKst))
      .lte('created_at', getKstDayEndIso(dateKst))
    if (error) throw new Error(error.message)
    return NextResponse.json({ count: count || 0, dateKst })
  } catch (e) {
    return v4ErrorResponse(e, '오늘 등록 수를 불러오지 못했어요.')
  }
}
