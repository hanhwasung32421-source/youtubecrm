// 등록/수정/삭제가 실패했을 때 보여 줄 문구를 정하는 순수 도우미(다른 파일을 가져오지 않는다).
// 모든 문구는 "무슨 일이 생겼는지 + 이제 무엇을 하면 되는지"를 한 문장 안에 담는다.

export type RegisterErrorKind =
  | 'network' // 인터넷이 끊김
  | 'auth' // 로그인이 풀림
  | 'invalid-url' // 영상 주소가 아님(재생목록·채널 등)
  | 'not-found' // 유튜브에서 영상을 못 찾음(삭제·비공개)
  | 'quota' // 유튜브 조회 한도
  | 'inactive' // 유튜브 연결(API)이 꺼져 있음
  | 'forbidden' // 권한 없음
  | 'server' // 서버 내부 문제
  | 'unknown'

export type RegisterErrorInfo = {
  kind: RegisterErrorKind
  message: string
  // true 면 화면에 "다시 시도" 버튼을 보여 준다(입력한 값은 그대로 둔다).
  retry: boolean
}

const HANGUL = /[가-힣]/

export const ERROR_COPY = {
  network: '인터넷 연결이 끊긴 것 같아요. 입력한 내용은 그대로 두었으니, 연결을 확인하고 다시 시도해 주세요.',
  auth: '로그인이 풀렸어요. 입력한 내용은 저장해 두었으니, 다시 로그인하면 이어서 등록할 수 있어요.',
  invalidUrl: '영상 주소가 아니에요. 재생목록·채널이 아니라 영상 하나를 열고 그 주소를 붙여 넣어 주세요.',
  notFound: '유튜브에서 이 영상을 찾지 못했어요. 삭제됐거나 비공개일 수 있으니 영상이 공개 상태인지 확인해 주세요.',
  quota: '유튜브 조회 한도에 걸린 것 같아요. 5~10분 뒤에 다시 시도하고, 계속되면 관리자에게 알려 주세요.',
  inactive: '유튜브 연결이 아직 꺼져 있어요. 관리자에게 "유튜브 API 켜기"를 요청해 주세요.',
  forbidden: '이 작업을 할 권한이 없어요. 본인이 등록한 영상인지 확인하고, 계속되면 관리자에게 문의해 주세요.',
  server: '서버에서 저장하지 못했어요. 입력한 내용은 그대로이니 잠시 뒤 다시 시도해 주세요.',
  serverWithVideoOk: '영상은 확인됐는데 정보를 가져오지 못했어요. 유튜브 조회 한도일 수 있으니 5~10분 뒤 다시 시도해 주세요.',
  unknown: '알 수 없는 문제가 생겼어요. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요.'
} as const

function isNetworkFailure(input: unknown) {
  if (input instanceof TypeError) return true
  return input instanceof Error && /failed to fetch|network|load failed/i.test(input.message)
}

// 서버/네트워크 오류 → { 종류, 한 문장, 다시 시도 버튼 여부 }.
// input: 던져진 오류 또는 서버가 준 error 문자열, status: HTTP 상태(없으면 undefined).
export function classifyError(input: unknown, status?: number): RegisterErrorInfo {
  if (isNetworkFailure(input)) return { kind: 'network', message: ERROR_COPY.network, retry: true }

  const message = typeof input === 'string' ? input : input instanceof Error ? input.message : ''

  if (status === 401 || /로그인이 필요|프로필을 찾을 수 없|unauthorized|jwt/i.test(message)) {
    return { kind: 'auth', message: ERROR_COPY.auth, retry: false }
  }
  // 우리 서버가 한국어로 알려 주는 "영상 없음/권한 없음"(내 영상 수정·삭제)은 그대로 쓴다.
  if ((status === 403 || status === 404) && HANGUL.test(message)) {
    return { kind: status === 403 ? 'forbidden' : 'not-found', message: message.replace(/\s*\(.*\)\s*$/, ''), retry: false }
  }
  if (/이미 등록/.test(message)) {
    return { kind: 'unknown', message: '이미 등록된 영상이에요. 종목만 고치려면 아래 목록에서 "수정"을 눌러 주세요.', retry: false }
  }
  if (/API가 비활성|채널 ID/.test(message)) return { kind: 'inactive', message: ERROR_COPY.inactive, retry: false }
  if (/quota|rate.?limit|한도|api\s*key|api 키|apikey/i.test(message)) return { kind: 'quota', message: ERROR_COPY.quota, retry: true }
  if (/유효한 유튜브|유효하지 않은 주소|invalid.{0,12}url/i.test(message)) {
    return { kind: 'invalid-url', message: ERROR_COPY.invalidUrl, retry: false }
  }
  if (/메타데이터를 찾을 수 없|not found/i.test(message) && !(status === 404)) {
    return { kind: 'not-found', message: ERROR_COPY.notFound, retry: false }
  }
  if (status === 403) return { kind: 'forbidden', message: ERROR_COPY.forbidden, retry: false }
  if (status !== undefined && status >= 500) return { kind: 'server', message: ERROR_COPY.server, retry: true }

  // 서버가 한글로 준 짧은 안내(예: "종목명을 적어 주세요.")는 그대로 쓴다. 개발 환경의 원본 오류 꼬리표는 잘라낸다.
  const korean = message.replace(/\s*\(.*\)\s*$/, '').trim()
  if (korean && HANGUL.test(korean) && korean.length <= 80) return { kind: 'unknown', message: korean, retry: false }
  return { kind: 'unknown', message: ERROR_COPY.unknown, retry: true }
}

// 운영 서버는 "영상 저장 실패" 한 마디만 주기 때문에 원인을 알 수 없다.
// 그래서 실패 직후 (1) 로그인 확인 (2) 유튜브에 영상이 있는지 를 가볍게 물어 보고 문구를 더 정확하게 바꾼다.
// probe: 로그인 확인 호출의 HTTP 상태(0 = 네트워크 실패, null = 확인 못 함)
// oembed: 유튜브 oEmbed 응답 상태(0 = 막힘/시간 초과, null = 확인 안 함)
export function refineServerFailure(
  base: RegisterErrorInfo,
  probe: { status: number | null },
  oembed: { status: number | null }
): RegisterErrorInfo {
  if (base.kind !== 'server') return base
  if (probe.status === 401) return { kind: 'auth', message: ERROR_COPY.auth, retry: false }
  if (probe.status === 0) return { kind: 'network', message: ERROR_COPY.network, retry: true }
  if (oembed.status === 404 || oembed.status === 400) return { kind: 'not-found', message: ERROR_COPY.notFound, retry: false }
  if (oembed.status === 200 || oembed.status === 401 || oembed.status === 403) {
    // 영상은 있다(401/403 = 퍼가기만 막아 둔 영상). 그러면 유튜브 조회 한도나 일시 오류 쪽이다.
    return { kind: 'quota', message: ERROR_COPY.serverWithVideoOk, retry: true }
  }
  return base
}

// 예전 이름 호환: 문구만 필요한 곳(수정/삭제/여러 개 등록)에서 쓴다.
export function friendlyError(input: unknown, status?: number): string {
  return classifyError(input, status).message
}
