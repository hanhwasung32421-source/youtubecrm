// 쓰던 내용(주소·종목·메모)을 이 탭에 잠깐 남겨 둔다. 로그인이 끊겨 로그인 화면에 다녀오거나,
// 실수로 새로고침해도 입력하던 것이 사라지지 않게 하려는 것. 탭을 닫으면 사라지고(sessionStorage),
// 6시간이 지난 것은 쓰지 않는다. 비밀번호 같은 민감한 값은 여기에 넣지 않는다.

export type Draft = { url: string; stock: string; memo: string; at: number }

export const DRAFT_KEY = 'v3.register.draft'
export const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000

const asText = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')

// 저장돼 있던 글자를 안전하게 읽는다. (순수 함수)
export function parseDraft(raw: string | null | undefined, now: number): Draft | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const at = typeof obj.at === 'number' ? obj.at : NaN
  if (!Number.isFinite(at) || now - at > DRAFT_MAX_AGE_MS || at > now + 60_000) return null
  const draft: Draft = { url: asText(obj.url, 500), stock: asText(obj.stock, 60), memo: asText(obj.memo, 100), at }
  return draft.url || draft.stock || draft.memo ? draft : null
}

export function readDraft(now: number = Date.now()): Draft | null {
  try {
    return parseDraft(window.sessionStorage.getItem(DRAFT_KEY), now)
  } catch {
    return null
  }
}

export function writeDraft(input: { url: string; stock: string; memo: string }, now: number = Date.now()) {
  try {
    if (!input.url && !input.stock && !input.memo) {
      window.sessionStorage.removeItem(DRAFT_KEY)
      return
    }
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...input, at: now }))
  } catch {
    // 저장이 안 돼도 등록 자체에는 영향이 없다.
  }
}
