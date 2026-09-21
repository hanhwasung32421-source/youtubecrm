'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
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

  const refresh = async () => {
    setAntiBotCode('')
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
        setEmailCheckError(data?.error || '이메일 중복확인에 실패했습니다.')
        return
      }

      if (data.exists) {
        setEmailChecked(false)
        setEmailCheckedValue('')
        setEmailCheckError('이미 가입된 이메일입니다.')
        return
      }

      setEmailChecked(true)
      setEmailCheckedValue(email.trim())
      setMessage('사용 가능한 이메일입니다.')
      setTimeout(() => loginIdRef.current?.focus(), 0)
    } catch (e: any) {
      setEmailCheckError(e?.message || '이메일 중복확인 중 오류가 발생했습니다.')
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
        const text: string = data?.error || '회원가입에 실패했습니다.'
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
        setMessage('회원가입이 완료되었습니다. 로그인 화면으로 이동해 주세요.')
        setTimeout(() => {
          router.push('/v2/login')
        }, 1000)
        return
      }

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${signInData.session.access_token}` }
      })

      try {
        await fetchMe(signInData.session.access_token)
      } catch {
        setMessage('회원가입이 완료되었습니다. 자동 로그인 후 화면 이동에 실패했습니다.')
        return
      }

      setMessage('회원가입이 완료되어 자동 로그인됩니다.')
      router.push(V2_HOME_HREF)
    } catch (e: any) {
      setError(e?.message || '회원가입 중 오류가 발생했습니다.')
      await refresh()
    } finally {
      setLoading(false)
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
                aria-describedby="v2-su-email-help"
                autoFocus
              />
              <button className="button secondary nowrap" type="button" disabled={loading} onClick={() => void checkEmailDuplicate()}>
                {loading ? '확인 중...' : emailChecked ? '확인됨 ✓' : '중복확인'}
              </button>
            </div>
            <div className="v2-field-help" id="v2-su-email-help">
              이미 가입한 이메일인지 확인해요. Enter를 눌러도 됩니다.
            </div>
            {emailCheckError ? <div className="v2-field-error">{emailCheckError}</div> : null}
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
                  value={loginId}
                  readOnly={loading}
                  onChange={(e) => {
                    setLoginId(e.target.value)
                    clearFieldError('loginId')
                  }}
                  aria-invalid={fieldErrors.loginId ? true : undefined}
                />
                <div className="v2-field-help">로그인할 때 이메일 대신 쓸 수 있는 이름이에요. (2자 이상)</div>
                {fieldErrors.loginId ? <div className="v2-field-error">{fieldErrors.loginId}</div> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v2-su-password">
                  비밀번호
                </label>
                <input
                  id="v2-su-password"
                  ref={passwordRef}
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  readOnly={loading}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    clearFieldError('password')
                  }}
                  aria-invalid={fieldErrors.password ? true : undefined}
                />
                <div className="v2-field-help">6자 이상으로 만들어 주세요.</div>
                {fieldErrors.password ? <div className="v2-field-error">{fieldErrors.password}</div> : null}
              </div>

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
                />
                {fieldErrors.name ? <div className="v2-field-error">{fieldErrors.name}</div> : null}
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
                />
                <div className="v2-field-help">숫자 8자리만 적어 주세요.</div>
                {fieldErrors.birthDate ? <div className="v2-field-error">{fieldErrors.birthDate}</div> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v2-su-phone-mid">
                  전화번호
                </label>
                <div className="row">
                  <input className="input" style={{ maxWidth: 90, textAlign: 'center' }} value="010" disabled aria-label="전화번호 앞자리" />
                  <span className="muted">-</span>
                  <input
                    id="v2-su-phone-mid"
                    ref={phoneMidRef}
                    className="input"
                    style={{ maxWidth: 120, textAlign: 'center' }}
                    value={phoneMid}
                    maxLength={4}
                    inputMode="numeric"
                    autoComplete="off"
                    readOnly={loading}
                    aria-label="전화번호 가운데 4자리"
                    aria-invalid={fieldErrors.phone ? true : undefined}
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
                    autoComplete="off"
                    readOnly={loading}
                    aria-label="전화번호 마지막 4자리"
                    aria-invalid={fieldErrors.phone ? true : undefined}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneLast(next)
                      clearFieldError('phone')
                      if (next.length === 4) setTimeout(() => antiBotRef.current?.focus(), 0)
                    }}
                  />
                </div>
                <div className="v2-field-help">010은 미리 들어 있어요. 뒤의 8자리만 적어 주세요.</div>
                {fieldErrors.phone ? <div className="v2-field-error">{fieldErrors.phone}</div> : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="v2-su-antibot">
                  자동가입방지
                </label>
                <div className="row">
                  <div className="card-value" aria-label={`보이는 숫자 ${challengeCode.split('').join(' ')}`}>
                    {challengeCode}
                  </div>
                  <input
                    id="v2-su-antibot"
                    ref={antiBotRef}
                    className="input"
                    style={{ maxWidth: 140, textAlign: 'center' }}
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
                  />
                  <button className="button secondary nowrap" type="button" disabled={loading} onClick={() => void refresh()}>
                    새로 만들기
                  </button>
                </div>
                <div className="v2-field-help">왼쪽에 보이는 숫자 4자리를 그대로 적어 주세요.</div>
                {fieldErrors.antiBot ? <div className="v2-field-error">{fieldErrors.antiBot}</div> : null}
              </div>

              <button className="button" type="submit" disabled={loading}>
                {loading ? '처리 중...' : '가입하기'}
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
