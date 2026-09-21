// V5 성장 실험 CRM 메뉴.
// 메뉴 권한은 DB(youtubeCRM_role_menu_permissions)를 보지 않고 역할(role_type)만으로 판단한다.
// super_admin/admin = 관리자, 그 외 = 직원.

export type MenuAudience = 'admin' | 'staff' | 'all'

export type MenuDefinition = {
  key: string
  label: string
  href: string
  audience: MenuAudience
  group: string
  // 사이드바에서는 더 이상 그리지 않는다(장식 제거). 기존 참조 호환용.
  icon?: string
  // 페이지 제목 아래에 한 줄로 보여주는 "이 화면은 무엇을 하는 곳인가".
  description: string
}

export const GROUP_DAILY = '매일 업무'
export const GROUP_GROWTH = '성장 관리'

export const MENU_DEFINITIONS: readonly MenuDefinition[] = [
  {
    key: 'register',
    label: '영상 등록',
    href: '/v5/register',
    audience: 'all',
    group: GROUP_DAILY,
    description: '유튜브 주소와 종목을 넣으면 제목·조회수·좋아요·댓글을 자동으로 가져옵니다.'
  },
  {
    key: 'canvas',
    label: '성장 실험',
    href: '/v5/canvas',
    audience: 'all',
    group: GROUP_GROWTH,
    description: '조회수를 늘리려고 무엇을 바꿔 보는지, 결과가 어땠는지 단계별로 관리합니다.'
  },
  {
    key: 'scoreboard',
    label: '영상 점수판',
    href: '/v5/scoreboard',
    audience: 'all',
    group: GROUP_GROWTH,
    description: '영상마다 유튜브 추천을 잘 받고 있는지 점수로 비교합니다.'
  },
  {
    key: 'playbook',
    label: '성공 공식',
    href: '/v5/playbook',
    audience: 'all',
    group: GROUP_GROWTH,
    description: '반응이 좋았던 영상의 공통점을 모아 두고 다음 영상에 다시 씁니다.'
  },
  {
    key: 'retros',
    label: '주간 회고',
    href: '/v5/retros',
    audience: 'admin',
    group: GROUP_GROWTH,
    description: '한 주를 돌아보며 잘된 점, 고칠 점, 다음 주 할 일을 남깁니다.'
  }
] as const

export const ADMIN_HOME_HREF = '/v5/canvas'
export const STAFF_HOME_HREF = '/v5/register'

export function isAdminRoleType(roleType: string | null | undefined) {
  return roleType === 'super_admin' || roleType === 'admin'
}

export function getHomeHref(roleType: string | null | undefined) {
  return isAdminRoleType(roleType) ? ADMIN_HOME_HREF : STAFF_HOME_HREF
}

// 직원은 "매일 업무"(영상 등록)가 맨 위, 관리자는 "성장 관리"가 맨 위.
export function getMenusForRole(roleType: string | null | undefined) {
  const admin = isAdminRoleType(roleType)
  const visible = MENU_DEFINITIONS.filter((menu) => menu.audience === 'all' || (admin ? menu.audience === 'admin' : menu.audience === 'staff'))
  const firstGroup = admin ? GROUP_GROWTH : GROUP_DAILY
  return [...visible].sort((a, b) => Number(b.group === firstGroup) - Number(a.group === firstGroup))
}

export function findMenuByPath(pathname: string) {
  return MENU_DEFINITIONS.find((menu) => pathname === menu.href || pathname.startsWith(`${menu.href}/`)) || null
}

export function canAccessPath(pathname: string, roleType: string | null | undefined) {
  const menu = findMenuByPath(pathname)
  if (!menu) return true
  if (menu.audience === 'all') return true
  return menu.audience === 'admin' ? isAdminRoleType(roleType) : !isAdminRoleType(roleType)
}
