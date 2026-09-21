'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache } from '@/lib/session/me-client'
import { findMenuByPath, getHomeHref, getMenusForRole, groupMenus } from '@/lib/v2/menu'
import { useV2Me } from './session-context'

// V2 셸: 그룹형 사이드바. 세션은 AuthGuard가 컨텍스트로 넘겨준다.
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const me = useV2Me()

  const groups = groupMenus(getMenusForRole(me.isAdmin))

  const logout = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    clearMeCache()
    router.replace('/v2/login')
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <div className="workspace">
      <aside id="app-sidebar" className="sidebar">
        <div className="sidebar-section v2-sidebar-brand">
          <Link className="v2-brand-line" href={getHomeHref(me.isAdmin)}>
            여왕개미미디어
          </Link>
          <div className="small muted" style={{ marginTop: 6 }}>
            검색에 잘 걸리는 영상 관리
          </div>
        </div>

        {groups.map((group) => (
          <div className="sidebar-section" key={group.group}>
            <div className="sidebar-caption">{group.group}</div>
            <nav className="sidebar-nav" aria-label={`${group.group} 메뉴`}>
              {group.items.map((item) => {
                const active = isActive(item.href)
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
          </div>
        ))}

        <div className="sidebar-section">
          <div className="v2-account">
            <div className="v2-account-name">{me.name || '-'}</div>
            <div className="small muted">{me.isAdmin ? '관리자' : '직원'}</div>
          </div>
          <div className="stack" style={{ marginTop: 10 }}>
            <button className="button secondary" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>
      </aside>

      <section className="content-area">{children}</section>
    </div>
  )
}

// 페이지 제목/한 줄 설명. 제목은 사이드바 메뉴 이름과 항상 같게 맞추고,
// 설명은 페이지가 따로 넘기지 않으면 메뉴에 적어 둔 설명을 쓴다.
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  const pathname = usePathname()
  const menu = findMenuByPath(pathname)
  const shownTitle = menu?.label || title
  const shownSubtitle = subtitle || menu?.description

  return (
    <div className="document-head">
      <div className="document-head-top">
        <div>
          <h1 className="page-title">{shownTitle}</h1>
          {shownSubtitle ? <p className="page-subtitle">{shownSubtitle}</p> : null}
        </div>
        {actions ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
