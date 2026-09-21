// 서버 전용: V4 API 응답 헤더 도우미.
// - 읽기 전용 분석 GET: 브라우저가 15초는 그대로 쓰고, 그 뒤 45초는 옛 값을 보여주면서 뒤에서 새로 받는다.
// - 저장/삭제 같은 변경 응답과 오류는 절대 저장(캐시)하지 않는다.

import { NextResponse } from 'next/server'

export const ANALYTICS_CACHE_CONTROL = 'private, max-age=15, stale-while-revalidate=45'
export const NO_STORE = 'no-store'

// 로그인 토큰이 다르면(=다른 사용자면) 캐시를 공유하지 않도록 Vary 를 함께 내려준다.
export function cachedJson(body: unknown, cacheControl: string = ANALYTICS_CACHE_CONTROL) {
  return NextResponse.json(body, { headers: { 'Cache-Control': cacheControl, Vary: 'Authorization' } })
}

export function noStoreJson(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { status: init.status, headers: { 'Cache-Control': NO_STORE } })
}
