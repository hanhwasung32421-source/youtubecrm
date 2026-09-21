'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v3/menu'

// /v3 로 들어오면: 이미 로그인돼 있으면 역할별 첫 화면(직원=영상 등록, 관리자=참여 현황)으로,
// 아니면 로그인 화면으로 보낸다.
export default function V3EntryPage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const token = await getAccessToken()
        if (!token) {
          router.replace('/v3/login')
          return
        }
        const me = await fetchMe(token)
        if (!cancelled) router.replace(getHomeHref(me.roleType))
      } catch {
        if (!cancelled) router.replace('/v3/login')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  return null
}
