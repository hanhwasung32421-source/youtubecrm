'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v3/menu'
import { BusyLabel, Skel } from '@/components/v3/skeleton'

// /v3 로 들어오면: 이미 로그인돼 있으면 역할별 첫 화면(직원=영상 등록, 관리자=참여 현황)으로,
// 아니면 로그인 화면으로 보낸다.
export default function V3EntryPage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const token = await getAccessToken()
        if (cancelled) return
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

  // 잠깐 하얀 화면이 보이지 않도록 자리만 잡아 둔다.
  return (
    <div className="auth-wrap v3-auth" aria-busy="true">
      <div className="auth-center">
        <div className="panel v3-entry-skel">
          <BusyLabel>이동하는 중이에요</BusyLabel>
          <Skel w={56} h={56} r={12} style={{ margin: '0 auto' }} />
          <Skel w="60%" h={22} style={{ margin: '14px auto 0' }} />
          <Skel w="80%" h={14} style={{ margin: '10px auto 0' }} />
        </div>
      </div>
    </div>
  )
}
