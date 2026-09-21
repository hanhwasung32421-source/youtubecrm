// 서버 전용: V4 API 응답 헤더 도우미.
// - 분석 GET 도 브라우저(HTTP 캐시)에는 저장하지 않는다. 옛 값을 잠깐 보여주는 일은 화면 쪽 요청 캐시(fetch-cache, 5초 기준)가 맡는다.
//   (브라우저가 따로 15~60초 저장해 두면, 영상을 지운 직후에도 옛 순위·개수가 보이고 "다시 불러오기"도 옛 값을 받아 온다.)
// - 저장/삭제 같은 변경 응답과 오류도 절대 저장하지 않는다.

import { NextResponse } from 'next/server'

export const NO_STORE = 'no-store'

// 로그인 토큰이 다르면(=다른 사용자면) 캐시를 공유하지 않도록 Vary 를 함께 내려준다.
export function cachedJson(body: unknown) {
  return NextResponse.json(body, { headers: { 'Cache-Control': `private, ${NO_STORE}`, Vary: 'Authorization' } })
}

export function noStoreJson(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { status: init.status, headers: { 'Cache-Control': NO_STORE } })
}
