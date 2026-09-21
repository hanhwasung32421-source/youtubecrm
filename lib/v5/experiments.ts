// 성장 실험 캔버스 — GET/POST/PATCH 라우트가 공유하는 select 컬럼 + 검증 + 매핑 로직.

import { z } from 'zod'
import { EXPERIMENT_DIMENSIONS, EXPERIMENT_STATUSES } from '@/lib/v5/types'
import type { GrowthExperiment } from '@/lib/v5/types'
import { loadUserMap, loadVideosByIds, optionalText, optionalYmd, uuidSchema, ymdSchema, type Session } from '@/lib/v5/api'

export const EXPERIMENT_SELECT =
  'id, dimensions, video_ids, hypothesis, metric_definition, started_on, ended_on, status, effect_size, next_action, created_by, created_at, updated_at'

export const DEFAULT_METRIC_DEFINITION = '조회수 변화'

export type ExperimentRow = Omit<GrowthExperiment, 'author_name' | 'videos' | 'missing_videos' | 'can_edit'>

const MAX_TARGET_VIDEOS = 30

const uniqueList = <T,>(list: T[]) => Array.from(new Set(list))

// 효과 크기(%): 빈 값은 null, 숫자로 바꿀 수 없으면 오류, 소수 둘째 자리까지만 저장한다.
const effectSizeSchema = z.preprocess(
  (v) => {
    if (v === '' || v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string') return Number(v.replace(/[%\s,]/g, ''))
    return v
  },
  z
    .number('효과 크기는 숫자로 적어 주세요. 예: 32 또는 -8')
    .min(-1000, '효과 크기는 -1000~1000 사이로 적어 주세요.')
    .max(1000, '효과 크기는 -1000~1000 사이로 적어 주세요.')
    .transform((n) => Math.round(n * 100) / 100)
    .nullable()
    .optional()
)

const dimensionsSchema = z
  .array(z.enum(EXPERIMENT_DIMENSIONS))
  .min(1, '바꿔 볼 것을 1개 이상 골라 주세요.')
  .transform(uniqueList)

const videoIdsSchema = z
  .array(uuidSchema)
  .min(1, '실험할 영상을 1개 이상 골라 주세요.')
  .transform(uniqueList)
  .refine((list) => list.length <= MAX_TARGET_VIDEOS, `영상은 최대 ${MAX_TARGET_VIDEOS}개까지 고를 수 있어요.`)

export const experimentInputSchema = z.object({
  dimensions: dimensionsSchema,
  videoIds: videoIdsSchema,
  hypothesis: z.string().trim().min(1, '가설을 입력해 주세요.').max(500, '가설은 500자 안으로 적어 주세요.'),
  // 선택 항목: 비워 두면 기본 문구로 저장한다.
  metricDefinition: z
    .string()
    .trim()
    .max(200, '판단 기준은 200자 안으로 적어 주세요.')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : DEFAULT_METRIC_DEFINITION)),
  startedOn: ymdSchema,
  endedOn: optionalYmd,
  status: z.enum(EXPERIMENT_STATUSES).optional().default('running'),
  effectSize: effectSizeSchema,
  nextAction: optionalText
})

export const experimentPatchSchema = z.object({
  dimensions: dimensionsSchema.optional(),
  videoIds: videoIdsSchema.optional(),
  hypothesis: z.string().trim().min(1, '가설을 입력해 주세요.').max(500, '가설은 500자 안으로 적어 주세요.').optional(),
  metricDefinition: z
    .string()
    .trim()
    .max(200, '판단 기준은 200자 안으로 적어 주세요.')
    .optional()
    .transform((v) => (v === undefined ? undefined : v.length > 0 ? v : DEFAULT_METRIC_DEFINITION)),
  startedOn: ymdSchema.optional(),
  endedOn: optionalYmd,
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  effectSize: effectSizeSchema,
  nextAction: optionalText
})

export async function mapExperiments(
  supabaseAdmin: Session['supabaseAdmin'],
  rows: ExperimentRow[],
  viewer?: Pick<Session, 'isAdmin' | 'profile'>
): Promise<GrowthExperiment[]> {
  if (rows.length === 0) return []
  const userMap = await loadUserMap(supabaseAdmin, rows.map((r) => r.created_by))
  const videoIds = Array.from(new Set(rows.flatMap((r) => r.video_ids || [])))
  const videoMap = new Map<string, { id: string; title: string | null; stock_name: string }>()
  let lookupFailed = false
  if (videoIds.length > 0) {
    try {
      const found = await loadVideosByIds<{ id: string; title: string | null; stock_name: string }>(supabaseAdmin, videoIds, 'id, title, stock_name')
      for (const row of found) videoMap.set(row.id, row)
    } catch (e) {
      // 영상 이름을 못 붙여도 실험 카드 자체는 그려야 한다.
      lookupFailed = true
      console.error('V5 실험 대상 영상 조회 실패', e)
    }
  }
  return rows.map((r) => {
    const ids = r.video_ids || []
    const videos = ids.map((id) => videoMap.get(id)).filter((v): v is { id: string; title: string | null; stock_name: string } => Boolean(v))
    return {
      ...r,
      effect_size: r.effect_size === null || r.effect_size === undefined ? null : Number(r.effect_size), // numeric 은 문자열로 올 수 있다
      author_name: r.created_by ? userMap.get(r.created_by) || null : null,
      videos,
      missing_videos: lookupFailed ? 0 : ids.length - videos.length,
      can_edit: viewer ? viewer.isAdmin || r.created_by === viewer.profile.id : undefined
    }
  })
}
