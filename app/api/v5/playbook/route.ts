import { NextResponse } from 'next/server'
import { mapPlaybook, PLAYBOOK_SELECT, playbookInputSchema, type PlaybookRow } from '@/lib/v5/playbook'
import { SAMPLE_PLAYBOOK } from '@/lib/v5/sample-data'
import { V5_TABLES } from '@/lib/v5/tables'
import { badRequest, countMissingVideos, fetchAllPages, getSession, handleRouteError, isMissingTableError, missingTableResponse, readJson } from '@/lib/v5/api'

// 팀 전체가 함께 만드는 라이브러리라 조회는 관리자/직원 구분 없이 전체 공개한다.
export async function GET(request: Request) {
  try {
    const session = await getSession(request)
    const { supabaseAdmin } = session

    let all: { rows: PlaybookRow[]; total: number; truncated: boolean }
    try {
      all = await fetchAllPages<PlaybookRow>(
        (from, to, withCount) =>
          supabaseAdmin
            .from(V5_TABLES.playbookEntries)
            .select(PLAYBOOK_SELECT, withCount ? { count: 'exact' } : undefined)
            .order('usage_count', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as any,
        { maxPages: 5 }
      )
    } catch (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ sample: true, items: SAMPLE_PLAYBOOK, top: SAMPLE_PLAYBOOK.slice(0, 3) })
      }
      throw error
    }

    const items = await mapPlaybook(supabaseAdmin, all.rows, session)
    return NextResponse.json({ sample: false, items, top: items.slice(0, 3), truncated: all.truncated })
  } catch (e) {
    return handleRouteError(e, '성공 공식을 불러오지 못했어요.')
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request)
    const { supabaseAdmin, profile } = session

    const input = playbookInputSchema.parse(await readJson(request))

    if (input.exampleVideoId && (await countMissingVideos(supabaseAdmin, [input.exampleVideoId])) > 0) {
      return badRequest('고른 영상을 찾을 수 없어요. 목록을 새로 열어 다시 골라 주세요.')
    }

    const { data, error } = await supabaseAdmin
      .from(V5_TABLES.playbookEntries)
      .insert({
        title: input.title,
        when_to_use: input.whenToUse,
        example_video_id: input.exampleVideoId || null,
        tags: input.tags,
        effect_note: input.effectNote || null,
        usage_count: 0,
        created_by: profile.id
      })
      .select(PLAYBOOK_SELECT)
      .single()

    if (error) {
      if (isMissingTableError(error)) return missingTableResponse()
      throw error
    }

    const [item] = await mapPlaybook(supabaseAdmin, [data as PlaybookRow], session)
    return NextResponse.json({ item })
  } catch (e) {
    return handleRouteError(e, '성공 공식을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
}
