import { NextResponse } from 'next/server'
import { mapPlaybook, PLAYBOOK_SELECT, type PlaybookRow } from '@/lib/v5/playbook'
import { V5_TABLES } from '@/lib/v5/tables'
import { getSession, handleRouteError, isMissingTableError, jsonNoStore, missingTableResponse, notFound, uuidSchema } from '@/lib/v5/api'

const MAX_ATTEMPTS = 5

// "이 공식 써봤어요" — 사용 횟수를 1 늘린다.
// supabase-js 에는 `usage_count = usage_count + 1` 이 없으므로, 읽은 값을 조건으로 건
// 비교-교체(compare-and-swap)로 갱신한다: `where id = ? and usage_count = 읽은값`.
// 그 사이 다른 사람이 먼저 올렸다면 0행이 갱신되므로 다시 읽고 재시도한다 → 동시에 눌러도 횟수가 사라지지 않는다.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return changeUsage(request, params, 1)
}

// "방금 누른 써봤어요 취소" — 사용 횟수를 1 줄인다(0 아래로는 내려가지 않는다). 같은 비교-교체 방식이라 동시에 눌러도 안전하다.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return changeUsage(request, params, -1)
}

async function changeUsage(request: Request, paramsPromise: Promise<{ id: string }>, delta: 1 | -1) {
  try {
    const { id } = await paramsPromise
    if (!uuidSchema.safeParse(id).success) return notFound('성공 공식을 찾을 수 없어요.')
    const session = await getSession(request)
    const { supabaseAdmin } = session

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const { data: existing, error: findError } = await supabaseAdmin.from(V5_TABLES.playbookEntries).select(PLAYBOOK_SELECT).eq('id', id).maybeSingle()
      if (findError) {
        if (isMissingTableError(findError)) return missingTableResponse()
        throw findError
      }
      if (!existing) return notFound('성공 공식을 찾을 수 없어요. 이미 지워졌을 수 있어요.')

      const current = Number(existing.usage_count) || 0
      const nextCount = Math.max(current + delta, 0)
      if (nextCount === current) {
        // 이미 0 이라 더 줄일 수 없다: 그대로 현재 값을 돌려준다.
        const [item] = await mapPlaybook(supabaseAdmin, [existing as unknown as PlaybookRow], session)
        return jsonNoStore({ item })
      }
      const { data: updated, error } = await supabaseAdmin
        .from(V5_TABLES.playbookEntries)
        .update({ usage_count: nextCount })
        .eq('id', id)
        .eq('usage_count', current)
        .select(PLAYBOOK_SELECT)
      if (error) throw error

      if (updated && updated.length > 0) {
        const [item] = await mapPlaybook(supabaseAdmin, [updated[0] as PlaybookRow], session)
        return jsonNoStore({ item })
      }
      // 누군가 먼저 올렸다: 아주 짧게 쉬고 다시 읽는다.
      await new Promise((resolve) => setTimeout(resolve, 40 + Math.floor(Math.random() * 60)))
    }

    return NextResponse.json({ error: '동시에 많이 눌러서 기록하지 못했어요. 잠시 뒤 다시 눌러 주세요.' }, { status: 409 })
  } catch (e) {
    return handleRouteError(e, '사용 기록을 남기지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
