// 서버 전용: 같은 기간의 영상 목록을 여러 분석 API 가 나눠 쓰게 하는 아주 짧은 메모 + 진행 중인 읽기 공유.
// 랭킹·종목·타이밍·담당자·대시보드는 모두 "기간 내 영상 행" 을 읽으므로, 한 번 읽은 결과를 재사용하면
// 화면을 옮겨 다니거나 새로고침해도 DB 를 반복해서 읽지 않는다. (프로세스 메모리 안에서만 유지되는 아주 작은 캐시)
//
// 안전 장치: 요청마다 값싼 "지문 확인"(영상 개수 + 가장 최근 수정·통계 갱신 시각, 쿼리 3개)을 먼저 하고,
// 지문이 달라졌으면(등록·삭제·수정·조회수 갱신) 메모를 버리고 새로 읽는다. 지문이 같아도 5초가 지나면 새로 읽는다.
// 그래서 영상을 방금 지웠는데 분석 화면에 남아 있는 일이 없다. (공용 등록 API 가 이 메모를 직접 비우지 못해도 안전)

import { RANKING_COLUMNS, type UserLite, type VideoRow } from '@/lib/v4/analytics'
import { ROWS_TTL_MS, dropOutdated, findCovering, makeSignature, ownerKeyOf, pruneEntries, sliceByCreatedAt, type MemoEntry } from '@/lib/v4/period-rows-core'
import { loadUsers, loadVideos, type V4Context } from '@/lib/v4/server'
import { V4_TABLES } from '@/lib/v4/tables'

type Admin = V4Context['supabaseAdmin']

// 모든 화면이 필요로 하는 컬럼의 합집합 (썸네일 주소처럼 화면에 안 쓰는 컬럼은 읽지 않는다)
const SHARED_ROW_COLUMNS = RANKING_COLUMNS

let memo: MemoEntry<Promise<VideoRow[]>>[] = []

// ---- 지문 확인: 같은 순간에 여러 API 가 함께 부르면 한 번만 묻는다 (1초 안의 결과는 함께 쓴다).
const PROBE_REUSE_MS = 1000
const probes = new Map<string, { at: number; value: Promise<string | null> }>()

async function runProbe(supabaseAdmin: Admin, ownerId: string | null): Promise<string | null> {
  try {
    let countQ = supabaseAdmin.from(V4_TABLES.videos).select('id', { count: 'exact', head: true })
    let updatedQ = supabaseAdmin.from(V4_TABLES.videos).select('updated_at').order('updated_at', { ascending: false }).limit(1)
    let syncedQ = supabaseAdmin.from(V4_TABLES.videos).select('last_synced_at').not('last_synced_at', 'is', null).order('last_synced_at', { ascending: false }).limit(1)
    if (ownerId) {
      countQ = countQ.eq('primary_owner_user_id', ownerId)
      updatedQ = updatedQ.eq('primary_owner_user_id', ownerId)
      syncedQ = syncedQ.eq('primary_owner_user_id', ownerId)
    }
    const [countRes, updatedRes, syncedRes] = await Promise.all([countQ, updatedQ, syncedQ])
    if (countRes.error || updatedRes.error || syncedRes.error) return null
    const updatedAt = (updatedRes.data?.[0] as { updated_at?: string } | undefined)?.updated_at
    const syncedAt = (syncedRes.data?.[0] as { last_synced_at?: string } | undefined)?.last_synced_at
    return makeSignature(countRes.count, updatedAt, syncedAt)
  } catch {
    return null
  }
}

function probeSignature(supabaseAdmin: Admin, ownerId: string | null, ownerKey: string, now: number) {
  const hit = probes.get(ownerKey)
  if (hit && now - hit.at <= PROBE_REUSE_MS) return hit.value
  const created = { at: now, value: runProbe(supabaseAdmin, ownerId) }
  probes.set(ownerKey, created)
  if (probes.size > 50) probes.delete(probes.keys().next().value as string)
  void created.value.then((sig) => {
    // 확인에 실패한 결과는 기억하지 않는다 (다음 요청이 다시 시도)
    if (sig === null && probes.get(ownerKey) === created) probes.delete(ownerKey)
  })
  return created.value
}

// startIso~endIso(created_at 기준) 의 영상. ownerId 가 없으면 전체(관리자), 있으면 그 직원 것만.
// 이미 더 넓은 기간을 읽어 둔 메모가 있으면 거기서 잘라 쓰므로 DB 를 다시 읽지 않는다. 돌려준 행 객체는 수정하지 말 것.
export async function loadPeriodRows(supabaseAdmin: Admin, options: { startIso: string; endIso: string; ownerId?: string | null }): Promise<VideoRow[]> {
  const startMs = Date.parse(options.startIso)
  const endMs = Date.parse(options.endIso)
  const ownerId = options.ownerId ?? null
  const ownerKey = ownerKeyOf(ownerId)

  // 읽기 "직전" 지문. (읽는 도중 바뀌면 다음 요청의 지문과 달라져 자동으로 다시 읽는다)
  const sig = await probeSignature(supabaseAdmin, ownerId, ownerKey, Date.now())
  // 지문을 못 구했으면(일시적인 DB 문제) 메모를 쓰지도 남기지도 않고 그대로 읽는다.
  if (sig === null) return loadVideos(supabaseAdmin, { startIso: options.startIso, endIso: options.endIso, ownerId, columns: SHARED_ROW_COLUMNS })

  const now = Date.now()
  memo = pruneEntries(dropOutdated(memo, ownerKey, sig), now)

  let entry = findCovering(memo, ownerKey, startMs, endMs, now, sig)
  if (!entry) {
    const created: MemoEntry<Promise<VideoRow[]>> = {
      ownerKey,
      startMs,
      endMs,
      sig,
      loadedAt: null,
      createdAt: now,
      value: loadVideos(supabaseAdmin, { startIso: options.startIso, endIso: options.endIso, ownerId, columns: SHARED_ROW_COLUMNS })
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

// 통계를 새로 받아온 직후(sync-stats)나 영상을 고친 직후에는 메모를 비운다. (다른 곳에서 바뀐 것은 위 지문 확인이 잡는다)
export function invalidatePeriodRows() {
  memo = []
  probes.clear()
  usersMemo = null
}

let usersMemo: { at: number; value: Promise<Awaited<ReturnType<typeof loadUsers>>> } | null = null

// 사용자 목록(이름 표시용)도 잠깐(5초) 함께 쓴다.
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
