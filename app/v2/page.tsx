'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref, isAdminRoleType } from '@/lib/v2/menu'

// 들어오는 사람에 따라 시작 화면을 나눈다: 관리자는 성과 요약, 직원은 영상 등록. 로그인 전이면 로그인으로.
export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const token = await getAccessToken()
        if (!token) {
          router.replace('/v2/login')
          return
        }
        const me = await fetchMe(token)
        if (!cancelled) router.replace(getHomeHref(isAdminRoleType(me.roleType)))
      } catch {
        if (!cancelled) router.replace('/v2/login')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  return null
}
