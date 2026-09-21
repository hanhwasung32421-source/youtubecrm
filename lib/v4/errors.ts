// V4 오류 메시지 매핑 (서버/클라이언트 공용, React 의존 없음).
// 원칙: 사용자에게는 짧은 한국어 한 문장만. Postgres/JSON 원문은 절대 그대로 보여주지 않는다.

export const NETWORK_ERROR_MESSAGE = '인터넷 연결을 확인하고 다시 시도해 주세요.'
export const LOGIN_REQUIRED_MESSAGE = '로그인이 만료됐어요. 다시 로그인해 주세요.'

type DbErrorLike = { code?: string; message?: string; details?: string }

// Postgres / PostgREST 오류 → { 한국어 문장, HTTP 상태 }
export function mapDbError(error: unknown): { message: string; status: number } {
  const err = (error && typeof error === 'object' ? error : {}) as DbErrorLike
  const code = String(err.code || '')
  const raw = String(err.message || (error instanceof Error ? error.message : ''))

  if (code === '23505') return { message: '같은 내용이 이미 저장돼 있어요. 화면을 새로 열어 확인해 주세요.', status: 409 }
  if (code === '23503') return { message: '연결하려는 항목을 찾을 수 없어요. 이미 삭제됐을 수 있어요.', status: 400 }
  if (code === '23502') return { message: '꼭 필요한 항목이 비어 있어요.', status: 400 }
  if (code === '23514') return { message: '입력한 값이 허용 범위를 벗어났어요.', status: 400 }
  if (code.startsWith('22')) return { message: '입력한 값의 형식을 확인해 주세요.', status: 400 }
  if (code === '42501') return { message: '이 작업을 할 권한이 없어요.', status: 403 }
  if (code === '57014') return { message: '데이터가 많아 시간이 걸렸어요. 잠시 후 다시 시도해 주세요.', status: 503 }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(raw)) {
    return { message: '서버가 데이터에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', status: 503 }
  }
  return { message: '', status: 500 }
}

// zod 첫 오류 메시지 (한글이 아니면 = 라이브러리 기본 영문 메시지면 일반 문장으로 바꾼다)
export function firstIssueMessage(error: { issues?: Array<{ message?: string }> } | undefined, fallback = '입력한 내용을 다시 확인해 주세요.') {
  const message = error?.issues?.[0]?.message || ''
  return /[가-힣]/.test(message) ? message : fallback
}

// 화면에 그대로 보여도 되는 문장인지 (원문 JSON/SQL/영문 오류가 섞였는지) 판별한다.
export function isSafeMessage(message: unknown): message is string {
  if (typeof message !== 'string') return false
  const text = message.trim()
  if (!text || text.length > 200) return false
  if (!/[가-힣]/.test(text)) return false
  return !/violates|constraint|relation "|PGRST|syntax error|\bJSON\b|column |Unexpected token|\{"/i.test(text)
}

// 서버가 준 오류 문장(있으면) + HTTP 상태 → 화면용 한 문장
export function friendlyMessage(status: number, serverMessage: unknown, fallback: string) {
  if (status === 401) return LOGIN_REQUIRED_MESSAGE
  if (status === 403 && !isSafeMessage(serverMessage)) return '이 작업을 할 권한이 없어요.'
  if (status === 404 && !isSafeMessage(serverMessage)) return '찾는 항목이 없어요. 이미 삭제됐을 수 있어요.'
  if (isSafeMessage(serverMessage)) return serverMessage.trim()
  return fallback
}
