'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache } from '@/lib/session/me-client'
import { LOGIN_HREF, getMenusForRole, groupMenus, homeHrefForRole } from '@/lib/v4/menu'
import { useV4Me } from '@/components/v4/me-context'

// V4 사이드바 프레임. (workspace) 라우트 그룹 layout에서 한 번만 마운트된다.
// 메뉴는 역할(관리자/직원)로만 걸러지고, 하는 일에 따라 그룹으로 묶어 보여준다.
// 로고를 누르면 내 첫 화면(직원=영상 등록, 관리자=성장 현황)으로 돌아간다.
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me, isAdmin } = useV4Me()

  const logout = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    clearMeCache()
    router.replace(LOGIN_HREF)
  }

  const groups = groupMenus(getMenusForRole(me?.roleType))

  return (
    <div className="workspace">
      <aside id="app-sidebar" className="sidebar">
        <div className="sidebar-section">
          <Link className="v4-sidebar-brand" href={homeHrefForRole(me?.roleType)}>
            <span className="v4-sidebar-brand-dot" />
            <div>
              <div className="v4-sidebar-brand-title">여왕개미미디어</div>
              <div className="v4-sidebar-brand-sub">성장 · 성과 CRM</div>
            </div>
          </Link>
          {groups.map((group) => (
            <nav className="sidebar-nav v4-nav-group" key={group.group} aria-label={group.group}>
              <div className="sidebar-caption">{group.group}</div>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    className={`sidebar-link ${active ? 'active' : ''}`}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    title={item.description}
                  >
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          ))}
        </div>

        <div className="sidebar-section v4-account-section">
          {me ? (
            <div className="v4-account">
              <div className="v4-account-avatar">{me.name.slice(0, 1)}</div>
              <div>
                <div className="v4-account-name">{me.name}</div>
                <div className="v4-account-role">{isAdmin ? '관리자' : '직원'}</div>
              </div>
            </div>
          ) : null}
          <button className="button secondary v4-logout" onClick={logout}>
            로그아웃
          </button>
        </div>
      </aside>

      <section className="content-area">{children}</section>
    </div>
  )
}

// 페이지 제목 + "이 화면에서 무엇을 하는지" 한 줄 설명 + 오른쪽 액션 슬롯.
// 각 page.tsx가 맨 위에 렌더링한다. 지금 어느 메뉴에 있는지는 사이드바 하이라이트로 알려준다.
export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="document-head v4-head">
      <div className="document-head-top">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="v4-head-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
