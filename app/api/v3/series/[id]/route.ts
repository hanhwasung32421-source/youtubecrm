import { NextResponse } from 'next/server'
import { ApiFail, apiError, authenticate, cleanText, readJson, requireUuid } from '@/lib/v3/server'
import { assertCanEditSeries, assertNameFree, loadSeriesById } from '@/lib/v3/series-access'
import { V3_TABLES } from '@/lib/v3/tables'

// 시리즈 이름/종목 수정. 만든 사람 또는 관리자만.
//   body: { name?, stockName? }  (stockName 을 빈 문자열로 보내면 종목 지정 해제)
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const id = requireUuid((await context.params).id, '시리즈')
    const body = ((await readJson(request)) || {}) as { name?: unknown; stockName?: unknown }
    const series = await loadSeriesById(supabaseAdmin, id)
    assertCanEditSeries(series, profile, isAdmin)

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const name = cleanText(body.name, 200, '시리즈 이름')
      if (!name) throw new ApiFail(400, '시리즈 이름을 입력해 주세요.')
      if (name !== series.name) await assertNameFree(supabaseAdmin, name, id)
      patch.name = name
    }
    if (body.stockName !== undefined) patch.stock_name = cleanText(body.stockName, 100, '종목')
    if (Object.keys(patch).length === 0) throw new ApiFail(400, '바꿀 내용이 없어요.')

    const { data, error } = await supabaseAdmin.from(V3_TABLES.videoSeries).update(patch).eq('id', id).select('id, name, stock_name').maybeSingle()
    if (error) throw error
    if (!data) throw new ApiFail(404, '시리즈를 찾을 수 없어요. 이미 삭제되었을 수 있어요. 화면을 새로 고쳐 주세요.')

    return NextResponse.json({ ok: true, series: { id: data.id, name: data.name, stockName: data.stock_name } })
  } catch (e) {
    return apiError(e, '시리즈를 고치지 못했어요.', { duplicate: '같은 이름의 시리즈가 이미 있어요.' })
  }
}

// 시리즈 삭제. 묶여 있던 영상 자체는 그대로 남고 "시리즈에서만" 빠진다(members 는 FK cascade).
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return auth.response
  const { supabaseAdmin, profile, isAdmin } = auth

  try {
    const id = requireUuid((await context.params).id, '시리즈')
    const series = await loadSeriesById(supabaseAdmin, id)
    assertCanEditSeries(series, profile, isAdmin)

    const { error } = await supabaseAdmin.from(V3_TABLES.videoSeries).delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, '시리즈를 삭제하지 못했어요.')
  }
}
