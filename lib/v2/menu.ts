// V2 SEO·발견성 최적화 CRM 메뉴. 권한은 DB가 아니라 역할(roleType)만으로 판단한다.
export type MenuAudience = 'admin' | 'staff' | 'all'

export type MenuDefinition = {
  key: string
  label: string
  href: string
  audience: MenuAudience
  group: string
  // 페이지 제목 아래에 한 줄로 보이는 "이 화면은 무엇을 하는 곳인지" 설명
  description?: string
}

// 관리자는 요약부터, 직원은 매일 하는 영상 등록부터 보이도록 순서를 잡는다.
export const MENU_DEFINITIONS: readonly MenuDefinition[] = [
  { key: 'report', label: '성과 요약', href: '/v2/report', audience: 'admin', group: '한눈에 보기', description: '검색에서 어떤 영상·담당자가 잘 되고 있는지 순위로 봅니다.' },
  { key: 'register', label: '영상 등록', href: '/v2/register', audience: 'all', group: '영상', description: '유튜브 주소와 종목만 넣으면 조회수·좋아요는 자동으로 가져옵니다.' },
  { key: 'optimization', label: '영상 점검', href: '/v2/optimization', audience: 'all', group: '영상', description: '영상마다 제목·썸네일이 검색에 유리한지 점수로 확인합니다.' },
  { key: 'keywords', label: '키워드 모음', href: '/v2/keywords', audience: 'all', group: '기획', description: '지금 다루면 좋은 검색어를 팀이 함께 모아 두는 곳입니다.' },
  { key: 'planner', label: '업로드 계획', href: '/v2/planner', audience: 'admin', group: '기획', description: '요일별로 누가 어떤 영상을 올릴지 계획합니다.' }
] as const

// 직원(=매일 영상을 등록하는 사람)의 시작 화면. AuthGuard가 권한 없는 접근을 돌려보낼 때도 쓴다.
export const V2_HOME_HREF = '/v2/register'
export const V2_ADMIN_HOME_HREF = '/v2/report'

export function getHomeHref(isAdmin: boolean) {
  return isAdmin ? V2_ADMIN_HOME_HREF : V2_HOME_HREF
}

export function isAdminRoleType(roleType: string | null | undefined) {
  return roleType === 'super_admin' || roleType === 'admin'
}

export function getMenusForRole(isAdmin: boolean): MenuDefinition[] {
  return MENU_DEFINITIONS.filter((menu) => menu.audience === 'all' || (isAdmin ? menu.audience === 'admin' : menu.audience === 'staff'))
}

export function findMenuByPath(pathname: string | null | undefined): MenuDefinition | null {
  if (!pathname) return null
  return MENU_DEFINITIONS.find((menu) => pathname === menu.href) || null
}

export function groupMenus(menus: MenuDefinition[]): { group: string; items: MenuDefinition[] }[] {
  const groups: { group: string; items: MenuDefinition[] }[] = []
  for (const menu of menus) {
    let bucket = groups.find((g) => g.group === menu.group)
    if (!bucket) {
      bucket = { group: menu.group, items: [] }
      groups.push(bucket)
    }
    bucket.items.push(menu)
  }
  return groups
}
