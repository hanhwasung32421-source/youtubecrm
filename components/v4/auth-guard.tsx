'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { LOGIN_HREF, findMenuByPath, homeHrefForRole, isAdminRole } from '@/lib/v4/menu'
import { loginHrefWithNext } from '@/components/v4/safe-next'
import { V4MeProvider, type V4Me } from '@/components/v4/me-context'
import { KpiSkeleton, Skel, SkelRegion } from '@/components/v4/skeleton'

// 로그인 확인 중(또는 다른 화면으로 옮겨 가는 중)에 빈 화면 대신 보여 주는 뼈대.
// 실제 화면과 같은 자리를 잡아 두어서 뒤늦게 나타나도 화면이 출렁이지 않는다.
function BootFrame() {
  return (
    <SkelRegion label="화면을 불러오는 중" className="workspace v4-boot">
      <div className="sidebar" aria-hidden="true">
        <div className="sidebar-section v4-boot-nav">
          <Skel w={120} h={16} className="on-dark" />
          <Skel w="100%" h={36} r={10} className="on-dark" style={{ marginTop: 16 }} />
          <Skel w="100%" h={36} r={10} className="on-dark" style={{ marginTop: 8 }} />
          <Skel w="100%" h={36} r={10} className="on-dark" style={{ marginTop: 8 }} />
        </div>
      </div>
      <div className="content-area" aria-hidden="true">
        <div className="document-head v4-head">
          <Skel w={160} h={24} />
          <Skel w="60%" h={14} style={{ marginTop: 12, display: 'block' }} />
        </div>
        <div className="grid grid-4">
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </div>
      </div>
    </SkelRegion>
  )
}

// 역할(role_type)만으로 접근을 판단한다. 공용 백엔드의 메뉴 권한(allowedMenuKeys)은
// 옛 메뉴 키만 알고 있으므로 V4에서는 전혀 참조하지 않는다.
//
// 1) 로그인 확인은 한 번만 한다 (화면을 옮길 때마다 다시 확인하지 않는다).
// 2) 화면 이동 때는 저장된 역할만으로 접근 여부를 판단한다.
//    - 관리자 전용 화면에 직원이 들어오면 → 직원 홈(영상 등록)으로
//    - 로그인이 안 되어 있으면 → 로그인으로
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<V4Me | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    // 로그인이 필요하면 지금 보던 화면을 기억해 두었다가, 로그인 뒤에 그 화면으로 돌려보낸다.
    const loginHref = () => loginHrefWithNext(LOGIN_HREF, `${window.location.pathname}${window.location.search}`)
    const run = async () => {
      try {
        const accessToken = await getAccessToken()
        if (!accessToken) {
          router.replace(loginHref())
          return
        }
        let data: Awaited<ReturnType<typeof fetchMe>>
        try {
          data = await fetchMe(accessToken)
        } catch {
          router.replace(loginHref())
          return
        }
        if (cancelled) return
        const next: V4Me = { crmUserId: data.crmUserId, name: data.name, roleType: data.roleType, roleName: data.roleName || data.roleType }
        // 같은 사람이면 그대로 둬서 아래 화면들이 괜히 다시 그려지지 않게 한다.
        setMe((prev) => (prev && prev.crmUserId === next.crmUserId && prev.roleType === next.roleType && prev.name === next.name ? prev : next))
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '로그인 확인 중 문제가 생겼습니다. 새로고침하거나 다시 로그인해 주세요.')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  const allowed = useMemo(() => {
    if (!me) return false
    const menu = findMenuByPath(pathname)
    if (!menu) return true
    return !(menu.audience === 'admin' && !isAdminRole(me.roleType))
  }, [me, pathname])

  useEffect(() => {
    if (me && !allowed) router.replace(homeHrefForRole(me.roleType))
  }, [me, allowed, router])

  if (error) {
    return (
      <div className="panel" style={{ margin: 24 }}>
        <div className="message-error" role="alert">{error}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="button secondary" onClick={() => window.location.reload()}>
            새로고침
          </button>
          <button className="button secondary" onClick={() => router.replace(LOGIN_HREF)}>
            로그인 화면으로
          </button>
        </div>
      </div>
    )
  }

  if (!me || !allowed) {
    return <BootFrame />
  }

  return <V4MeProvider value={me}>{children}</V4MeProvider>
}
