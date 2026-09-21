// V4 — 성장 · 성과 분석 CRM 메뉴 정의.
// 메뉴 권한은 DB(role_menu_permissions)를 전혀 보지 않고 역할(role_type)만으로 결정한다.
// super_admin/admin = 관리자, 그 외 = 직원(유튜버).
//
// 첫 화면(홈)은 역할마다 다르다.
//  - 직원: 매일 하는 일인 "영상 등록"
//  - 관리자: 무엇이 잘 되는지 보는 "성장 현황"

export type MenuAudience = 'admin' | 'staff' | 'all'

export type MenuDefinition = {
  key: string
  label: string
  href: string
  audience: MenuAudience
  group: string
  description: string
}

export const ADMIN_HOME_HREF = '/v4/dashboard'
export const STAFF_HOME_HREF = '/v4/register'
export const LOGIN_HREF = '/v4/login'

// 표시 순서 = 관리자 기준 순서. 직원은 getMenusForRole()에서 "영상 등록"을 맨 앞으로 옮긴다. "사용 방법"은 두 역할 모두 맨 끝.
export const MENU_DEFINITIONS: readonly MenuDefinition[] = [
  {
    key: 'growth_dashboard',
    label: '성장 현황',
    href: '/v4/dashboard',
    audience: 'all',
    group: '한눈에 보기',
    description: '조회수와 업로드가 어떻게 흘러가는지, 지금 무엇을 봐야 하는지'
  },
  {
    key: 'video_register',
    label: '영상 등록',
    href: '/v4/register',
    audience: 'all',
    group: '매일 하는 일',
    description: '유튜브 주소와 종목명만 입력하면 영상이 등록돼요'
  },
  {
    key: 'content_ranking',
    label: '영상 성과 순위',
    href: '/v4/ranking',
    audience: 'all',
    group: '잘 되는 것 찾기',
    description: '조회수·반응·확산 속도로 영상 순위 보기'
  },
  {
    key: 'stock_trends',
    label: '종목별 반응',
    href: '/v4/stocks',
    audience: 'all',
    group: '잘 되는 것 찾기',
    description: '어떤 종목 영상이 반응이 좋은지, 지난 기간보다 늘었는지'
  },
  {
    key: 'upload_timing',
    label: '업로드 시간대',
    href: '/v4/timing',
    audience: 'all',
    group: '잘 되는 것 찾기',
    description: '어느 요일·시간에 올린 영상이 조회수가 높은지'
  },
  {
    key: 'staff_comparison',
    label: '담당자 비교',
    href: '/v4/staff',
    audience: 'admin',
    group: '팀',
    description: '담당자별 업로드 수·조회수·롱폼/숏폼 비중'
  },
  {
    key: 'experiments',
    label: '제목·썸네일 실험',
    href: '/v4/experiments',
    audience: 'all',
    group: '개선 실험',
    description: '제목·썸네일을 바꿔 본 기록과 배운 점'
  },
  {
    key: 'help',
    label: '사용 방법',
    href: '/v4/help',
    audience: 'all',
    group: '도움말',
    description: '영상 등록 4단계, 키보드 단축키, 자주 묻는 질문'
  }
] as const

export function isAdminRole(roleType: string | null | undefined) {
  return roleType === 'super_admin' || roleType === 'admin'
}

// 로그인/가입 직후, 잘못된 접근 시 보낼 첫 화면.
export function homeHrefForRole(roleType: string | null | undefined) {
  return isAdminRole(roleType) ? ADMIN_HOME_HREF : STAFF_HOME_HREF
}

export function getMenusForRole(roleType: string | null | undefined) {
  const admin = isAdminRole(roleType)
  const menus = MENU_DEFINITIONS.filter((menu) => menu.audience === 'all' || (admin ? menu.audience === 'admin' : menu.audience === 'staff'))
  if (admin) return menus
  // 직원은 매일 하는 일(영상 등록)이 맨 위.
  const home = menus.filter((menu) => menu.href === STAFF_HOME_HREF)
  return [...home, ...menus.filter((menu) => menu.href !== STAFF_HOME_HREF)]
}

export function findMenuByPath(pathname: string) {
  return MENU_DEFINITIONS.find((menu) => pathname === menu.href || pathname.startsWith(`${menu.href}/`)) || null
}

export function groupMenus(menus: readonly MenuDefinition[]) {
  const groups: Array<{ group: string; items: MenuDefinition[] }> = []
  for (const menu of menus) {
    const existing = groups.find((g) => g.group === menu.group)
    if (existing) existing.items.push(menu)
    else groups.push({ group: menu.group, items: [menu] })
  }
  return groups
}
