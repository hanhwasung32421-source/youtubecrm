'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Toast, useToast } from '@/components/toast'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache } from '@/lib/session/me-client'
import { findMenuByPath, getMenusForRole, type MenuDefinition } from '@/lib/v5/menu'
import { useV5CanAccess, useV5Session } from '@/components/v5/auth-guard'
import { Skeleton, SkeletonRegion } from '@/components/v5/widget'

// 예전 import 경로 호환: 페이지들은 계속 여기서 useV5Me 를 가져다 쓴다.
export { useV5Me } from '@/components/v5/auth-guard'
export type { V5Me } from '@/components/v5/auth-guard'

const MAIN_ID = 'v5-main'

// 사이드바(좁은 화면에서는 위쪽 가로 메뉴 띠) + 계정 영역.
// app/v5/(app)/layout.tsx 에서 한 번만 마운트되고, 세션은 V5SessionProvider 가 이미 확인해 둔다.
export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const session = useV5Session()
  const allowed = useV5CanAccess()
  const me = session.me
  const [loggingOut, setLoggingOut] = useState(false)
  const navRef = useRef<HTMLElement | null>(null)
  const { toast, showError } = useToast()

  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
      clearMeCache()
      router.replace('/v5/login')
    } catch {
      setLoggingOut(false)
      showError('로그아웃하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')
    }
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

  // 좁은 화면의 가로 메뉴 띠에서 지금 화면 버튼이 항상 보이도록 옆으로 밀어 준다.
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]')
    if (!active || !navRef.current) return
    const box = navRef.current
    if (box.scrollWidth <= box.clientWidth) return
    const target = active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2
    box.scrollLeft = Math.max(target, 0)
  }, [pathname, me?.roleType])

  return (
    <div className="workspace">
      <a
        className="v5-skip"
        href={`#${MAIN_ID}`}
        onClick={(e) => {
          e.preventDefault()
          const main = document.getElementById(MAIN_ID)
          main?.focus()
          main?.scrollIntoView({ block: 'start' })
        }}
      >
        본문으로 건너뛰기
      </a>

      <aside id="app-sidebar" className="sidebar" aria-label="메뉴와 계정">
        <div className="sidebar-section v5-side-main">
          <div className="sidebar-brand">
            <img className="sidebar-brand-logo" src="/logo-ant.png" alt="" width={28} height={28} />
            <div className="v5-brand-text">
              <div className="sidebar-brand-title">여왕개미미디어</div>
              <div className="sidebar-brand-sub">영상 성장 관리</div>
            </div>
          </div>

          <nav ref={navRef} className="v5-nav" aria-label="주요 메뉴">
            {me ? (
              groups.map(([group, menus]) => (
                <div className="sidebar-group" key={group} role="group" aria-label={group}>
                  <div className="sidebar-caption" aria-hidden="true">
                    {group}
                  </div>
                  <div className="sidebar-nav">
                    {menus.map((item) => (
                      <Link
                        key={item.href}
                        className={`sidebar-link ${isActive(item.href) ? 'active' : ''}`}
                        href={item.href}
                        prefetch
                        aria-current={isActive(item.href) ? 'page' : undefined}
                        title={item.description}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <SkeletonRegion label="메뉴를 불러오는 중" className="v5-nav-skel">
                <Skeleton height={36} radius={999} className="pill-skel" />
                <Skeleton height={36} radius={999} className="pill-skel" />
                <Skeleton height={36} radius={999} className="pill-skel" />
              </SkeletonRegion>
            )}
          </nav>
        </div>

        <div className="sidebar-section sidebar-account-box">
          {me ? (
            <div className="sidebar-account">
              <div className="sidebar-avatar" aria-hidden="true">
                {me.name.slice(0, 1)}
              </div>
              <div className="v5-account-text">
                <div className="sidebar-account-name">{me.name}</div>
                <div className="small muted v5-account-role">{me.isAdmin ? '관리자' : '직원'}</div>
              </div>
              <button className="button secondary sm v5-logout" type="button" onClick={() => void logout()} disabled={loggingOut}>
                {loggingOut ? '나가는 중...' : '로그아웃'}
              </button>
            </div>
          ) : session.status === 'error' ? (
            <div className="small muted">계정을 확인하지 못했어요.</div>
          ) : (
            <SkeletonRegion label="계정 확인 중" className="sidebar-account">
              <Skeleton circle height={34} />
              <div className="v5-account-text v5-account-skel">
                <Skeleton height={13} width="70%" />
                <Skeleton height={11} width="40%" />
              </div>
              <Skeleton height={34} width={76} radius={10} className="v5-logout-skel" />
            </SkeletonRegion>
          )}
        </div>
      </aside>

      <section id={MAIN_ID} tabIndex={-1} className="content-area" aria-label="본문">
        {me && allowed ? (
          children
        ) : session.status === 'error' ? (
          <div className="v5-empty">
            <div className="v5-empty-title">화면을 불러오지 못했어요</div>
            <div className="v5-empty-body">{session.message}</div>
            <div className="v5-empty-action">
              <button className="button sm" type="button" onClick={session.retry}>
                다시 시도
              </button>
            </div>
          </div>
        ) : (
          <SkeletonRegion label="화면을 불러오는 중" className="v5-page-skel">
            <Skeleton height={26} width="34%" radius={8} />
            <Skeleton height={14} width="58%" />
            <div className="v5-page-skel-card">
              <Skeleton height={14} width="30%" />
              <Skeleton height={44} radius={10} />
              <Skeleton height={44} radius={10} />
            </div>
          </SkeletonRegion>
        )}
      </section>
      <Toast toast={toast} />
    </div>
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

  // 브라우저 탭 제목도 지금 화면 이름으로(여러 탭을 열어 둘 때 구분이 쉽다).
  useEffect(() => {
    document.title = `${title} · 여왕개미미디어`
  }, [title])

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
