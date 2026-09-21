'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { isAdminRoleType, V2_HOME_HREF } from '@/lib/v2/menu'
import { safeNextPath } from './register-flow'
import { ShellSkeleton } from './skeletons'
import { getCachedV2Me, sameV2Me, setCachedV2Me, V2SessionProvider, useV2Me, type V2Me } from './session-context'

const NETWORK_TEXT = '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
const SERVER_TEXT = '서버가 잠시 응답하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'
// 서버가 "로그인이 필요합니다" 등으로 답한 경우만 로그인이 끊긴 것으로 본다(서버가 잠깐 아픈 것과 구분).
const AUTH_PROBLEM = /로그인|인증|토큰|프로필/

// V2는 메뉴 권한 테이블을 쓰지 않는다. 역할(roleType)만으로 관리자/직원을 가른다.
// 로그인 안 됨 → /v2/login. 관리자 전용 화면은 각 페이지가 <AdminOnly>로 한 번 더 막는다.
//
// 이 가드는 (ops) 레이아웃에 한 번만 붙어 있어서 메뉴를 옮겨 다녀도 다시 마운트되지 않는다.
// 처음 들어올 때만 확인하고, 이미 확인된 프로필이 메모리에 있으면 그것으로 곧바로 그린 뒤 뒤에서 다시 확인한다.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [me, setMe] = useState<V2Me | null>(() => getCachedV2Me())
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const leaveToLogin = () => {
      if (cancelled) return
      setCachedV2Me(null)
      // 로그인이 끊겨서 쫓겨나는 경우, 로그인 뒤 지금 보던 화면으로 돌아올 수 있게 주소를 실어 보낸다.
      const here = safeNextPath(`${window.location.pathname}${window.location.search}`)
      router.replace(here ? `/v2/login?next=${encodeURIComponent(here)}` : '/v2/login')
    }
    const run = async () => {
      try {
        const accessToken = await getAccessToken()
        if (cancelled) return
        if (!accessToken) {
          leaveToLogin()
          return
        }

        let data: Awaited<ReturnType<typeof fetchMe>>
        try {
          data = await fetchMe(accessToken)
        } catch (e: unknown) {
          if (cancelled) return
          // 인터넷이 잠깐 끊긴 것(TypeError)이나 서버가 잠깐 아픈 것이면 로그인 화면으로 쫓아내지 않고 다시 시도할 수 있게 한다.
          if (e instanceof TypeError) {
            setError(NETWORK_TEXT)
            return
          }
          if (e instanceof Error && AUTH_PROBLEM.test(e.message)) {
            leaveToLogin()
            return
          }
          setError(SERVER_TEXT)
          return
        }
        if (cancelled) return

        const next: V2Me = {
          crmUserId: data.crmUserId,
          name: data.name,
          roleType: data.roleType,
          roleName: data.roleName || data.roleType,
          isAdmin: isAdminRoleType(data.roleType)
        }
        setCachedV2Me(next)
        setError('')
        // 내용이 같으면 기존 객체를 그대로 두어 불필요한 다시 그리기를 막는다.
        setMe((prev) => (sameV2Me(prev, next) ? prev : next))
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof TypeError ? NETWORK_TEXT : SERVER_TEXT)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, attempt])

  if (error && !me) {
    return (
      <div className="panel v2-guard-error" role="alert">
        <div className="v2-guard-error-text">{error}</div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="button"
            onClick={() => {
              setError('')
              setAttempt((n) => n + 1)
            }}
          >
            다시 시도
          </button>
          <Link className="button secondary" href="/v2/login">
            로그인 화면으로
          </Link>
        </div>
      </div>
    )
  }

  if (!me) {
    return <ShellSkeleton />
  }

  return <V2SessionProvider me={me}>{children}</V2SessionProvider>
}

// 관리자 전용 페이지 본문을 감싼다. 직원이면 영상 등록 홈으로 돌려보낸다.
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const me = useV2Me()
  const router = useRouter()

  useEffect(() => {
    if (me.crmUserId && !me.isAdmin) router.replace(V2_HOME_HREF)
  }, [me.crmUserId, me.isAdmin, router])

  if (!me.isAdmin) return null
  return <>{children}</>
}
