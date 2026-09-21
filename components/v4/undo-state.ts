// "방금 등록한 영상 — 되돌리기" 상태 기계 (순수 함수, React 의존 없음).
//
//   registered ─▶ open ──tick(시간 지남)──▶ expired
//                  │
//                  ├─begin─▶ working ─succeeded─▶ done
//                  │            └───failed────▶ open (다시 10초)
//                  └─dismiss─▶ idle
//
// - "방금 등록한 영상" 정보(recent)는 되돌리기 시간이 지나도 남는다 (종목 바로 고치기는 계속 쓸 수 있다).
// - 등록을 또 하면 새 영상으로 바뀐다. 이전 영상에 대한 늦은 응답(succeeded/failed)은 무시한다.

export const UNDO_WINDOW_MS = 10_000

// delete : 새로 등록한 영상 → 되돌리기 = 지우기
// restore: 이미 있던 영상의 종목만 바꿨다 → 되돌리기 = 이전 종목으로 복원
export type UndoMode = 'delete' | 'restore'

export type Recent = {
  id: string | null // null 이면 서버가 ID 를 주지 않은 경우 → 되돌리기·고치기 없음
  mode: UndoMode
  stock: string
  title: string
  url: string
  ordinal: number | null
  prevStock: string | null // restore 일 때 이전 종목
}

export type UndoState =
  | { phase: 'idle'; recent: null; expiresAt: 0; error: '' }
  | { phase: 'open' | 'working' | 'expired'; recent: Recent; expiresAt: number; error: string }

export const UNDO_IDLE: UndoState = { phase: 'idle', recent: null, expiresAt: 0, error: '' }

export type UndoAction =
  | { type: 'registered'; recent: Recent; now: number }
  | { type: 'tick'; now: number }
  | { type: 'begin'; id: string; now: number }
  | { type: 'succeeded'; id: string }
  | { type: 'failed'; id: string; message: string; now: number }
  | { type: 'edited'; id: string; stock: string }
  | { type: 'dismiss' }

export function undoReducer(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
    case 'registered': {
      const canUndo = Boolean(action.recent.id)
      return { phase: canUndo ? 'open' : 'expired', recent: action.recent, expiresAt: action.now + UNDO_WINDOW_MS, error: '' }
    }
    case 'tick':
      if (state.phase === 'open' && action.now >= state.expiresAt) return { ...state, phase: 'expired' }
      return state
    case 'begin':
      // 시간이 지났거나 다른 영상이면 시작하지 않는다.
      if (state.phase !== 'open' || state.recent.id !== action.id || action.now >= state.expiresAt) return state
      return { ...state, phase: 'working', error: '' }
    case 'succeeded':
      if (state.phase !== 'working' || state.recent.id !== action.id) return state
      return UNDO_IDLE
    case 'failed':
      if (state.phase !== 'working' || state.recent.id !== action.id) return state
      // 실패하면 다시 시도할 수 있게 시간을 새로 준다.
      return { ...state, phase: 'open', expiresAt: action.now + UNDO_WINDOW_MS, error: action.message }
    case 'edited':
      if (state.phase === 'idle' || state.recent.id !== action.id) return state
      return { ...state, recent: { ...state.recent, stock: action.stock } }
    case 'dismiss':
      return UNDO_IDLE
    default:
      return state
  }
}

// 남은 초 (화면에 "되돌리기 · 8초"로 보인다). 열려 있지 않으면 0.
export function secondsLeft(state: UndoState, now: number): number {
  if (state.phase !== 'open' && state.phase !== 'working') return 0
  return Math.max(0, Math.ceil((state.expiresAt - now) / 1000))
}

// ---------------------------------------------------------------- 지워도 안전한지

// 방금 "새로 등록"한 영상만 지운다. 공유 등록 API 는 이미 있던 영상도 같은 주소면 덮어쓰기(upsert) 하므로,
// 예전에 등록해 둔 영상(등록한 지 오래됨) 또는 목록에서 못 찾은 영상은 되돌리기로 지우지 않는다.
export const FRESH_WINDOW_MS = 10 * 60 * 1000

export type DeleteSafety = { safe: true } | { safe: false; reason: 'not-found' | 'old' }

export function deleteSafety(item: { created_at: string | null } | null | undefined, now: number): DeleteSafety {
  if (!item) return { safe: false, reason: 'not-found' }
  const t = item.created_at ? new Date(item.created_at).getTime() : NaN
  if (Number.isNaN(t)) return { safe: false, reason: 'old' }
  return now - t > FRESH_WINDOW_MS ? { safe: false, reason: 'old' } : { safe: true }
}
