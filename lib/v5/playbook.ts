// 발행 전략 플레이북 — GET/POST/PATCH 라우트가 공유하는 select 컬럼 + 검증 + 매핑 로직.

import { z } from 'zod'
import type { PlaybookEntry } from '@/lib/v5/types'
import { V5_TABLES } from '@/lib/v5/tables'
import { loadUserMap, loadVideosByIds, optionalText, uuidSchema, type Session } from '@/lib/v5/api'

export const PLAYBOOK_SELECT = 'id, title, when_to_use, example_video_id, tags, effect_note, usage_count, created_by, created_at'

export type PlaybookRow = Omit<PlaybookEntry, 'author_name' | 'example_video_title' | 'can_edit'>

// 태그: "#실적" → "실적", 중복/빈 값 제거, 30자까지만.
const tagsSchema = z
  .array(z.string())
  .max(30, '태그가 너무 많아요.')
  .transform((list) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of list) {
      const tag = raw.trim().replace(/^#+/, '').trim().slice(0, 30)
      if (!tag || seen.has(tag.toLowerCase())) continue
      seen.add(tag.toLowerCase())
      out.push(tag)
    }
    return out.slice(0, 15)
  })

const exampleVideoSchema = z.preprocess((v) => (v === '' ? null : v), uuidSchema.nullable().optional())

const titleSchema = z.string().trim().min(1, '공식 이름을 입력해 주세요.').max(100, '공식 이름은 100자 안으로 적어 주세요.')
const whenSchema = z.string().trim().min(1, '언제 쓰는지 입력해 주세요.').max(300, '언제 쓰는지는 300자 안으로 적어 주세요.')

export const playbookInputSchema = z.object({
  title: titleSchema,
  whenToUse: whenSchema,
  exampleVideoId: exampleVideoSchema,
  tags: tagsSchema.optional().default([]),
  effectNote: optionalText
})

export const playbookPatchSchema = z.object({
  title: titleSchema.optional(),
  whenToUse: whenSchema.optional(),
  exampleVideoId: exampleVideoSchema,
  tags: tagsSchema.optional(),
  effectNote: optionalText
})

export async function mapPlaybook(
  supabaseAdmin: Session['supabaseAdmin'],
  rows: PlaybookRow[],
  viewer?: Pick<Session, 'isAdmin' | 'profile'>
): Promise<PlaybookEntry[]> {
  if (rows.length === 0) return []
  const userMap = await loadUserMap(supabaseAdmin, rows.map((r) => r.created_by))
  const videoIds = Array.from(new Set(rows.map((r) => r.example_video_id).filter((v): v is string => Boolean(v))))
  const videoMap = new Map<string, string | null>()
  if (videoIds.length > 0) {
    try {
      const found = await loadVideosByIds<{ id: string; title: string | null; stock_name: string }>(supabaseAdmin, videoIds, 'id, title, stock_name')
      for (const row of found) videoMap.set(row.id, row.title || row.stock_name)
    } catch (e) {
      console.error('V5 플레이북 예시 영상 조회 실패', e)
    }
  }
  return rows.map((r) => ({
    ...r,
    tags: r.tags || [],
    author_name: r.created_by ? userMap.get(r.created_by) || null : null,
    example_video_title: r.example_video_id ? videoMap.get(r.example_video_id) || null : null,
    can_edit: viewer ? viewer.isAdmin || r.created_by === viewer.profile.id : undefined
  }))
}
