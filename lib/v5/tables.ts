// V5(성장 실험 · 알고리즘 최적화 캔버스) 전용 테이블. 메인 앱과 같은 Supabase
// 프로젝트를 쓰므로 모두 youtubeCRM_ 접두어를 붙인다. DDL은
// supabase/sql/v5/100_v5_growth_lab.sql 참고.

const PREFIX = 'youtubeCRM_'

export const V5_TABLES = {
  growthExperiments: `${PREFIX}growth_experiments`,
  playbookEntries: `${PREFIX}playbook_entries`,
  weeklyRetros: `${PREFIX}weekly_retros`,
  // 읽기 전용으로 참조하는 기존(공용) 테이블
  crmUsers: `${PREFIX}crm_users`,
  videos: `${PREFIX}videos`,
  videoSnapshots: `${PREFIX}video_snapshots`,
  youtubeAccounts: `${PREFIX}youtube_accounts`
} as const

export const V5_SQL_FILE = 'supabase/sql/v5/100_v5_growth_lab.sql'
export const V5_MISSING_TABLE_MESSAGE = '성장 관리 저장소가 아직 준비되지 않았어요. 관리자에게 알려 주세요.'
