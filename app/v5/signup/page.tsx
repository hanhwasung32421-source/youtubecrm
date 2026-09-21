'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v5/menu'
import { PasswordField } from '@/components/v5/password-field'

type Field = 'email' | 'loginId' | 'password' | 'name' | 'birthDate' | 'phone' | 'antiBot'
type FieldErrors = Partial<Record<Field, string>>

const NETWORK_MESSAGE = '인터넷 연결을 확인해 주세요.'

// 서버가 돌려준 문장을 알맞은 입력칸 아래로 보낸다. 어디에도 맞지 않으면 null.
function pickFieldForMessage(message: string): Field | null {
  if (/자동가입|방지/.test(message)) return 'antiBot'
  if (/이메일/.test(message)) return 'email'
  if (/아이디/.test(message)) return 'loginId'
  if (/비밀번호|password/i.test(message)) return 'password'
  if (/생년월일/.test(message)) return 'birthDate'
  if (/전화/.test(message)) return 'phone'
  if (/이름/.test(message)) return 'name'
  return null
}

function cleanServerMessage(message: unknown, fallback: string) {
  const text = typeof message === 'string' ? message.trim() : ''
  // 검증 오류가 JSON 덩어리로 오는 경우는 사람이 읽을 수 없으니 바꿔 보여 준다.
  if (!text || /^[\[{]/.test(text) || !/[가-힣]/.test(text)) return fallback
  return text
}

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
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const busyRef = useRef(false)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const loginIdRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const birthRef = useRef<HTMLInputElement | null>(null)
  const phoneMidRef = useRef<HTMLInputElement | null>(null)
  const phoneLastRef = useRef<HTMLInputElement | null>(null)
  const antiBotRef = useRef<HTMLInputElement | null>(null)

  const refs: Record<Field, { current: HTMLInputElement | null }> = {
    email: emailRef,
    loginId: loginIdRef,
    password: passwordRef,
    name: nameRef,
    birthDate: birthRef,
    phone: phoneMidRef,
    antiBot: antiBotRef
  }

  const setFieldError = (field: Field, text: string) => setErrors((prev) => ({ ...prev, [field]: text }))
  const clearFieldError = (field: Field) =>
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })

  const refresh = async () => {
    setAntiBotCode('')
    clearFieldError('antiBot')
    try {
      const res = await fetch('/api/auth/challenge')
      const data = (await res.json()) as { code: string }
      setChallengeCode(data.code)
    } catch {
      setChallengeCode('----')
    }
  }

  useEffect(() => {
    void refresh()
    emailRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 이메일 확인이 끝나면 곧바로 아이디 칸으로 넘어간다.
  useEffect(() => {
    if (emailChecked) loginIdRef.current?.focus()
  }, [emailChecked])

  const checkEmailDuplicate = async () => {
    setFormError('')
    setMessage('')
    clearFieldError('email')

    const value = email.trim()
    if (!value) {
      setFieldError('email', '이메일을 입력해 주세요.')
      emailRef.current?.focus()
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setFieldError('email', '이메일 형식이 맞는지 확인해 주세요. 예: name@example.com')
      emailRef.current?.focus()
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value })
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setFieldError('email', cleanServerMessage(data?.error, '이메일 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.'))
        return
      }

      if (data.exists) {
        setEmailChecked(false)
        setEmailCheckedValue('')
        setFieldError('email', '이미 가입된 이메일입니다. 다른 이메일을 입력하거나 로그인해 주세요.')
        emailRef.current?.focus()
        return
      }

      setEmailChecked(true)
      setEmailCheckedValue(value)
    } catch (e: any) {
      setFieldError('email', e instanceof TypeError ? NETWORK_MESSAGE : '이메일 확인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  // 입력값을 먼저 검사해 입력칸 바로 아래에 이유를 보여 준다. 첫 문제 칸으로 커서를 옮긴다.
  const validate = (): boolean => {
    const next: FieldErrors = {}
    if (loginId.trim().length < 2) next.loginId = '아이디를 2자 이상 입력해 주세요.'
    if (password.length < 6) next.password = '비밀번호는 6자 이상이어야 합니다.'
    if (!name.trim()) next.name = '이름을 입력해 주세요.'
    if (!/^\d{8}$/.test(birthDate)) next.birthDate = '숫자 8자리로 입력해 주세요. 예: 19950710'
    if (!/^\d{4}$/.test(phoneMid) || !/^\d{4}$/.test(phoneLast)) next.phone = '010 뒤 번호를 4자리씩 모두 입력해 주세요.'
    if (!/^\d{4}$/.test(antiBotCode)) next.antiBot = '왼쪽에 보이는 4자리 숫자를 입력해 주세요.'
    setErrors(next)
    const order: Field[] = ['loginId', 'password', 'name', 'birthDate', 'phone', 'antiBot']
    const first = order.find((f) => next[f])
    if (first) {
      refs[first].current?.focus()
      return false
    }
    return true
  }

  const onSubmit = async () => {
    if (loading || busyRef.current) return
    setFormError('')
    setMessage('')

    // 이메일 확인 전에 Enter를 누르면 가입이 아니라 중복확인부터 진행한다.
    if (!emailChecked || emailCheckedValue !== email.trim()) {
      await checkEmailDuplicate()
      return
    }
    if (!validate()) return

    busyRef.current = true
    setLoading(true)
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
        const text = cleanServerMessage(data?.error, '회원가입에 실패했습니다. 입력한 내용을 다시 확인해 주세요.')
        const field = pickFieldForMessage(text)
        if (field) {
          setFieldError(field, text)
          refs[field].current?.focus()
        } else {
          setFormError(text)
        }
        await refresh()
        return
      }

      const supabase = createSupabaseBrowserClient()
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      })

      if (signInError || !signInData.session?.access_token) {
        setMessage('회원가입이 완료되었습니다. 로그인 화면으로 이동해 주세요.')
        setTimeout(() => {
          router.push('/v5/login')
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
        setMessage('회원가입이 완료되었습니다. 자동 로그인 후 화면 이동에 실패했습니다.')
        return
      }

      setMessage('회원가입이 완료되어 자동 로그인됩니다.')
      router.push(getHomeHref(me.roleType))
    } catch (e: any) {
      setFormError(e instanceof TypeError ? NETWORK_MESSAGE : '회원가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.')
      await refresh()
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-shell">
        <div className="panel soft">
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <div className="panel-title">회원가입</div>
          <p className="panel-subtitle">이메일을 먼저 확인한 뒤, 아이디·이름 등을 입력하면 바로 가입되고 로그인됩니다.</p>
        </div>

        <form
          className="panel form-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
        >
          <div className="field">
            <label className="label" htmlFor="v5-su-email">
              이메일
            </label>
            <div className="row v5-email-row">
              <input
                id="v5-su-email"
                ref={emailRef}
                className="input"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                placeholder="name@example.com"
                value={email}
                aria-invalid={Boolean(errors.email)}
                aria-describedby="v5-su-email-help"
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearFieldError('email')
                }}
                onBlur={() => {
                  if (emailCheckedValue !== email.trim()) {
                    setEmailChecked(false)
                  }
                }}
              />
              <button
                className="button secondary nowrap"
                type={emailChecked ? 'button' : 'submit'}
                disabled={loading}
                onClick={emailChecked ? () => void checkEmailDuplicate() : undefined}
              >
                {loading && !emailChecked ? '확인 중...' : '중복확인'}
              </button>
            </div>
            {errors.email ? (
              <p id="v5-su-email-help" className="v5-auth-error" role="alert">
                {errors.email}
              </p>
            ) : (
              <p id="v5-su-email-help" className="v5-auth-help">
                {emailChecked ? '사용 가능한 이메일입니다.' : '입력한 뒤 Enter 또는 중복확인을 누르면 사용할 수 있는지 확인합니다.'}
              </p>
            )}
          </div>

          {emailChecked ? (
            <>
              <div className="field">
                <label className="label" htmlFor="v5-su-loginid">
                  아이디
                </label>
                <input
                  id="v5-su-loginid"
                  ref={loginIdRef}
                  className="input"
                  autoComplete="username"
                  value={loginId}
                  aria-invalid={Boolean(errors.loginId)}
                  aria-describedby="v5-su-loginid-help"
                  onChange={(e) => {
                    setLoginId(e.target.value)
                    clearFieldError('loginId')
                  }}
                />
                <p id="v5-su-loginid-help" className={errors.loginId ? 'v5-auth-error' : 'v5-auth-help'} role={errors.loginId ? 'alert' : undefined}>
                  {errors.loginId || '로그인할 때 쓰는 아이디입니다. 2자 이상.'}
                </p>
              </div>

              <div className="field">
                <label className="label" htmlFor="v5-su-password">
                  비밀번호
                </label>
                <PasswordField
                  id="v5-su-password"
                  inputRef={passwordRef}
                  value={password}
                  autoComplete="new-password"
                  invalid={Boolean(errors.password)}
                  describedBy="v5-su-password-help"
                  onChange={(v) => {
                    setPassword(v)
                    clearFieldError('password')
                  }}
                />
                <p id="v5-su-password-help" className={errors.password ? 'v5-auth-error' : 'v5-auth-help'} role={errors.password ? 'alert' : undefined}>
                  {errors.password || '6자 이상으로 정해 주세요.'}
                </p>
              </div>

              <div className="field">
                <label className="label" htmlFor="v5-su-name">
                  이름
                </label>
                <input
                  id="v5-su-name"
                  ref={nameRef}
                  className="input"
                  autoComplete="name"
                  value={name}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'v5-su-name-err' : undefined}
                  onChange={(e) => {
                    setName(e.target.value)
                    clearFieldError('name')
                  }}
                />
                {errors.name ? (
                  <p id="v5-su-name-err" className="v5-auth-error" role="alert">
                    {errors.name}
                  </p>
                ) : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v5-su-birth">
                  생년월일
                </label>
                <input
                  id="v5-su-birth"
                  ref={birthRef}
                  className="input"
                  value={birthDate}
                  aria-invalid={Boolean(errors.birthDate)}
                  aria-describedby="v5-su-birth-help"
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '').slice(0, 8)
                    setBirthDate(next)
                    clearFieldError('birthDate')
                    if (next.length === 8) phoneMidRef.current?.focus()
                  }}
                  placeholder="19950710"
                  inputMode="numeric"
                  autoComplete="bday"
                />
                <p id="v5-su-birth-help" className={errors.birthDate ? 'v5-auth-error' : 'v5-auth-help'} role={errors.birthDate ? 'alert' : undefined}>
                  {errors.birthDate || '숫자 8자리로 입력해 주세요.'}
                </p>
              </div>

              <div className="field">
                <label className="label" htmlFor="v5-su-phone-mid">
                  전화번호
                </label>
                <div className="row v5-phone-row">
                  <input className="input" style={{ maxWidth: 90, textAlign: 'center' }} value="010" disabled aria-label="전화번호 앞 3자리" />
                  <span className="muted">-</span>
                  <input
                    id="v5-su-phone-mid"
                    ref={phoneMidRef}
                    className="input"
                    style={{ maxWidth: 120, textAlign: 'center' }}
                    value={phoneMid}
                    maxLength={4}
                    inputMode="numeric"
                    aria-invalid={Boolean(errors.phone)}
                    aria-label="전화번호 가운데 4자리"
                    aria-describedby="v5-su-phone-help"
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneMid(next)
                      clearFieldError('phone')
                      if (next.length === 4) phoneLastRef.current?.focus()
                    }}
                  />
                  <span className="muted">-</span>
                  <input
                    ref={phoneLastRef}
                    className="input"
                    style={{ maxWidth: 120, textAlign: 'center' }}
                    value={phoneLast}
                    maxLength={4}
                    inputMode="numeric"
                    aria-invalid={Boolean(errors.phone)}
                    aria-label="전화번호 마지막 4자리"
                    aria-describedby="v5-su-phone-help"
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneLast(next)
                      clearFieldError('phone')
                      if (next.length === 4) window.setTimeout(() => antiBotRef.current?.focus(), 0)
                    }}
                  />
                </div>
                <p id="v5-su-phone-help" className={errors.phone ? 'v5-auth-error' : 'v5-auth-help'} role={errors.phone ? 'alert' : undefined}>
                  {errors.phone || '010 뒤의 번호를 4자리씩 입력해 주세요.'}
                </p>
              </div>

              <div className="panel soft">
                <div className="row-between">
                  <label className="label" htmlFor="v5-su-antibot">
                    자동가입방지
                  </label>
                  <button className="button secondary" type="button" disabled={loading} onClick={() => void refresh()}>
                    새로 만들기
                  </button>
                </div>
                <div className="row-between" style={{ marginTop: 12 }}>
                  <div className="card-value" aria-label="자동가입방지 숫자">
                    {challengeCode}
                  </div>
                  <input
                    id="v5-su-antibot"
                    ref={antiBotRef}
                    className="input"
                    style={{ maxWidth: 140, textAlign: 'center' }}
                    value={antiBotCode}
                    maxLength={4}
                    aria-invalid={Boolean(errors.antiBot)}
                    aria-describedby="v5-su-antibot-help"
                    onChange={(e) => {
                      setAntiBotCode(e.target.value.replace(/[^\d]/g, ''))
                      clearFieldError('antiBot')
                    }}
                    placeholder="4자리"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <p id="v5-su-antibot-help" className={errors.antiBot ? 'v5-auth-error' : 'v5-auth-help'} role={errors.antiBot ? 'alert' : undefined} style={{ marginTop: 8 }}>
                  {errors.antiBot || '왼쪽에 보이는 숫자를 오른쪽 칸에 그대로 입력해 주세요.'}
                </p>
              </div>
            </>
          ) : null}

          {emailChecked ? (
            <button className="button v5-submit" type="submit" disabled={loading} aria-busy={loading}>
              {loading ? (
                '처리 중...'
              ) : (
                '가입하기'
              )}
            </button>
          ) : null}

          {formError ? (
            <div className="message-error small" role="alert">
              {formError}
            </div>
          ) : null}
          <div aria-live="polite">{message ? <div className="message-success small">{message}</div> : null}</div>
          <div className="small muted">
            이미 계정이 있나요?{' '}
            <Link className="link" href="/v5/login">
              로그인
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
