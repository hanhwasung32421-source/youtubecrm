// 성장 실험 캔버스 — GET/POST 라우트가 공유하는 select 컬럼 + 매핑 로직.

import { z } from 'zod'
import { EXPERIMENT_DIMENSIONS, EXPERIMENT_STATUSES } from '@/lib/v5/types'
import type { GrowthExperiment } from '@/lib/v5/types'
import { V5_TABLES } from '@/lib/v5/tables'
import { loadUserMap, optionalText, optionalYmd, ymdSchema, type Session } from '@/lib/v5/api'

export const EXPERIMENT_SELECT =
  'id, dimensions, video_ids, hypothesis, metric_definition, started_on, ended_on, status, effect_size, next_action, created_by, created_at, updated_at'

export const DEFAULT_METRIC_DEFINITION = '조회수 변화'

export type ExperimentRow =Omit<GrowthExperiment, 'author_name' | 'videos'>

export const experimentInputSchema = z.object({
  dimensions: z.array(z.enum(EXPERIMENT_DIMENSIONS)).min(1, '실험 유형을 1개 이상 선택해 주세요.'),
  videoIds: z.array(z.string().uuid()).min(1, '대상 영상을 1개 이상 선택해 주세요.'),
  hypothesis: z.string().trim().min(1, '가설을 입력해 주세요.').max(2000),
  // 선택 항목: 비워 두면 기본 문구로 저장한다(이전 화면은 항상 값을 보냈으므로 호환됨).
  metricDefinition: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : DEFAULT_METRIC_DEFINITION)),
  startedOn: ymdSchema,
  endedOn: optionalYmd,
  status: z.enum(EXPERIMENT_STATUSES).optional().default('running'),
  effectSize: z.coerce.number().min(-1000).max(1000).nullable().optional(),
  nextAction: optionalText
})

export const experimentPatchSchema = z.object({
  dimensions: z.array(z.enum(EXPERIMENT_DIMENSIONS)).min(1).optional(),
  videoIds: z.array(z.string().uuid()).min(1).optional(),
  hypothesis: z.string().trim().min(1).max(2000).optional(),
  metricDefinition: z.string().trim().min(1).max(500).optional(),
  startedOn: ymdSchema.optional(),
  endedOn: optionalYmd,
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  effectSize: z.coerce.number().min(-1000).max(1000).nullable().optional(),
  nextAction: optionalText
})

export async function mapExperiments(supabaseAdmin: Session['supabaseAdmin'], rows: ExperimentRow[]): Promise<GrowthExperiment[]> {
  if (rows.length === 0) return []
  const userMap = await loadUserMap(supabaseAdmin, rows.map((r) => r.created_by))
  const videoIds = Array.from(new Set(rows.flatMap((r) => r.video_ids || [])))
  let videoMap = new Map<string, { id: string; title: string | null; stock_name: string }>()
  if (videoIds.length > 0) {
    const { data } = await supabaseAdmin.from(V5_TABLES.videos).select('id, title, stock_name').in('id', videoIds)
    for (const row of (data || []) as Array<{ id: string; title: string | null; stock_name: string }>) {
      videoMap.set(row.id, row)
    }
  }
  return rows.map((r) => ({
    ...r,
    author_name: r.created_by ? userMap.get(r.created_by) || null : null,
    videos: (r.video_ids || []).map((id) => videoMap.get(id)).filter((v): v is { id: string; title: string | null; stock_name: string } => Boolean(v))
  }))
}
