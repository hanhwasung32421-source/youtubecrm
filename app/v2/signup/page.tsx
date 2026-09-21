'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PasswordField } from '@/components/v2/password-field'
import { koreanOr } from '@/components/v2/register-utils'
import { setCachedV2Me } from '@/components/v2/session-context'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache, fetchMe } from '@/lib/session/me-client'
import { V2_HOME_HREF } from '@/lib/v2/menu'

type FieldKey = 'loginId' | 'password' | 'name' | 'birthDate' | 'phone' | 'antiBot'
type InputRef = React.RefObject<HTMLInputElement | null>

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
  const [error, setError] = useState('')
  const [emailCheckError, setEmailCheckError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})

  const emailRef = useRef<HTMLInputElement | null>(null)
  const loginIdRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const birthRef = useRef<HTMLInputElement | null>(null)
  const phoneMidRef = useRef<HTMLInputElement | null>(null)
  const phoneLastRef = useRef<HTMLInputElement | null>(null)
  const antiBotRef = useRef<HTMLInputElement | null>(null)
  const busyRef = useRef(false)
  const challengeSeq = useRef(0)
  const timers = useRef<number[]>([])

  const refresh = async () => {
    setAntiBotCode('')
    // "새로 만들기"를 연달아 눌렀을 때 늦게 도착한 옛 숫자가 새 숫자를 덮어쓰지 않게 마지막 요청만 쓴다.
    const seq = ++challengeSeq.current
    try {
      const res = await fetch('/api/auth/challenge')
      const data = (await res.json()) as { code: string }
      if (seq === challengeSeq.current) setChallengeCode(data.code)
    } catch {
      if (seq === challengeSeq.current) setChallengeCode('----')
    }
  }

  // 화면을 떠난 뒤에 예약된 이동·커서 옮기기가 실행되지 않게 한다.
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  useEffect(() => {
    // 새로 가입하는 사람에게 이전 사용자의 메모리 캐시가 보이지 않게 한다.
    clearMeCache()
    setCachedV2Me(null)
    void refresh()
    const pending = timers.current
    return () => {
      for (const t of pending) window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setFieldError = (key: FieldKey, text: string) => setFieldErrors((prev) => ({ ...prev, [key]: text }))
  const clearFieldError = (key: FieldKey) =>
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  const checkEmailDuplicate = async () => {
    setError('')
    setMessage('')
    setEmailCheckError('')

    if (!email.trim()) {
      setEmailCheckError('이메일을 먼저 입력해 주세요.')
      emailRef.current?.focus()
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setEmailCheckError(koreanOr(data?.error, '이메일 중복확인을 하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'))
        return
      }

      if (data.exists) {
        setEmailChecked(false)
        setEmailCheckedValue('')
        setEmailCheckError('이미 가입된 이메일이에요. 로그인 화면에서 로그인해 주세요.')
        return
      }

      setEmailChecked(true)
      setEmailCheckedValue(email.trim())
      setMessage('사용할 수 있는 이메일이에요.')
      later(() => loginIdRef.current?.focus(), 0)
    } catch (e: unknown) {
      setEmailCheckError(e instanceof TypeError ? '인터넷 연결을 확인하고 다시 시도해 주세요.' : '이메일 중복확인 중 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  // 빈칸·형식 오류를 칸 바로 아래에 알려 주고, 첫 문제 칸으로 커서를 옮긴다.
  const validate = (): boolean => {
    const errors: Partial<Record<FieldKey, string>> = {}
    const order: InputRef[] = []
    const add = (key: FieldKey, text: string, ref: InputRef) => {
      errors[key] = text
      order.push(ref)
    }

    if (loginId.trim().length < 2) add('loginId', '아이디를 2자 이상 적어 주세요.', loginIdRef)
    if (password.length < 6) add('password', '비밀번호는 6자 이상이에요.', passwordRef)
    if (!name.trim()) add('name', '이름을 적어 주세요.', nameRef)
    if (!/^\d{8}$/.test(birthDate)) add('birthDate', '생년월일 숫자 8자리를 적어 주세요. (예: 19950710)', birthRef)
    if (!/^\d{4}$/.test(phoneMid)) add('phone', '전화번호 가운데 4자리를 적어 주세요.', phoneMidRef)
    else if (!/^\d{4}$/.test(phoneLast)) add('phone', '전화번호 마지막 4자리를 적어 주세요.', phoneLastRef)
    if (!/^\d{4}$/.test(antiBotCode)) add('antiBot', '왼쪽에 보이는 숫자 4자리를 그대로 적어 주세요.', antiBotRef)

    setFieldErrors(errors)
    if (order.length > 0) {
      order[0].current?.focus()
      return false
    }
    return true
  }

  const onSubmit = async () => {
    setError('')
    setMessage('')
    setFieldErrors({})

    if (!emailChecked || emailCheckedValue !== email.trim()) {
      setEmailChecked(false)
      await checkEmailDuplicate()
      return
    }
    if (!validate()) return

    // 가입 요청이 두 번 나가지 않게 한다(두 번째는 "이미 가입된 이메일"로 보여 헷갈린다).
    if (busyRef.current) return
    busyRef.current = true
    setLoading(true)
    let leaving = false

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
        const text = koreanOr(data?.error, '회원가입을 하지 못했어요. 잠시 뒤에 다시 시도해 주세요.')
        const isAntiBot = /자동가입방지/.test(text)
        // 서버가 알려 준 문제를 해당 칸 아래에 붙여 준다.
        if (isAntiBot) {
          setFieldError('antiBot', text)
        } else if (/아이디/.test(text)) {
          setFieldError('loginId', text)
          loginIdRef.current?.focus()
        } else {
          setError(text)
        }
        await refresh()
        if (isAntiBot) antiBotRef.current?.focus()
        return
      }

      const supabase = createSupabaseBrowserClient()
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      })

      if (signInError || !signInData.session?.access_token) {
        setMessage('가입이 끝났어요. 로그인 화면으로 이동할게요.')
        leaving = true
        later(() => router.push('/v2/login'), 1000)
        return
      }

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${signInData.session.access_token}` }
      }).catch(() => undefined)

      try {
        await fetchMe(signInData.session.access_token)
      } catch {
        setMessage('가입은 끝났어요. 화면을 옮기지 못했으니 로그인 화면에서 로그인해 주세요.')
        return
      }

      setMessage('가입이 끝나서 바로 로그인했어요.')
      leaving = true
      router.push(V2_HOME_HREF)
    } catch (e: unknown) {
      setError(e instanceof TypeError ? '인터넷 연결을 확인하고 다시 시도해 주세요.' : '가입하는 중에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.')
      await refresh()
    } finally {
      // 화면이 넘어가는 중에는 버튼을 계속 잠가 두어 두 번 누르는 일을 막는다.
      if (!leaving) {
        busyRef.current = false
        setLoading(false)
      }
    }
  }

  // Enter: 이메일 확인 전이면 중복확인, 확인 뒤에는 가입 진행
  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    void onSubmit()
  }

  return (
    <div className="auth-wrap">
      <div className="auth-shell">
        <div className="panel soft">
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <div className="panel-title">회원가입</div>
          <p className="panel-subtitle">먼저 이메일 중복확인을 하면 나머지 정보를 입력할 수 있어요.</p>
        </div>

        <form className="panel v2-signup-form" onSubmit={onFormSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="v2-su-email">
              이메일
            </label>
            <div className="row">
              <input
                id="v2-su-email"
                ref={emailRef}
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                readOnly={loading}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailCheckError('')
                }}
                onBlur={() => {
                  if (emailCheckedValue !== email.trim()) {
                    setEmailChecked(false)
                  }
                }}
                aria-invalid={emailCheckError ? true : undefined}
                aria-describedby={emailCheckError ? "v2-su-email-help v2-su-email-error" : "v2-su-email-help"}
                autoFocus
              />
              <button className="button secondary nowrap" type="button" disabled={loading} onClick={() => void checkEmailDuplicate()}>
                {loading ? '확인 중…' : emailChecked ? '확인됨 ✓' : '중복확인'}
              </button>
            </div>
            <div className="v2-field-help" id="v2-su-email-help">
              이미 가입한 이메일인지 확인해요. Enter를 눌러도 돼요.
            </div>
            {emailCheckError ? <div className="v2-field-error" id="v2-su-email-error" role="alert">{emailCheckError}</div> : null}
          </div>

          {emailChecked ? (
            <>
              <div className="field">
                <label className="label" htmlFor="v2-su-loginid">
                  아이디
                </label>
                <input
                  id="v2-su-loginid"
                  ref={loginIdRef}
                  className="input"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={loginId}
                  readOnly={loading}
                  onChange={(e) => {
                    setLoginId(e.target.value)
                    clearFieldError('loginId')
                  }}
                  aria-invalid={fieldErrors.loginId ? true : undefined}
                  aria-describedby={fieldErrors.loginId ? 'v2-su-loginid-help v2-su-loginId-error' : 'v2-su-loginid-help'}
                />
                <div className="v2-field-help" id="v2-su-loginid-help">로그인할 때 이메일 대신 쓸 수 있는 이름이에요. (2자 이상)</div>
                {fieldErrors.loginId ? <div className="v2-field-error" id="v2-su-loginId-error" role="alert">{fieldErrors.loginId}</div> : null}
              </div>

              <PasswordField
                id="v2-su-password"
                label="비밀번호"
                value={password}
                onChange={(v) => {
                  setPassword(v)
                  clearFieldError('password')
                }}
                autoComplete="new-password"
                inputRef={passwordRef}
                readOnly={loading}
                invalid={Boolean(fieldErrors.password)}
                help="6자 이상으로 만들어 주세요."
                error={fieldErrors.password}
              />

              <div className="field">
                <label className="label" htmlFor="v2-su-name">
                  이름
                </label>
                <input
                  id="v2-su-name"
                  ref={nameRef}
                  className="input"
                  autoComplete="name"
                  value={name}
                  readOnly={loading}
                  onChange={(e) => {
                    setName(e.target.value)
                    clearFieldError('name')
                  }}
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby={fieldErrors.name ? 'v2-su-name-error' : undefined}
                />
                {fieldErrors.name ? <div className="v2-field-error" id="v2-su-name-error" role="alert">{fieldErrors.name}</div> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v2-su-birth">
                  생년월일
                </label>
                <input
                  id="v2-su-birth"
                  ref={birthRef}
                  className="input"
                  value={birthDate}
                  readOnly={loading}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '').slice(0, 8)
                    setBirthDate(next)
                    clearFieldError('birthDate')
                    if (next.length === 8) phoneMidRef.current?.focus()
                  }}
                  placeholder="19950710"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={fieldErrors.birthDate ? true : undefined}
                  aria-describedby={fieldErrors.birthDate ? 'v2-su-birth-help v2-su-birthDate-error' : 'v2-su-birth-help'}
                />
                <div className="v2-field-help" id="v2-su-birth-help">숫자 8자리만 적어 주세요.</div>
                {fieldErrors.birthDate ? <div className="v2-field-error" id="v2-su-birthDate-error" role="alert">{fieldErrors.birthDate}</div> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v2-su-phone-mid">
                  전화번호
                </label>
                <div className="v2-phone" role="group" aria-label="전화번호">
                  <input className="input v2-phone-prefix" value="010" disabled aria-label="전화번호 앞자리" />
                  <span className="muted" aria-hidden="true">-</span>
                  <input
                    id="v2-su-phone-mid"
                    ref={phoneMidRef}
                    className="input v2-phone-part"
                    value={phoneMid}
                    maxLength={4}
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="next"
                    readOnly={loading}
                    aria-label="전화번호 가운데 4자리"
                    aria-invalid={fieldErrors.phone ? true : undefined}
                    aria-describedby={fieldErrors.phone ? 'v2-su-phone-error' : undefined}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneMid(next)
                      clearFieldError('phone')
                      if (next.length === 4) phoneLastRef.current?.focus()
                    }}
                  />
                  <span className="muted" aria-hidden="true">-</span>
                  <input
                    ref={phoneLastRef}
                    className="input v2-phone-part"
                    value={phoneLast}
                    maxLength={4}
                    inputMode="numeric"
                    autoComplete="off"
                    readOnly={loading}
                    aria-label="전화번호 마지막 4자리"
                    aria-invalid={fieldErrors.phone ? true : undefined}
                    aria-describedby={fieldErrors.phone ? 'v2-su-phone-error' : undefined}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneLast(next)
                      clearFieldError('phone')
                      if (next.length === 4) later(() => antiBotRef.current?.focus(), 0)
                    }}
                  />
                </div>
                <div className="v2-field-help">010은 미리 들어 있어요. 뒤의 8자리만 적어 주세요.</div>
                {fieldErrors.phone ? <div className="v2-field-error" id="v2-su-phone-error" role="alert">{fieldErrors.phone}</div> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v2-su-antibot">
                  자동가입방지
                </label>
                <div className="v2-antibot">
                  <div className="card-value v2-antibot-code" role="img" aria-label={`보이는 숫자 ${challengeCode.split('').join(' ')}`}>
                    {challengeCode}
                  </div>
                  <input
                    id="v2-su-antibot"
                    ref={antiBotRef}
                    className="input v2-antibot-input"
                    value={antiBotCode}
                    maxLength={4}
                    readOnly={loading}
                    onChange={(e) => {
                      setAntiBotCode(e.target.value.replace(/[^\d]/g, '').slice(0, 4))
                      clearFieldError('antiBot')
                    }}
                    placeholder="4자리"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={fieldErrors.antiBot ? true : undefined}
                    aria-describedby={fieldErrors.antiBot ? 'v2-su-antibot-help v2-su-antiBot-error' : 'v2-su-antibot-help'}
                  />
                  <button className="button secondary nowrap" type="button" disabled={loading} onClick={() => void refresh()}>
                    새로 만들기
                  </button>
                </div>
                <div className="v2-field-help" id="v2-su-antibot-help">왼쪽에 보이는 숫자 4자리를 그대로 적어 주세요.</div>
                {fieldErrors.antiBot ? <div className="v2-field-error" id="v2-su-antiBot-error" role="alert">{fieldErrors.antiBot}</div> : null}
              </div>

              <button className="button v2-submit" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <span className="v2-spin" aria-hidden="true" /> 처리 중…
                  </>
                ) : (
                  '가입하기'
                )}
              </button>
            </>
          ) : null}

          {error ? (
            <div className="message-error small" role="alert">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="message-success small" role="status">
              {message}
            </div>
          ) : null}
          <div className="small muted">
            이미 계정이 있나요? <Link className="link" href="/v2/login">로그인</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
