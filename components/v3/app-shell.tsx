'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache } from '@/lib/session/me-client'
import { getMenuByPath, getMenuGroups, getVisibleMenus } from '@/lib/v3/menu'
import { useV3Session } from '@/components/v3/auth-guard'
import { NavSkeleton, PageSkeleton, Skel } from '@/components/v3/skeleton'

// 사이드바(페이지 트리) + 계정 영역. app/v3/(workspace)/layout.tsx에서 한 번만 마운트된다.
// 넓은 화면: 왼쪽 트리. 좁은 화면(1100px 이하): 위쪽의 한 줄 가로 메뉴(알약 모양) + 계정/로그아웃 작은 줄.
// 로그인 확인 중에는 같은 자리에 회색 뼈대를 보여 줘서 확인이 끝나도 화면이 밀리지 않는다.
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me, error, ready } = useV3Session()
  const [loggingOut, setLoggingOut] = useState(false)
  const navRef = useRef<HTMLElement | null>(null)

  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
    } finally {
      clearMeCache()
      router.replace('/v3/login')
    }
  }

  const menus = getVisibleMenus(me?.roleType)
  const groups = getMenuGroups(me?.roleType)

  // 스크린리더가 화면 이동을 알아채고, 브라우저 탭·기록에도 어느 화면인지 보이도록 제목을 맞춘다.
  useEffect(() => {
    const menu = getMenuByPath(pathname)
    document.title = menu ? `${menu.label} · 여왕개미미디어 CRM` : '여왕개미미디어 CRM'
  }, [pathname])

  // 좁은 화면의 가로 메뉴에서 지금 화면의 메뉴가 보이도록 가운데로 맞춘다(넓은 화면에서는 아무 일도 안 함).
  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2)
  }, [pathname, me])

  const skipToMain = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const main = document.getElementById('v3-main')
    main?.focus()
    main?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="workspace">
      <a className="v3-skip" href="#v3-main" onClick={skipToMain}>
        본문으로 바로가기
      </a>

      <aside id="app-sidebar" className="sidebar">
        <div className="sidebar-section v3-side">
          <div className="v3-sidebar-brand">
            <span>여왕개미미디어</span>
            <span className="v3-sidebar-brand-sub">참여·성장 CRM</span>
          </div>

          {me ? (
            <nav ref={navRef} className="v3-nav" aria-label="주요 메뉴">
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
          ) : (
            <div className="v3-nav">
              <NavSkeleton />
            </div>
          )}

          <div className="v3-sidebar-account">
            <div className="v3-account-who">
              {me ? (
                <>
                  <div className="v3-account-name">{me.name}</div>
                  <div className="v3-account-role">{me.isAdmin ? '관리자' : '직원'}</div>
                </>
              ) : (
                <>
                  <Skel w={72} h={20} />
                  <Skel w={40} h={19} />
                </>
              )}
            </div>
            <button type="button" className="button secondary v3-logout" onClick={logout} disabled={loggingOut}>
              {loggingOut ? '나가는 중…' : '로그아웃'}
            </button>
          </div>
        </div>
      </aside>

      <section id="v3-main" className="content-area" tabIndex={-1}>
        {ready ? (
          children
        ) : error ? (
          <div role="alert" className="message-error">
            {error}{' '}
            <button type="button" className="v3-text-button" onClick={() => window.location.reload()}>
              다시 불러오기
            </button>
          </div>
        ) : (
          <PageSkeleton />
        )}
      </section>
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
        {actions ? <div className="row v3-head-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
