'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { canAccessPath, getHomeHref, isAdminRoleType } from '@/lib/v5/menu'
import { loginHref } from '@/components/v5/register-logic'

// V5(성장 실험 · 알고리즘 최적화 캔버스)는 메뉴 권한 테이블을 보지 않고 역할(role_type)만으로 접근을 가른다.
// super_admin/admin = 관리자, 그 외 = 직원. 로그인 안 된 사용자는 /v5/login 으로.
//
// 세션 확인(토큰 + /api/auth/me)은 이 공급자가 화면을 처음 열 때 딱 한 번만 한다.
// 메뉴를 옮겨 다닐 때는 이미 알고 있는 역할로 접근 권한만 다시 따진다(네트워크 호출 없음).

export type V5Me = {
  crmUserId: string
  name: string
  roleType: string
  roleName: string
  isAdmin: boolean
}

export type V5SessionState =
  | { status: 'loading'; me: null }
  | { status: 'ready'; me: V5Me }
  | { status: 'error'; me: null; message: string }

export type V5Session = V5SessionState & { retry: () => void }

const SessionContext = createContext<V5Session>({ status: 'loading', me: null, retry: () => {} })

export function useV5Session() {
  return useContext(SessionContext)
}

// 페이지에서 현재 사용자(관리자 여부, crmUserId)를 읽을 때 쓴다. 확인 전에는 null.
export function useV5Me() {
  return useContext(SessionContext).me
}

// 지금 경로를 이 사용자가 볼 수 있는지. 확인 전에는 false.
export function useV5CanAccess() {
  const pathname = usePathname()
  const { me } = useContext(SessionContext)
  return Boolean(me && canAccessPath(pathname, me.roleType))
}

export function V5SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState<V5SessionState>({ status: 'loading', me: null })
  const startedRef = useRef(false)

  const load = useCallback(async () => {
    setState({ status: 'loading', me: null })
    try {
      const accessToken = await getAccessToken()
      // 로그인 뒤 지금 보던 화면으로 돌아올 수 있게 ?next= 를 붙인다(안전한 V5 주소만 붙는다).
      const here = `${window.location.pathname}${window.location.search}`
      if (!accessToken) {
        router.replace(loginHref(here))
        return
      }
      const data = await fetchMe(accessToken)
      setState({
        status: 'ready',
        me: {
          crmUserId: data.crmUserId,
          name: data.name,
          roleType: data.roleType,
          roleName: data.roleName || data.roleType,
          isAdmin: isAdminRoleType(data.roleType)
        }
      })
    } catch (e: any) {
      // 인터넷이 끊긴 경우는 로그인 화면으로 보내지 않고 다시 시도할 수 있게 둔다.
      if (e instanceof TypeError) {
        setState({ status: 'error', me: null, message: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.' })
      } else {
        router.replace(loginHref(`${window.location.pathname}${window.location.search}`))
      }
    }
  }, [router])

  useEffect(() => {
    // 개발 모드(StrictMode)의 이중 실행에서도 확인은 한 번만 시작한다.
    if (startedRef.current) return
    startedRef.current = true
    void load()
  }, [load])

  // 이동한 경로를 볼 수 없는 역할이면 자기 첫 화면으로 돌려보낸다.
  useEffect(() => {
    if (state.status !== 'ready') return
    if (!canAccessPath(pathname, state.me.roleType)) router.replace(getHomeHref(state.me.roleType))
  }, [pathname, state, router])

  const value = useMemo<V5Session>(() => ({ ...state, retry: () => void load() }) as V5Session, [state, load])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// 예전 이름 호환: 접근 권한이 확인된 경우에만 안쪽 화면을 그린다.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const allowed = useV5CanAccess()
  return allowed ? <>{children}</> : null
}
