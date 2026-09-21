// V4 전용 테이블 + 읽기용으로 참조하는 공용 테이블 이름.
// 모든 테이블은 "youtubeCRM_" 접두어(대소문자 구분)를 쓴다.

const PREFIX = 'youtubeCRM_'

export const V4_TABLES = {
  // V4가 새로 만드는 테이블 (supabase/sql/v4/100_v4_growth.sql)
  contentExperiments: `${PREFIX}content_experiments`,
  growthGoals: `${PREFIX}growth_goals`,

  // 공용 테이블 (읽기 전용. 예외: sync-stats 라우트의 videos 통계 갱신 + snapshots insert)
  videos: `${PREFIX}videos`,
  crmUsers: `${PREFIX}crm_users`,
  channels: `${PREFIX}channels`,
  videoSnapshots: `${PREFIX}video_snapshots`,
  youtubeAccounts: `${PREFIX}youtube_accounts`
} as const

export const V4_SQL_FILE = 'supabase/sql/v4/100_v4_growth.sql'
export const MISSING_TABLE_MESSAGE = `기록을 저장할 공간이 아직 만들어지지 않았어요. 개발 담당자에게 ${V4_SQL_FILE} 실행을 요청해 주세요.`

// PostgREST가 "테이블 없음"을 알려주는 방식은 버전에 따라 42P01 코드이거나 schema cache 메시지다.
export function isMissingTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string }
  if (err.code === '42P01') return true
  return /does not exist|Could not find the table|schema cache/i.test(err.message || '')
}
