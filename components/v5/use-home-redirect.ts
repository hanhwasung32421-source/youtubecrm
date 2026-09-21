'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v5/menu'
import { readNextFromSearch } from '@/components/v5/register-logic'

// 이미 로그인한 사람이면 역할에 맞는 첫 화면(직원=영상 등록, 관리자=성장 실험)으로 보낸다.
// 로그인 안 됐거나 확인에 실패하면 checking=false 로 돌려주고, 호출한 화면이 그대로 보여준다.
export function useHomeRedirect(fallback?: string) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const token = await getAccessToken()
        if (token) {
          const me = await fetchMe(token)
          if (!cancelled) {
            // 로그인 화면에 ?next=/v5/… 로 들어왔다면 하던 화면으로(안전한 V5 주소만).
            router.replace(readNextFromSearch(window.location.search) ?? getHomeHref(me.roleType))
            return
          }
        }
      } catch {}
      if (!cancelled) {
        if (fallback) router.replace(fallback)
        else setChecking(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return checking
}
