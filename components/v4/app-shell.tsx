'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache } from '@/lib/session/me-client'
import { LOGIN_HREF, getMenusForRole, groupMenus, homeHrefForRole } from '@/lib/v4/menu'
import { useV4Me } from '@/components/v4/me-context'
import { clearDashboardCache } from '@/components/v4/dashboard-cache'

// V4 사이드바 프레임. (workspace) 라우트 그룹 layout에서 한 번만 마운트된다 (화면을 옮겨도 다시 그려지지 않는다).
// 메뉴는 역할(관리자/직원)로만 걸러지고, 하는 일에 따라 그룹으로 묶어 보여준다.
// 로고를 누르면 내 첫 화면(직원=영상 등록, 관리자=성장 현황)으로 돌아간다.
// 넓은 화면: 왼쪽 세로 메뉴 / 좁은 화면(1100px 이하): 위쪽 가로 스크롤 메뉴 띠 + 작은 계정 줄.
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me, isAdmin } = useV4Me()
  const [loggingOut, setLoggingOut] = useState(false)
  const [moreRight, setMoreRight] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
    } finally {
      clearMeCache()
      clearDashboardCache()
      router.replace(LOGIN_HREF)
    }
  }

  const roleType = me?.roleType
  const groups = useMemo(() => groupMenus(getMenusForRole(roleType)), [roleType])

  // 가로 메뉴 띠에서 오른쪽에 더 있다는 표시(끝이 흐려짐)
  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [measure, groups])

  // 지금 화면의 메뉴가 띠 안에서 보이도록 가로로만 옮겨 준다 (세로 스크롤은 건드리지 않는다).
  useEffect(() => {
    const el = scrollRef.current
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !active) return
    if (el.scrollWidth <= el.clientWidth) return
    const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2
    el.scrollLeft = Math.max(0, target)
    measure()
  }, [pathname, groups, measure])

  return (
    <div className="workspace">
      <a className="v4-skip-link" href="#v4-main">
        본문으로 건너뛰기
      </a>
      <aside id="app-sidebar" className="sidebar" aria-label="메뉴와 계정">
        <div className="sidebar-section v4-nav-section">
          <Link className="v4-sidebar-brand" href={homeHrefForRole(roleType)} prefetch>
            <span className="v4-sidebar-brand-dot" aria-hidden="true" />
            <div>
              <div className="v4-sidebar-brand-title">여왕개미미디어</div>
              <div className="v4-sidebar-brand-sub">성장 · 성과 CRM</div>
            </div>
          </Link>
          <nav aria-label="주요 메뉴" className={`v4-nav ${moreRight ? 'has-more' : ''}`}>
            <div className="v4-nav-scroll" ref={scrollRef}>
              {groups.map((group) => (
                <div className="sidebar-nav v4-nav-group" key={group.group} role="group" aria-label={group.group}>
                  <div className="sidebar-caption" aria-hidden="true">
                    {group.group}
                  </div>
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                    return (
                      <Link
                        key={item.href}
                        className={`sidebar-link ${active ? 'active' : ''}`}
                        href={item.href}
                        prefetch
                        aria-current={active ? 'page' : undefined}
                        title={item.description}
                      >
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              ))}
            </div>
          </nav>
        </div>

        <div className="sidebar-section v4-account-section">
          {me ? (
            <div className="v4-account">
              <div className="v4-account-avatar" aria-hidden="true">
                {me.name.slice(0, 1)}
              </div>
              <div className="v4-account-text">
                <span className="v4-account-name">{me.name}</span>
                <span className="v4-account-role">{isAdmin ? '관리자' : '직원'}</span>
              </div>
            </div>
          ) : null}
          <button type="button" className="button secondary v4-logout" onClick={logout} disabled={loggingOut}>
            {loggingOut ? '나가는 중…' : '로그아웃'}
          </button>
        </div>
      </aside>

      <section className="content-area" id="v4-main" tabIndex={-1} aria-label="본문">
        {children}
      </section>
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
