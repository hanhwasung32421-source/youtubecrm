// 실험(A/B 로그) 라우트가 공유하는 스키마/매퍼. route.ts는 HTTP 핸들러만 export할 수 있어 여기로 분리.

import { z } from 'zod'
import { DEFAULT_METRIC } from '@/lib/v4/experiment-consts'
import { stockKey, videoTitle, type VideoRow } from '@/lib/v4/analytics'
import type { ExperimentItem } from '@/lib/v4/sample-data'
import { V4HttpError, dbError, loadUsers, type V4Context } from '@/lib/v4/server'
import { V4_TABLES } from '@/lib/v4/tables'

// 실제로 있는 날짜인지까지 확인한다 (2026-02-31 같은 값은 DB 가 형식 오류로 거절한다).
const ymd = z
  .string({ error: '날짜를 선택해 주세요.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, '존재하지 않는 날짜예요. 날짜를 다시 확인해 주세요.')

export { DEFAULT_METRIC }

const text = (required: string, max: number) =>
  z.string({ error: required }).trim().min(1, required).max(max, `${max}자 이하로 적어 주세요.`)

export const experimentInputSchema = z.object({
  videoId: z.uuid({ error: '영상을 다시 선택해 주세요.' }).nullable().optional(),
  hypothesis: text('무엇을 확인하고 싶은지 적어 주세요.', 2000),
  variantA: text('지금 하던 방식(A)을 적어 주세요.', 2000),
  variantB: text('새로 해볼 방식(B)을 적어 주세요.', 2000),
  metric: text('비교 기준을 적어 주세요.', 500),
  startedOn: ymd,
  endedOn: ymd.nullable().optional(),
  winner: z.enum(['a', 'b', 'tie'], { error: '결과는 A, B, 무승부 중에서 골라 주세요.' }).nullable().optional(),
  learning: z.string().trim().max(4000, '배운 점은 4000자 이하로 적어 주세요.').nullable().optional()
})

// 등록(POST)에서는 비교 기준을 비워도 되고, 비우면 기본값('조회수')으로 저장한다.
export const experimentCreateSchema = experimentInputSchema.extend({
  metric: z.string().trim().max(500, '비교 기준은 500자 이하로 적어 주세요.').nullable().optional()
})

export type ExperimentInput = z.infer<typeof experimentInputSchema>

export const EXPERIMENT_SELECT =
  'id, video_id, hypothesis, variant_a, variant_b, metric, started_on, ended_on, winner, learning, created_by, created_at, updated_at'

export type ExperimentRow = {
  id: string
  video_id: string | null
  hypothesis: string
  variant_a: string
  variant_b: string
  metric: string
  started_on: string
  ended_on: string | null
  winner: 'a' | 'b' | 'tie' | null
  learning: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type VideoOption = { id: string; title: string; stockName: string; contentType: string; createdAt: string }

// 실험 폼의 영상 선택 옵션 (최근 300개, 직원은 본인 것만)
export async function loadVideoOptions(ctx: V4Context): Promise<VideoOption[]> {
  let q = ctx.supabaseAdmin
    .from(V4_TABLES.videos)
    .select('id, title, title_override, youtube_video_id, stock_name, content_type, created_at, primary_owner_user_id')
    .order('created_at', { ascending: false })
    .limit(300)
  if (!ctx.isAdmin) q = q.eq('primary_owner_user_id', ctx.profile.id)
  const { data, error } = await q
  if (error) throw dbError(error)
  return ((data || []) as unknown as Array<Partial<VideoRow> & { id: string; created_at: string }>).map((v) => ({
    id: v.id,
    title: videoTitle(v as VideoRow),
    stockName: stockKey(v as VideoRow),
    contentType: v.content_type || 'longform',
    createdAt: v.created_at
  }))
}

export async function mapExperiments(ctx: V4Context, rows: ExperimentRow[]): Promise<ExperimentItem[]> {
  const videoIds = Array.from(new Set(rows.map((r) => r.video_id).filter((id): id is string => Boolean(id))))
  const [{ map: userMap }, videoMap] = await Promise.all([
    loadUsers(ctx.supabaseAdmin),
    (async () => {
      if (videoIds.length === 0) return new Map<string, VideoRow>()
      const { data, error } = await ctx.supabaseAdmin
        .from(V4_TABLES.videos)
        .select('id, title, title_override, youtube_video_id, stock_name')
        .in('id', videoIds)
      if (error) throw dbError(error)
      return new Map(((data || []) as VideoRow[]).map((v) => [v.id, v]))
    })()
  ])
  return rows.map((r) => {
    const video = r.video_id ? videoMap.get(r.video_id) : undefined
    return {
      id: r.id,
      videoId: r.video_id,
      videoTitle: video ? videoTitle(video) : '(영상 미연결)',
      stockName: video ? stockKey(video) : '-',
      hypothesis: r.hypothesis,
      variantA: r.variant_a,
      variantB: r.variant_b,
      metric: r.metric,
      startedOn: r.started_on,
      endedOn: r.ended_on,
      winner: r.winner,
      learning: r.learning,
      createdBy: r.created_by,
      createdByName: (r.created_by && userMap.get(r.created_by)?.name) || '알 수 없음',
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  })
}

// 연결하려는 영상이 있는지, 직원이면 본인이 등록한 영상인지 확인한다. (FK 위반 원문 오류 대신 쉬운 문장으로)
export async function assertLinkableVideo(ctx: V4Context, videoId: string | null | undefined) {
  if (!videoId) return
  const { data, error } = await ctx.supabaseAdmin.from(V4_TABLES.videos).select('id, primary_owner_user_id').eq('id', videoId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw new V4HttpError('선택한 영상을 찾을 수 없어요. 목록에서 다시 골라 주세요.', 400)
  if (!ctx.isAdmin && (data as { primary_owner_user_id: string | null }).primary_owner_user_id !== ctx.profile.id) {
    throw new V4HttpError('본인이 등록한 영상만 연결할 수 있어요.', 403)
  }
}
