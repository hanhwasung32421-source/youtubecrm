'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { LOGIN_HREF, homeHrefForRole } from '@/lib/v4/menu'

type FieldKey = 'email' | 'loginId' | 'password' | 'name' | 'birthDate' | 'phone' | 'antiBotCode'
type FieldErrors = Partial<Record<FieldKey, string>>

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null
  return (
    <div id={id} className="message-error small" role="alert">
      {text}
    </div>
  )
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
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

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
      setError('자동가입방지 숫자를 불러오지 못했어요. 인터넷 연결을 확인하고 "새로 만들기"를 눌러 주세요.')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // 이메일 확인이 끝나면 다음 칸(아이디)으로 커서를 옮긴다.
  useEffect(() => {
    if (emailChecked) loginIdRef.current?.focus()
  }, [emailChecked])

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
    clearFieldError('email')

    const trimmed = email.trim()
    if (!trimmed) {
      setFieldError('email', '이메일을 먼저 입력해 주세요.')
      emailRef.current?.focus()
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setFieldError('email', '이메일 형식을 확인해 주세요. (예: name@example.com)')
      emailRef.current?.focus()
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed })
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setFieldError('email', data?.error || '이메일 중복확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
        return
      }

      if (data.exists) {
        setEmailChecked(false)
        setEmailCheckedValue('')
        setFieldError('email', '이미 가입된 이메일이에요. 로그인해 보시거나 다른 이메일을 입력해 주세요.')
        emailRef.current?.focus()
        return
      }

      setEmailChecked(true)
      setEmailCheckedValue(trimmed)
      setMessage('사용할 수 있는 이메일이에요. 아래 정보를 입력해 주세요.')
    } catch {
      setFieldError('email', '인터넷 연결을 확인해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  // 빠진 칸이 있으면 첫 번째 칸에 커서를 두고 칸마다 이유를 보여준다.
  const onSubmit = async () => {
    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (!emailChecked || emailCheckedValue !== email.trim()) {
        setFieldError('email', '이메일 중복확인을 먼저 완료해 주세요.')
        emailRef.current?.focus()
        return
      }

      const errors: FieldErrors = {}
      let firstRef: HTMLInputElement | null = null
      const fail = (key: FieldKey, text: string, ref: HTMLInputElement | null) => {
        errors[key] = text
        if (!firstRef) firstRef = ref
      }
      if (!loginId.trim()) fail('loginId', '아이디를 입력해 주세요.', loginIdRef.current)
      if (password.length < 6) fail('password', '비밀번호는 6자 이상이어야 해요.', passwordRef.current)
      if (!name.trim()) fail('name', '이름을 입력해 주세요.', nameRef.current)
      if (birthDate.length !== 8) fail('birthDate', '생년월일 8자리를 숫자로 입력해 주세요. (예: 19950710)', birthRef.current)
      if (phoneMid.length < 3 || phoneLast.length !== 4) {
        fail('phone', '전화번호 가운데 3~4자리와 끝 4자리를 입력해 주세요.', phoneMid.length < 3 ? phoneMidRef.current : phoneLastRef.current)
      }
      if (antiBotCode.length !== 4) fail('antiBotCode', '왼쪽에 보이는 숫자 4자리를 입력해 주세요.', antiBotRef.current)
      if (Object.keys(errors).length > 0) {
        setFieldErrors((prev) => ({ email: prev.email, ...errors }))
        ;(firstRef as HTMLInputElement | null)?.focus()
        return
      }
      setFieldErrors({})

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
        setError(data?.error || '회원가입에 실패했어요. 입력한 내용을 확인해 주세요.')
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
          router.push(LOGIN_HREF)
        }, 1000)
        return
      }

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${signInData.session.access_token}` }
      })

      let homeHref = homeHrefForRole(null)
      try {
        const me = await fetchMe(signInData.session.access_token)
        homeHref = homeHrefForRole(me.roleType)
      } catch {
        setMessage('회원가입이 완료되었습니다. 자동 로그인 후 화면 이동에 실패했습니다.')
        return
      }

      setMessage('회원가입이 완료되어 자동 로그인됩니다.')
      router.push(homeHref)
    } catch {
      setError('가입 중 문제가 생겼어요. 인터넷 연결을 확인하고 다시 시도해 주세요.')
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  const emailReady = emailChecked && emailCheckedValue === email.trim()

  return (
    <div className="auth-wrap">
      <div className="auth-shell">
        <div className="panel soft">
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <div className="panel-title">회원가입</div>
          <p className="panel-subtitle">이메일 중복확인을 먼저 하고, 이어서 가입 정보를 입력하면 가입이 완료됩니다.</p>
        </div>

        <form
          className="panel form-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (loading) return
            // 이메일 확인 전에는 Enter 가 "중복확인"을 대신 눌러 준다.
            if (!emailReady) void checkEmailDuplicate()
            else void onSubmit()
          }}
        >
          <div className="field">
            <label className="label" htmlFor="v4-su-email">
              이메일
            </label>
            <div className="row">
              <input
                id="v4-su-email"
                ref={emailRef}
                className="input"
                type="email"
                autoFocus
                autoComplete="email"
                inputMode="email"
                placeholder="name@example.com"
                value={email}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby="v4-su-email-help v4-su-email-err"
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
              <button className="button secondary nowrap" type="button" disabled={loading} onClick={() => void checkEmailDuplicate()}>
                {loading && !emailReady ? '확인 중...' : emailReady ? '확인됨 ✓' : '중복확인'}
              </button>
            </div>
            <div id="v4-su-email-help" className="small muted">
              로그인할 때 쓰는 이메일이에요. 입력하고 Enter 를 누르면 중복확인이 됩니다.
            </div>
            <FieldError id="v4-su-email-err" text={fieldErrors.email} />
          </div>

          {emailReady ? (
            <>
              <div className="field">
                <label className="label" htmlFor="v4-su-loginid">
                  아이디
                </label>
                <input
                  id="v4-su-loginid"
                  ref={loginIdRef}
                  className="input"
                  autoComplete="username"
                  value={loginId}
                  aria-invalid={fieldErrors.loginId ? true : undefined}
                  aria-describedby="v4-su-loginid-err"
                  onChange={(e) => {
                    setLoginId(e.target.value)
                    clearFieldError('loginId')
                  }}
                />
                <FieldError id="v4-su-loginid-err" text={fieldErrors.loginId} />
              </div>

              <div className="field">
                <label className="label" htmlFor="v4-su-password">
                  비밀번호
                </label>
                <input
                  id="v4-su-password"
                  ref={passwordRef}
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby="v4-su-password-help v4-su-password-err"
                  onChange={(e) => {
                    setPassword(e.target.value)
                    clearFieldError('password')
                  }}
                />
                <div id="v4-su-password-help" className="small muted">
                  6자 이상으로 정해 주세요.
                </div>
                <FieldError id="v4-su-password-err" text={fieldErrors.password} />
              </div>

              <div className="field">
                <label className="label" htmlFor="v4-su-name">
                  이름
                </label>
                <input
                  id="v4-su-name"
                  ref={nameRef}
                  className="input"
                  autoComplete="name"
                  value={name}
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby="v4-su-name-err"
                  onChange={(e) => {
                    setName(e.target.value)
                    clearFieldError('name')
                  }}
                />
                <FieldError id="v4-su-name-err" text={fieldErrors.name} />
              </div>

              <div className="field">
                <label className="label" htmlFor="v4-su-birth">
                  생년월일
                </label>
                <input
                  id="v4-su-birth"
                  ref={birthRef}
                  className="input"
                  value={birthDate}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '').slice(0, 8)
                    setBirthDate(next)
                    clearFieldError('birthDate')
                    if (next.length === 8) phoneMidRef.current?.focus()
                  }}
                  placeholder="19950710"
                  inputMode="numeric"
                  autoComplete="bday"
                  aria-invalid={fieldErrors.birthDate ? true : undefined}
                  aria-describedby="v4-su-birth-help v4-su-birth-err"
                />
                <div id="v4-su-birth-help" className="small muted">
                  숫자 8자리로 적어 주세요.
                </div>
                <FieldError id="v4-su-birth-err" text={fieldErrors.birthDate} />
              </div>

              <div className="field">
                <label className="label" htmlFor="v4-su-phone-mid">
                  전화번호
                </label>
                <div className="row">
                  <input className="input" style={{ maxWidth: 90, textAlign: 'center' }} value="010" disabled aria-label="전화번호 앞자리 010" />
                  <span className="muted">-</span>
                  <input
                    id="v4-su-phone-mid"
                    ref={phoneMidRef}
                    className="input"
                    style={{ maxWidth: 120, textAlign: 'center' }}
                    value={phoneMid}
                    maxLength={4}
                    inputMode="numeric"
                    autoComplete="tel-national"
                    aria-label="전화번호 가운데 자리"
                    aria-invalid={fieldErrors.phone ? true : undefined}
                    aria-describedby="v4-su-phone-help v4-su-phone-err"
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
                    aria-label="전화번호 끝 4자리"
                    aria-invalid={fieldErrors.phone ? true : undefined}
                    aria-describedby="v4-su-phone-help v4-su-phone-err"
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneLast(next)
                      clearFieldError('phone')
                      if (next.length === 4) window.setTimeout(() => antiBotRef.current?.focus(), 0)
                    }}
                  />
                </div>
                <div id="v4-su-phone-help" className="small muted">
                  010 뒤의 번호만 적어 주세요.
                </div>
                <FieldError id="v4-su-phone-err" text={fieldErrors.phone} />
              </div>

              <div className="panel soft">
                <div className="row-between">
                  <label className="label" htmlFor="v4-su-antibot">
                    자동가입방지
                  </label>
                  <button className="button secondary" type="button" disabled={loading} onClick={() => void refresh()}>
                    새로 만들기
                  </button>
                </div>
                <div className="row-between" style={{ marginTop: 12 }}>
                  <div className="card-value" aria-label={`보이는 숫자 ${challengeCode}`}>
                    {challengeCode}
                  </div>
                  <input
                    id="v4-su-antibot"
                    ref={antiBotRef}
                    className="input"
                    style={{ maxWidth: 140, textAlign: 'center' }}
                    value={antiBotCode}
                    maxLength={4}
                    onChange={(e) => {
                      setAntiBotCode(e.target.value)
                      clearFieldError('antiBotCode')
                    }}
                    placeholder="4자리"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={fieldErrors.antiBotCode ? true : undefined}
                    aria-describedby="v4-su-antibot-help v4-su-antibot-err"
                  />
                </div>
                <div id="v4-su-antibot-help" className="small muted" style={{ marginTop: 8 }}>
                  왼쪽에 보이는 숫자 4개를 그대로 입력해 주세요.
                </div>
                <FieldError id="v4-su-antibot-err" text={fieldErrors.antiBotCode} />
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
            이미 계정이 있나요? <Link className="link" href="/v4/login">로그인</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
