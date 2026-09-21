'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache } from '@/lib/session/me-client'
import { findMenuByPath, getHomeHref, getMenusForRole, groupMenus } from '@/lib/v2/menu'
import { setCachedV2Me, useV2Me } from './session-context'

// V2 셸: 넓은 화면에서는 그룹형 사이드바, 좁은 화면(≈1100px 이하)에서는 위쪽의 한 줄 메뉴 띠.
// 세션은 AuthGuard가 컨텍스트로 넘겨준다(여기서는 /api/auth/me를 다시 부르지 않는다).
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const me = useV2Me()
  const [loggingOut, setLoggingOut] = useState(false)
  const navRef = useRef<HTMLDivElement | null>(null)

  const groups = useMemo(() => groupMenus(getMenusForRole(me.isAdmin)), [me.isAdmin])

  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
    } catch {
      // 로그아웃 요청이 실패해도 이 기기에서는 화면을 떠난다.
    }
    clearMeCache()
    setCachedV2Me(null)
    router.replace('/v2/login')
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  // 좁은 화면에서 지금 보고 있는 메뉴 알약이 띠 안에서 보이도록 옆으로 밀어 준다(페이지 자체는 스크롤하지 않는다).
  useEffect(() => {
    const wrap = navRef.current
    if (!wrap || wrap.scrollWidth <= wrap.clientWidth) return
    const current = wrap.querySelector<HTMLElement>('[aria-current="page"]')
    if (!current) return
    wrap.scrollLeft = Math.max(0, current.offsetLeft - (wrap.clientWidth - current.offsetWidth) / 2)
  }, [pathname, groups])

  const skipToContent = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('v2-main')
    if (!target) return
    e.preventDefault()
    target.focus()
    target.scrollIntoView({ block: 'start' })
  }

  return (
    <>
      <a className="v2-skip" href="#v2-main" onClick={skipToContent}>
        본문으로 건너뛰기
      </a>
      <div className="workspace">
        <aside id="app-sidebar" className="sidebar v2-sidebar">
          <div className="sidebar-section v2-sidebar-brand">
            <Link className="v2-brand-line" href={getHomeHref(me.isAdmin)}>
              여왕개미미디어
            </Link>
            <div className="small muted v2-brand-tag">검색에 잘 걸리는 영상 관리</div>
          </div>

          <div className="v2-navwrap" ref={navRef}>
            {groups.map((group) => (
              <div className="sidebar-section v2-navgroup" key={group.group}>
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
          </div>

          <div className="sidebar-section v2-account-section">
            <div className="v2-account">
              <div className="v2-account-name">{me.name || '-'}</div>
              <div className="small muted">{me.isAdmin ? '관리자' : '직원'}</div>
            </div>
            <button type="button" className="button secondary v2-logout" onClick={() => void logout()} disabled={loggingOut}>
              {loggingOut ? '나가는 중…' : '로그아웃'}
            </button>
          </div>
        </aside>

        <section id="v2-main" className="content-area" tabIndex={-1} aria-label="본문">
          {children}
        </section>
      </div>
    </>
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
