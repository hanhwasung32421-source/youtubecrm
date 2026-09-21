// V3(시청자 참여 · 커뮤니티 성장 CRM) 메뉴. 권한은 DB 메뉴권한 테이블이 아니라
// 역할(roleType)로만 판단한다: super_admin/admin = 관리자, 그 외 = 직원.
// 모든 메뉴는 audience:'all'이며, 화면/데이터 범위(팀 전체 vs 본인)는 각 API가
// 역할에 따라 자체적으로 좁힌다.

export type MenuAudience = 'admin' | 'staff' | 'all'

export type MenuDefinition = {
  key: string
  label: string
  href: string
  audience: MenuAudience
  group: string
  description: string
}

// 사이드바 묶음. 순서는 역할에 따라 getMenuGroups()가 바꾼다(직원: 매일 하는 일 먼저, 관리자: 현황 먼저).
export const MENU_GROUPS = [
  { key: 'daily', label: '매일 하는 일' },
  { key: 'overview', label: '반응 한눈에 보기' },
  { key: 'compare', label: '자세히 비교하기' }
] as const

// label = 사이드바 이름 = 페이지 제목(PageHeader가 이 값을 쓴다). description = 제목 아래 한 줄 설명.
export const MENU_DEFINITIONS: MenuDefinition[] = [
  { key: 'register', label: '영상 등록', href: '/v3/register', audience: 'all', group: 'daily', description: '유튜브 주소와 종목만 넣으면 등록됩니다. 제목·조회수는 자동으로 가져옵니다.' },
  { key: 'engagement', label: '참여 현황', href: '/v3/engagement', audience: 'all', group: 'overview', description: '시청자가 좋아요·댓글로 얼마나 반응하는지 한눈에 봅니다.' },
  { key: 'viral', label: '급상승 영상', href: '/v3/viral', audience: 'all', group: 'overview', description: '조회수가 평소보다 빠르게 오르는 영상을 찾아 줍니다.' },
  { key: 'lifecycle', label: '조회수 성장', href: '/v3/lifecycle', audience: 'all', group: 'compare', description: '영상을 올린 뒤 조회수가 어떻게 늘어나는지 봅니다.' },
  { key: 'series', label: '롱폼·숏폼·시리즈 비교', href: '/v3/series', audience: 'all', group: 'compare', description: '어떤 형식과 시리즈가 반응을 더 잘 얻는지 비교합니다.' }
]

export const ADMIN_ROLE_TYPES = ['super_admin', 'admin']

export function isAdminRole(roleType: string | null | undefined) {
  return !!roleType && ADMIN_ROLE_TYPES.includes(roleType)
}

// 관리자 홈 = 참여 현황(팀 전체), 직원 홈 = 영상 등록(매일 하는 작업)
export function getHomeHref(roleType: string | null | undefined) {
  return isAdminRole(roleType) ? '/v3/engagement' : '/v3/register'
}

export function getMenuGroups(roleType: string | null | undefined) {
  if (isAdminRole(roleType)) {
    const order = ['overview', 'compare', 'daily']
    return [...MENU_GROUPS].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  }
  return [...MENU_GROUPS]
}

export function getMenuByPath(pathname: string): MenuDefinition | null {
  return MENU_DEFINITIONS.find((menu) => pathname === menu.href || pathname.startsWith(`${menu.href}/`)) || null
}

export function getVisibleMenus(roleType: string | null | undefined) {
  const admin = isAdminRole(roleType)
  return MENU_DEFINITIONS.filter((menu) => menu.audience === 'all' || (admin ? menu.audience === 'admin' : menu.audience === 'staff'))
}
