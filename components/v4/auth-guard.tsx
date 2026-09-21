'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { LOGIN_HREF, findMenuByPath, homeHrefForRole, isAdminRole } from '@/lib/v4/menu'
import { V4MeProvider, type V4Me } from '@/components/v4/me-context'

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
    const run = async () => {
      try {
        const accessToken = await getAccessToken()
        if (!accessToken) {
          router.replace(LOGIN_HREF)
          return
        }
        let data: Awaited<ReturnType<typeof fetchMe>>
        try {
          data = await fetchMe(accessToken)
        } catch {
          router.replace(LOGIN_HREF)
          return
        }
        if (cancelled) return
        setMe({ crmUserId: data.crmUserId, name: data.name, roleType: data.roleType, roleName: data.roleName || data.roleType })
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
        <div className="message-error">{error}</div>
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
    return null
  }

  return <V4MeProvider value={me}>{children}</V4MeProvider>
}
