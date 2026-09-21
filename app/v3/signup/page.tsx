'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v3/menu'
import { PasswordField } from '@/components/v3/password-field'
import { LAST_LOGIN_ID_KEY, writeSafe } from '@/components/v3/safe-storage'

type FieldKey = 'email' | 'loginId' | 'password' | 'name' | 'birthDate' | 'phone' | 'antiBotCode'
type FieldErrors = Partial<Record<FieldKey, string>>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 오류가 났을 때 커서를 보낼 칸(위에서부터 순서대로)
const FIELD_ORDER: FieldKey[] = ['email', 'loginId', 'password', 'name', 'birthDate', 'phone', 'antiBotCode']

export default function SignupPage() {
  const router = useRouter()
  const [loginId, setLoginId] = useState('')
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [phoneMid, setPhoneMid] = useState('')
  const [phoneLast, setPhoneLast] = useState('')
  const [password, setPassword] = useState('')

  const [email, setEmail] = useState('')
  const [emailChecked, setEmailChecked] = useState(false)
  const [emailCheckedValue, setEmailCheckedValue] = useState('')

  const [challengeCode, setChallengeCode] = useState('----')
  const [antiBotCode, setAntiBotCode] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const busy = useRef(false) // Enter와 클릭이 겹쳐도 한 번만 요청

  const refs = useRef<Partial<Record<FieldKey | 'phoneLast', HTMLInputElement | null>>>({})
  const setRef = (key: FieldKey | 'phoneLast') => (el: HTMLInputElement | null) => {
    refs.current[key] = el
  }
  const focusField = (key: FieldKey | 'phoneLast') => window.setTimeout(() => refs.current[key]?.focus(), 0)

  const emailVerified = emailChecked && emailCheckedValue === email.trim()

  const setFieldError = (key: FieldKey, text: string) => setFieldErrors((prev) => ({ ...prev, [key]: text }))
  const clearFieldError = (key: FieldKey) =>
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  const refresh = async () => {
    setAntiBotCode('')
    clearFieldError('antiBotCode')
    try {
      const res = await fetch('/api/auth/challenge')
      const data = (await res.json()) as { code?: string }
      if (!res.ok || !data.code) throw new Error('challenge')
      setChallengeCode(data.code)
    } catch {
      setChallengeCode('----')
      setError('자동가입방지 숫자를 불러오지 못했어요. “새로 만들기”를 눌러 주세요.')
    }
  }

  useEffect(() => {
    void refresh()
    refs.current.email?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkEmailDuplicate = async () => {
    setError('')
    setMessage('')
    clearFieldError('email')

    const value = email.trim()
    if (!value) {
      setFieldError('email', '이메일을 입력해 주세요.')
      focusField('email')
      return
    }
    if (!EMAIL_PATTERN.test(value)) {
      setFieldError('email', '이메일 주소 형식이 맞지 않아요. (예: name@example.com)')
      focusField('email')
      return
    }

    if (busy.current) return
    busy.current = true
    setLoading(true)
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value })
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setFieldError('email', /[가-힣]/.test(data?.error || '') ? data.error : '이메일 중복확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
        return
      }

      if (data.exists) {
        setEmailChecked(false)
        setEmailCheckedValue('')
        setFieldError('email', '이미 가입된 이메일이에요. 아래 “로그인하기”를 눌러 주세요.')
        return
      }

      setEmailChecked(true)
      setEmailCheckedValue(value)
      focusField('loginId')
    } catch {
      setFieldError('email', '인터넷 연결을 확인해 주세요.')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {}
    const id = loginId.trim()
    if (id.length < 2 || id.length > 30) errors.loginId = '아이디는 2~30자로 입력해 주세요.'
    if (password.length < 6) errors.password = '비밀번호는 6자 이상이어야 해요.'
    if (!name.trim()) errors.name = '이름을 입력해 주세요.'
    else if (name.trim().length > 50) errors.name = '이름은 50자 이내로 입력해 주세요.'
    if (!/^\d{8}$/.test(birthDate)) errors.birthDate = '생년월일 숫자 8자리를 입력해 주세요. (예: 19950710)'
    if (!/^\d{4}$/.test(phoneMid) || !/^\d{4}$/.test(phoneLast)) errors.phone = '전화번호 뒤 8자리를 4자리씩 입력해 주세요.'
    if (!/^\d{4}$/.test(antiBotCode)) errors.antiBotCode = '옆에 보이는 4자리 숫자를 입력해 주세요.'
    return errors
  }

  // 서버가 돌려준 문구를 알맞은 칸 아래에 붙인다. 어느 칸인지 모르면 맨 아래에 보여 준다.
  const showServerError = (text: string) => {
    if (/이메일/.test(text)) setFieldError('email', text)
    else if (/아이디/.test(text)) setFieldError('loginId', text)
    else if (/자동가입방지/.test(text)) setFieldError('antiBotCode', text)
    else setError(text)
  }

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (loading || busy.current) return
    setError('')
    setMessage('')

    // 이메일 확인 전이라면 Enter 키가 "중복확인"으로 이어지게 한다.
    if (!emailVerified) {
      await checkEmailDuplicate()
      return
    }

    const errors = validate()
    setFieldErrors(errors)
    const firstInvalid = FIELD_ORDER.find((key) => errors[key])
    if (firstInvalid) {
      focusField(firstInvalid === 'phone' ? (/^\d{4}$/.test(phoneMid) ? 'phoneLast' : 'phone') : firstInvalid)
      return
    }

    busy.current = true
    setLoading(true)
    let leaving = false // 가입이 끝나 화면이 넘어가는 중이면 버튼을 다시 열지 않는다(중복 가입 방지)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          loginId: loginId.trim(),
          name: name.trim(),
          birthDate: birthDate.trim(),
          phoneMid,
          phoneLast,
          password,
          antiBotCode
        })
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showServerError(/[가-힣]/.test(data?.error || '') ? data.error : '가입하지 못했어요. 입력한 내용을 확인해 주세요.')
        await refresh()
        return
      }

      // 다음에 로그인할 때 아이디가 미리 채워지도록 기억해 둔다(비밀번호는 저장하지 않는다).
      writeSafe(LAST_LOGIN_ID_KEY, loginId.trim())

      const supabase = createSupabaseBrowserClient()
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      })

      if (signInError || !signInData.session?.access_token) {
        setMessage('가입이 끝났어요. 로그인 화면으로 이동할게요.')
        leaving = true
        setTimeout(() => {
          router.push('/v3/login')
        }, 1000)
        return
      }

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${signInData.session.access_token}` }
      })

      let me: { roleType: string }
      try {
        me = await fetchMe(signInData.session.access_token)
      } catch {
        setMessage('가입이 끝났어요. 자동으로 로그인했지만 화면을 옮기지 못했어요. 아래 “로그인하기”를 눌러 주세요.')
        return
      }

      setMessage('가입이 끝났어요. 자동으로 로그인하고 있어요.')
      leaving = true
      router.push(getHomeHref(me.roleType))
    } catch {
      setError('인터넷 연결을 확인하고 다시 시도해 주세요.')
      await refresh()
    } finally {
      if (!leaving) {
        busy.current = false
        setLoading(false)
      }
    }
  }

  return (
    <div className="auth-wrap v3-auth">
      <div className="auth-shell">
        <div className="panel soft">
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <div className="panel-title">회원가입</div>
          <p className="panel-subtitle">이메일을 먼저 확인한 뒤 정보를 입력하면, 가입하는 즉시 로그인돼요.</p>
        </div>

        <form className="panel form-stack" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="v3-su-email">이메일</label>
            <div className="row">
              <input
                id="v3-su-email"
                ref={setRef('email')}
                className={`input ${fieldErrors.email ? 'invalid' : ''}`}
                type="email"
                value={email}
                autoFocus
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="name@example.com"
                aria-invalid={!!fieldErrors.email}
                aria-describedby="v3-su-email-msg"
                readOnly={loading}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearFieldError('email')
                }}
                onBlur={() => {
                  if (emailCheckedValue !== email.trim()) setEmailChecked(false)
                }}
              />
              <button className="button secondary nowrap" type="button" disabled={loading} onClick={() => void checkEmailDuplicate()}>
                {loading && !emailVerified ? '확인 중...' : '중복확인'}
              </button>
            </div>
            <div id="v3-su-email-msg" aria-live="polite">
              {fieldErrors.email ? (
                <div className="v3-field-error" role="alert">{fieldErrors.email}</div>
              ) : emailVerified ? (
                <div className="v3-field-ok">사용할 수 있는 이메일이에요.</div>
              ) : (
                <div className="v3-field-help">이미 가입된 이메일인지 먼저 확인해요. 입력 후 Enter를 눌러도 됩니다.</div>
              )}
            </div>
          </div>

          {emailChecked ? (
            <>
              <div className="field">
                <label className="label" htmlFor="v3-su-id">아이디</label>
                <input
                  id="v3-su-id"
                  ref={setRef('loginId')}
                  className={`input ${fieldErrors.loginId ? 'invalid' : ''}`}
                  value={loginId}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={!!fieldErrors.loginId}
                  aria-describedby="v3-su-id-msg"
                  readOnly={loading}
                  onChange={(e) => {
                    setLoginId(e.target.value)
                    clearFieldError('loginId')
                  }}
                />
                <div id="v3-su-id-msg">
                  {fieldErrors.loginId ? (
                    <div className="v3-field-error" role="alert">{fieldErrors.loginId}</div>
                  ) : (
                    <div className="v3-field-help">로그인할 때 이메일 대신 쓸 수 있어요. 2~30자.</div>
                  )}
                </div>
              </div>

              <PasswordField
                id="v3-su-pw"
                label="비밀번호"
                value={password}
                autoComplete="new-password"
                readOnly={loading}
                invalid={!!fieldErrors.password}
                describedBy="v3-su-pw-msg"
                inputRef={setRef('password')}
                onChange={(next) => {
                  setPassword(next)
                  clearFieldError('password')
                }}
              >
                <div id="v3-su-pw-msg">
                  {fieldErrors.password ? <div className="v3-field-error" role="alert">{fieldErrors.password}</div> : <div className="v3-field-help">6자 이상으로 정해 주세요.</div>}
                </div>
              </PasswordField>

              <div className="field">
                <label className="label" htmlFor="v3-su-name">이름</label>
                <input
                  id="v3-su-name"
                  ref={setRef('name')}
                  className={`input ${fieldErrors.name ? 'invalid' : ''}`}
                  value={name}
                  autoComplete="name"
                  aria-invalid={!!fieldErrors.name}
                  readOnly={loading}
                  onChange={(e) => {
                    setName(e.target.value)
                    clearFieldError('name')
                  }}
                />
                {fieldErrors.name ? <div className="v3-field-error" role="alert">{fieldErrors.name}</div> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v3-su-birth">생년월일</label>
                <input
                  id="v3-su-birth"
                  ref={setRef('birthDate')}
                  className={`input ${fieldErrors.birthDate ? 'invalid' : ''}`}
                  value={birthDate}
                  placeholder="19950710"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={!!fieldErrors.birthDate}
                  readOnly={loading}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '').slice(0, 8)
                    setBirthDate(next)
                    clearFieldError('birthDate')
                    if (next.length === 8) focusField('phone')
                  }}
                />
                {fieldErrors.birthDate ? <div className="v3-field-error" role="alert">{fieldErrors.birthDate}</div> : <div className="v3-field-help">숫자 8자리로 붙여서 적어 주세요.</div>}
              </div>

              <div className="field">
                <label className="label" htmlFor="v3-su-phone-mid">전화번호</label>
                <div className="row">
                  <input className="input" style={{ maxWidth: 90, textAlign: 'center' }} value="010" disabled aria-label="전화번호 앞 3자리" />
                  <span className="muted">-</span>
                  <input
                    id="v3-su-phone-mid"
                    ref={setRef('phone')}
                    className={`input ${fieldErrors.phone ? 'invalid' : ''}`}
                    style={{ maxWidth: 120, textAlign: 'center' }}
                    value={phoneMid}
                    maxLength={4}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label="전화번호 가운데 4자리"
                    aria-invalid={!!fieldErrors.phone}
                    readOnly={loading}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneMid(next)
                      clearFieldError('phone')
                      if (next.length === 4) focusField('phoneLast')
                    }}
                  />
                  <span className="muted">-</span>
                  <input
                    ref={setRef('phoneLast')}
                    className={`input ${fieldErrors.phone ? 'invalid' : ''}`}
                    style={{ maxWidth: 120, textAlign: 'center' }}
                    value={phoneLast}
                    maxLength={4}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label="전화번호 끝 4자리"
                    aria-invalid={!!fieldErrors.phone}
                    readOnly={loading}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneLast(next)
                      clearFieldError('phone')
                      if (next.length === 4) focusField('antiBotCode')
                    }}
                  />
                </div>
                {fieldErrors.phone ? <div className="v3-field-error" role="alert">{fieldErrors.phone}</div> : <div className="v3-field-help">010은 이미 들어 있어요. 뒤 8자리만 적어 주세요.</div>}
              </div>

              <div className="panel soft">
                <div className="row-between">
                  <label className="label" htmlFor="v3-su-bot">자동가입방지</label>
                  <button className="button secondary" type="button" disabled={loading} onClick={() => void refresh()}>
                    새로 만들기
                  </button>
                </div>
                <div className="row-between" style={{ marginTop: 12 }}>
                  <div className="card-value" aria-label={`보이는 숫자 ${challengeCode}`}>{challengeCode}</div>
                  <input
                    id="v3-su-bot"
                    ref={setRef('antiBotCode')}
                    className={`input ${fieldErrors.antiBotCode ? 'invalid' : ''}`}
                    style={{ maxWidth: 140, textAlign: 'center' }}
                    value={antiBotCode}
                    maxLength={4}
                    autoComplete="off"
                    onChange={(e) => {
                      setAntiBotCode(e.target.value.replace(/[^\d]/g, '').slice(0, 4))
                      clearFieldError('antiBotCode')
                    }}
                    placeholder="4자리"
                    inputMode="numeric"
                    aria-invalid={!!fieldErrors.antiBotCode}
                    readOnly={loading}
                  />
                </div>
                {fieldErrors.antiBotCode ? (
                  <div className="v3-field-error" role="alert" style={{ marginTop: 8 }}>{fieldErrors.antiBotCode}</div>
                ) : (
                  <div className="v3-field-help" style={{ marginTop: 8 }}>왼쪽에 보이는 숫자 4개를 오른쪽 칸에 그대로 입력해 주세요.</div>
                )}
              </div>

              <button className="button v3-submit" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <span className="v3-spinner" aria-hidden /> 처리 중…
                  </>
                ) : (
                  '가입하기'
                )}
              </button>
            </>
          ) : null}

          <div role="alert">{error ? <div className="message-error small">{error}</div> : null}</div>
          <div role="status" aria-live="polite">
            {message && !error ? <div className="message-success small">{message}</div> : null}
          </div>
          <div className="small muted">
            이미 계정이 있나요? <Link className="link" href="/v3/login">로그인하기</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
