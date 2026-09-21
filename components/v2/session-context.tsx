'use client'

import { createContext, useContext } from 'react'

// AuthGuard가 한 번 조회한 프로필을 셸/페이지가 다시 /api/auth/me를 부르지 않고 공유한다.
export type V2Me = {
  crmUserId: string
  name: string
  roleType: string
  roleName: string
  isAdmin: boolean
}

const FALLBACK_ME: V2Me = { crmUserId: '', name: '', roleType: 'staff', roleName: '', isAdmin: false }

const V2SessionContext = createContext<V2Me | null>(null)

export function V2SessionProvider({ me, children }: { me: V2Me; children: React.ReactNode }) {
  return <V2SessionContext.Provider value={me}>{children}</V2SessionContext.Provider>
}

export function useV2Me(): V2Me {
  return useContext(V2SessionContext) || FALLBACK_ME
}

// 화면을 처음 그릴 때 곧바로 쓰려고 마지막으로 확인된 프로필을 메모리에만 들고 있는다(저장소에는 쓰지 않는다).
// 로그인 화면에서 들어올 때·로그아웃할 때·세션이 끊겼을 때 반드시 지운다.
let lastVerifiedMe: V2Me | null = null

export function getCachedV2Me(): V2Me | null {
  return lastVerifiedMe
}

export function setCachedV2Me(me: V2Me | null) {
  lastVerifiedMe = me
}

export function sameV2Me(a: V2Me | null, b: V2Me | null): boolean {
  if (!a || !b) return a === b
  return a.crmUserId === b.crmUserId && a.name === b.name && a.roleType === b.roleType && a.roleName === b.roleName && a.isAdmin === b.isAdmin
}
