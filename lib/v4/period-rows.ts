// 서버 전용: 같은 기간의 영상 목록을 여러 분석 API 가 나눠 쓰게 하는 15초 메모 + 진행 중인 읽기 공유.
// 랭킹·종목·타이밍·담당자·대시보드는 모두 "기간 내 영상 행" 을 읽으므로, 한 번 읽은 결과를 재사용하면
// 화면을 옮겨 다니거나 새로고침해도 DB 를 반복해서 읽지 않는다. (프로세스 메모리 안에서만 유지되는 아주 작은 캐시)

import { RANKING_COLUMNS, type UserLite, type VideoRow } from '@/lib/v4/analytics'
import { ROWS_TTL_MS, findCovering, ownerKeyOf, pruneEntries, sliceByCreatedAt, type MemoEntry } from '@/lib/v4/period-rows-core'
import { loadUsers, loadVideos, type V4Context } from '@/lib/v4/server'

type Admin = V4Context['supabaseAdmin']

// 모든 화면이 필요로 하는 컬럼의 합집합 (썸네일 주소처럼 화면에 안 쓰는 컬럼은 읽지 않는다)
export const SHARED_ROW_COLUMNS = RANKING_COLUMNS

let memo: MemoEntry<Promise<VideoRow[]>>[] = []

// startIso~endIso(created_at 기준) 의 영상. ownerId 가 없으면 전체(관리자), 있으면 그 직원 것만.
// 이미 더 넓은 기간을 읽어 둔 메모가 있으면 거기서 잘라 쓰므로 DB 를 다시 읽지 않는다. 돌려준 행 객체는 수정하지 말 것.
export async function loadPeriodRows(supabaseAdmin: Admin, options: { startIso: string; endIso: string; ownerId?: string | null }): Promise<VideoRow[]> {
  const now = Date.now()
  const startMs = Date.parse(options.startIso)
  const endMs = Date.parse(options.endIso)
  const ownerKey = ownerKeyOf(options.ownerId)
  memo = pruneEntries(memo, now)

  let entry = findCovering(memo, ownerKey, startMs, endMs, now)
  if (!entry) {
    const created: MemoEntry<Promise<VideoRow[]>> = {
      ownerKey,
      startMs,
      endMs,
      loadedAt: null,
      createdAt: now,
      value: loadVideos(supabaseAdmin, { startIso: options.startIso, endIso: options.endIso, ownerId: options.ownerId ?? null, columns: SHARED_ROW_COLUMNS })
    }
    created.value.then(
      () => {
        created.loadedAt = Date.now()
      },
      () => {
        // 실패한 읽기는 기억하지 않는다 (다음 요청이 다시 시도)
        memo = memo.filter((e) => e !== created)
      }
    )
    memo = [...memo, created]
    entry = created
  }
  const rows = await entry.value
  if (entry.startMs === startMs && entry.endMs === endMs) return rows
  return sliceByCreatedAt(rows, startMs, endMs)
}

// 통계를 새로 받아온 직후(sync-stats)에는 메모를 비워 새 조회수가 바로 보이게 한다.
export function invalidatePeriodRows() {
  memo = []
  usersMemo = null
}

let usersMemo: { at: number; value: Promise<Awaited<ReturnType<typeof loadUsers>>> } | null = null

// 사용자 목록(이름 표시용)도 15초 동안 함께 쓴다.
export async function loadUsersShared(supabaseAdmin: Admin) {
  const now = Date.now()
  if (!usersMemo || now - usersMemo.at > ROWS_TTL_MS) {
    const created = { at: now, value: loadUsers(supabaseAdmin) }
    created.value.catch(() => {
      if (usersMemo === created) usersMemo = null
    })
    usersMemo = created
  }
  return usersMemo.value
}

export type { UserLite }
