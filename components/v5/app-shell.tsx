'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache, fetchMe } from '@/lib/session/me-client'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { findMenuByPath, getMenusForRole, isAdminRoleType, type MenuDefinition } from '@/lib/v5/menu'

export type V5Me = {
  crmUserId: string
  name: string
  roleType: string
  roleName: string
  isAdmin: boolean
}

const MeContext = createContext<V5Me | null>(null)

// 페이지에서 현재 사용자(관리자 여부, crmUserId)를 읽을 때 쓴다.
export function useV5Me() {
  return useContext(MeContext)
}

// 사이드바 + 계정 영역. app/v5/(app)/layout.tsx 에서 한 번만 마운트된다.
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<V5Me | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        const accessToken = await getAccessToken()
        if (!accessToken) return
        const data = await fetchMe(accessToken)
        setMe({
          crmUserId: data.crmUserId,
          name: data.name,
          roleType: data.roleType,
          roleName: data.roleName || data.roleType,
          isAdmin: isAdminRoleType(data.roleType)
        })
      } catch {}
    }
    void run()
  }, [])

  const logout = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    clearMeCache()
    router.replace('/v5/login')
  }

  const groups = useMemo(() => {
    const menus = getMenusForRole(me?.roleType)
    const map = new Map<string, MenuDefinition[]>()
    for (const menu of menus) {
      const list = map.get(menu.group) || []
      list.push(menu)
      map.set(menu.group, list)
    }
    return Array.from(map.entries())
  }, [me?.roleType])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <MeContext.Provider value={me}>
      <div className="workspace">
        <aside id="app-sidebar" className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-brand">
              <img className="sidebar-brand-logo" src="/logo-ant.png" alt="" width={28} height={28} />
              <div>
                <div className="sidebar-brand-title">여왕개미미디어</div>
                <div className="sidebar-brand-sub">영상 성장 관리</div>
              </div>
            </div>
            {groups.map(([group, menus]) => (
              <div className="sidebar-group" key={group}>
                <div className="sidebar-caption">{group}</div>
                <nav className="sidebar-nav" aria-label={group}>
                  {menus.map((item) => (
                    <Link
                      key={item.href}
                      className={`sidebar-link ${isActive(item.href) ? 'active' : ''}`}
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      title={item.description}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>
            ))}
          </div>

          <div className="sidebar-section sidebar-account-box">
            {me ? (
              <div className="sidebar-account">
                <div className="sidebar-avatar">{me.name.slice(0, 1)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="sidebar-account-name">{me.name}</div>
                  <div className="small muted">{me.isAdmin ? '관리자' : '직원'}</div>
                </div>
                <button className="button secondary sm" type="button" onClick={logout}>
                  로그아웃
                </button>
              </div>
            ) : (
              <div className="small muted">계정 확인 중...</div>
            )}
          </div>
        </aside>

        <section className="content-area">{children}</section>
      </div>
    </MeContext.Provider>
  )
}

// 페이지 제목 + 한 줄 설명 + 우측 주요 버튼 슬롯. 각 page.tsx 가 맨 위에 렌더링한다.
// subtitle 을 생략하면 메뉴에 적어 둔 화면 설명을 그대로 쓴다.
export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  const pathname = usePathname()
  const description = subtitle ?? findMenuByPath(pathname)?.description
  return (
    <div className="document-head">
      <div className="document-head-top">
        <div>
          <h1 className="page-title">{title}</h1>
          {description ? <p className="page-subtitle">{description}</p> : null}
        </div>
        {actions ? <div className="document-head-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
