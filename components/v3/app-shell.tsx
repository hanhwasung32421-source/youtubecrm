'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache } from '@/lib/session/me-client'
import { getMenuByPath, getMenuGroups, getVisibleMenus } from '@/lib/v3/menu'
import { useV3Me } from '@/components/v3/auth-guard'

// 사이드바(페이지 트리) + 계정 영역. app/v3/(workspace)/layout.tsx에서 한 번만 마운트된다.
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const me = useV3Me()

  const logout = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    clearMeCache()
    router.replace('/v3/login')
  }

  const menus = getVisibleMenus(me?.roleType)
  const groups = getMenuGroups(me?.roleType)

  return (
    <div className="workspace">
      <aside id="app-sidebar" className="sidebar">
        <div className="sidebar-section">
          <div className="v3-sidebar-brand">
            <span>여왕개미미디어</span>
            <span className="v3-sidebar-brand-sub">참여·성장 CRM</span>
          </div>
          <nav aria-label="주요 메뉴">
            {groups.map((group) => {
              const items = menus.filter((menu) => menu.group === group.key)
              if (items.length === 0) return null
              return (
                <div className="v3-tree-group" key={group.key}>
                  <div className="v3-tree-caption">{group.label}</div>
                  {items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                    return (
                      <Link
                        key={item.key}
                        className={`v3-tree-link ${active ? 'active' : ''}`}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                      >
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          <div className="v3-sidebar-account">
            {me ? (
              <div className="small">
                <div style={{ fontWeight: 600 }}>{me.name}</div>
                <div className="muted">{me.isAdmin ? '관리자' : '직원'}</div>
              </div>
            ) : null}
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

// 문서 제목 영역. 제목은 사이드바 메뉴 이름과 항상 같도록 menu.ts의 label을 우선 쓰고,
// 제목 아래 한 줄 설명도 짧은 경우에만 페이지가 넘긴 문구를 쓴다(길면 menu.ts의 설명으로 대체).
export function PageHeader({ icon, title, subtitle, actions }: { icon?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  const pathname = usePathname()
  const menu = getMenuByPath(pathname)
  const shownTitle = menu?.label || title
  const shownSubtitle = subtitle && subtitle.length <= 60 ? subtitle : menu?.description || subtitle

  return (
    <div className="document-head">
      <div className="document-head-top">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">
            {icon ? <span className="v3-page-icon" aria-hidden>{icon}</span> : null}
            {shownTitle}
          </h1>
          {shownSubtitle ? <p className="page-subtitle">{shownSubtitle}</p> : null}
        </div>
        {actions ? <div className="row" style={{ flexShrink: 0 }}>{actions}</div> : null}
      </div>
    </div>
  )
}
