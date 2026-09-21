// 시리즈 API 공통 규칙 (서버 전용)
//   - 시리즈를 고치거나 지울 수 있는 사람: 만든 사람 또는 관리자
//   - 시리즈에 넣을 수 있는 영상: 직원은 내가 등록한 영상만, 관리자는 모든 영상
//   - 영상 1개는 최대 1개 시리즈에만 속한다(DB unique). 다른 시리즈에서 옮기는 것은 "내가 고칠 수 있는 시리즈"에서만 허용한다.

import { ApiFail, type Profile, type SupabaseAdmin } from '@/lib/v3/server'
import { V3_TABLES } from '@/lib/v3/tables'
import type { VideoLite } from '@/lib/v3/engagement'

export type SeriesRow = { id: string; name: string; stock_name: string | null; created_by: string | null }

export function canEditSeries(series: Pick<SeriesRow, 'created_by'>, profile: Profile, isAdmin: boolean): boolean {
  return isAdmin || series.created_by === profile.id
}

export async function loadSeriesById(supabaseAdmin: SupabaseAdmin, id: string): Promise<SeriesRow> {
  const { data, error } = await supabaseAdmin.from(V3_TABLES.videoSeries).select('id, name, stock_name, created_by').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new ApiFail(404, '시리즈를 찾을 수 없어요. 이미 삭제되었을 수 있어요. 화면을 새로 고쳐 주세요.')
  return data as SeriesRow
}

export function assertCanEditSeries(series: SeriesRow, profile: Profile, isAdmin: boolean) {
  if (!canEditSeries(series, profile, isAdmin)) {
    throw new ApiFail(403, '내가 만든 시리즈만 고칠 수 있어요.')
  }
}

export function assertOwnVideos(videos: VideoLite[], profile: Profile, isAdmin: boolean) {
  if (!isAdmin && videos.some((v) => v.primary_owner_user_id !== profile.id)) {
    throw new ApiFail(403, '내가 등록한 영상만 시리즈에 넣을 수 있어요.')
  }
}

const norm = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

// 같은 이름의 시리즈가 이미 있으면 막는다(더블 클릭으로 같은 시리즈가 두 개 생기는 것도 방지).
export async function assertNameFree(supabaseAdmin: SupabaseAdmin, name: string, exceptId?: string) {
  const { data, error } = await supabaseAdmin.from(V3_TABLES.videoSeries).select('id, name').limit(2000)
  if (error) throw error
  const target = norm(name)
  const clash = ((data || []) as { id: string; name: string }[]).some((row) => row.id !== exceptId && norm(row.name) === target)
  if (clash) throw new ApiFail(409, '같은 이름의 시리즈가 이미 있어요. 다른 이름을 쓰거나, 기존 시리즈에 영상을 추가해 주세요.')
}

export type MembershipInfo = { video_id: string; series_id: string; seriesName: string; created_by: string | null }

// 주어진 영상들이 이미 속해 있는 시리즈 정보
export async function loadMemberships(supabaseAdmin: SupabaseAdmin, videoIds: string[]): Promise<MembershipInfo[]> {
  if (videoIds.length === 0) return []
  const { data, error } = await supabaseAdmin.from(V3_TABLES.videoSeriesMembers).select('video_id, series_id').in('video_id', videoIds)
  if (error) throw error
  const rows = (data || []) as { video_id: string; series_id: string }[]
  if (rows.length === 0) return []
  const { data: seriesData, error: seriesError } = await supabaseAdmin
    .from(V3_TABLES.videoSeries)
    .select('id, name, created_by')
    .in(
      'id',
      Array.from(new Set(rows.map((r) => r.series_id)))
    )
  if (seriesError) throw seriesError
  const byId = new Map(((seriesData || []) as { id: string; name: string; created_by: string | null }[]).map((s) => [s.id, s]))
  return rows.map((r) => ({ video_id: r.video_id, series_id: r.series_id, seriesName: byId.get(r.series_id)?.name || '다른 시리즈', created_by: byId.get(r.series_id)?.created_by ?? null }))
}

// 다른 시리즈에서 옮겨 오려는 영상이 있을 때, 내가 그 시리즈를 고칠 수 없으면 막는다.
export function assertCanMove(memberships: MembershipInfo[], targetSeriesId: string | null, profile: Profile, isAdmin: boolean) {
  const blocked = memberships.find((m) => m.series_id !== targetSeriesId && !canEditSeries(m, profile, isAdmin))
  if (blocked) {
    throw new ApiFail(409, `이 영상은 다른 사람이 만든 “${blocked.seriesName}” 시리즈에 들어 있어서 옮길 수 없어요.`)
  }
}
