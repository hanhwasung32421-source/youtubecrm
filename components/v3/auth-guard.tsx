'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { clearMeCache, fetchMe } from '@/lib/session/me-client'
import { getHomeHref, getMenuByPath, isAdminRole } from '@/lib/v3/menu'
import { loginHref } from '@/components/v3/safe-next'

export type V3Me = {
  crmUserId: string
  name: string
  roleType: string
  roleName: string
  isAdmin: boolean
}

// ready = 로그인 확인이 끝났고 이 화면을 볼 권한도 있음(그때만 본문을 그린다).
export type V3Session = { me: V3Me | null; error: string; ready: boolean }

const V3SessionContext = createContext<V3Session>({ me: null, error: '', ready: false })

// 각 화면이 쓰는 기존 훅: 준비가 끝났을 때만 사용자 정보를 돌려준다.
export function useV3Me() {
  const { me, ready } = useContext(V3SessionContext)
  return ready ? me : null
}

// 셸(사이드바)이 쓰는 훅: 로딩 중에도 상태를 알 수 있다.
export function useV3Session() {
  return useContext(V3SessionContext)
}

// 역할(roleType)만으로 접근을 판단한다. super_admin/admin = 관리자, 그 외 = 직원.
// 로그인 확인(세션 + /api/auth/me)은 이 레이아웃이 처음 열릴 때 한 번만 한다.
// 메뉴 이동 때는 이미 알고 있는 사용자 정보로 권한만 다시 따지므로 네트워크 요청이 없다.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<V3Me | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    // 로그인 화면으로 보낼 때 지금 보던 화면을 ?next= 로 남겨서, 로그인하면 그 화면으로 돌아오게 한다.
    const goLogin = () => router.replace(loginHref(window.location.pathname + window.location.search))
    const run = async () => {
      try {
        const accessToken = await getAccessToken()
        if (!accessToken) {
          goLogin()
          return
        }

        let profile: Awaited<ReturnType<typeof fetchMe>>
        try {
          profile = await fetchMe(accessToken)
        } catch {
          goLogin()
          return
        }
        if (cancelled) return

        setMe({
          crmUserId: profile.crmUserId,
          name: profile.name,
          roleType: profile.roleType,
          roleName: profile.roleName || profile.roleType,
          isAdmin: isAdminRole(profile.roleType)
        })
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '인증 확인 중 오류가 발생했습니다.')
      }
    }

    void run()

    // 다른 탭에서 로그아웃했거나 로그인이 만료되면 로그인 화면으로 돌려보낸다.
    let unsubscribe: (() => void) | null = null
    try {
      const { data } = createSupabaseBrowserClient().auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          clearMeCache()
          goLogin()
        }
      })
      unsubscribe = () => data.subscription.unsubscribe()
    } catch {
      // 구독에 실패해도 화면 사용에는 영향이 없다.
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [router])

  // 관리자 전용 메뉴에 직원이 들어오면 직원 홈(/v3/register)으로 돌려보낸다(요청 없이 즉시 판단).
  const menu = getMenuByPath(pathname)
  const blocked = !!me && !!menu && menu.audience === 'admin' && !me.isAdmin

  useEffect(() => {
    if (me && blocked) router.replace(getHomeHref(me.roleType))
  }, [me, blocked, router])

  const value = useMemo<V3Session>(() => ({ me, error, ready: !!me && !blocked }), [me, error, blocked])

  return <V3SessionContext.Provider value={value}>{children}</V3SessionContext.Provider>
}
