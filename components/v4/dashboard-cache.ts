// 성장 현황 응답을 60초 동안 기억한다 (기간을 7/30/90일로 오갈 때 바로 보이게).
// 키는 "사용자:기간" — 다른 계정으로 로그인해도 남의 값이 보이지 않는다.
import { createSwrCache } from '@/components/v4/swr-cache'

export const DASHBOARD_TTL_MS = 60_000

// 값의 모양은 dashboard/page.tsx 의 DashboardResponse. 캐시는 모양을 몰라도 된다.
export const dashboardCache = createSwrCache<any>(DASHBOARD_TTL_MS, 12)

export function dashboardKey(userId: string, days: number) {
  return `${userId}:${days}`
}

export function clearDashboardCache(userId?: string) {
  dashboardCache.clear(userId ? `${userId}:` : undefined)
}
