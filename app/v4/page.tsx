'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { LOGIN_HREF, homeHrefForRole } from '@/lib/v4/menu'

// /v4 로 들어오면: 이미 로그인돼 있으면 역할별 첫 화면(직원=영상 등록, 관리자=성장 현황),
// 아니면 로그인 화면으로 보낸다.
export default function V4EntryPage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const token = await getAccessToken()
        if (!token) {
          router.replace(LOGIN_HREF)
          return
        }
        const me = await fetchMe(token)
        if (!cancelled) router.replace(homeHrefForRole(me.roleType))
      } catch {
        if (!cancelled) router.replace(LOGIN_HREF)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  return <div className="small muted" style={{ padding: 24 }}>이동하는 중이에요…</div>
}
