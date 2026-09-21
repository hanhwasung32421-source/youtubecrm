'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v3/menu'

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
  const phoneMidRef = useRef<HTMLInputElement | null>(null)
  const phoneLastRef = useRef<HTMLInputElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const birthRef = useRef<HTMLInputElement | null>(null)

  const refresh = async () => {
    setAntiBotCode('')
    const res = await fetch('/api/auth/challenge')
    const data = (await res.json()) as { code: string }
    setChallengeCode(data.code)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const checkEmailDuplicate = async () => {
    setError('')
    setMessage('')
    setEmailCheckError('')

    if (!email.trim()) {
      setEmailCheckError('이메일을 먼저 입력해 주세요.')
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
    } catch (e: any) {
      setEmailCheckError(e?.message || '이메일 중복확인 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async () => {
    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (!emailChecked || emailCheckedValue !== email.trim()) {
        setError('이메일 중복확인을 먼저 완료해 주세요.')
        return
      }

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
        setError(data?.error || '회원가입에 실패했습니다.')
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
        setMessage('회원가입이 완료되었습니다. 자동 로그인 후 화면 이동에 실패했습니다.')
        return
      }

      setMessage('회원가입이 완료되어 자동 로그인됩니다.')
      router.push(getHomeHref(me.roleType))
    } catch (e: any) {
      setError(e?.message || '회원가입 중 오류가 발생했습니다.')
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-shell">
        <div className="panel soft">
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <div className="panel-title">회원가입</div>
          <p className="panel-subtitle">
            이메일을 먼저 확인한 뒤 정보를 입력하면 가입 후 바로 로그인됩니다.
          </p>
        </div>

        <div className="panel form-stack">
          <div className="field">
            <label className="label">이메일</label>
            <div className="row">
              <input
                ref={emailRef}
                className="input"
                value={email}
                autoFocus
                placeholder="name@example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) void checkEmailDuplicate()
                }}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => {
                  if (emailCheckedValue !== email.trim()) {
                    setEmailChecked(false)
                  }
                }}
              />
              <button className="button secondary nowrap" type="button" disabled={loading} onClick={checkEmailDuplicate}>
                {loading ? '확인 중...' : '중복확인'}
              </button>
            </div>
            {emailCheckError ? <div className="message-error small">{emailCheckError}</div> : null}
          </div>

          {emailChecked ? (
            <>
              <div className="field">
                <label className="label">아이디</label>
                <input className="input" value={loginId} onChange={(e) => setLoginId(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">비밀번호 (6자 이상)</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">이름</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">생년월일</label>
                <input
                  ref={birthRef}
                  className="input"
                  value={birthDate}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, '').slice(0, 8)
                    setBirthDate(next)
                    if (next.length === 8) phoneMidRef.current?.focus()
                  }}
                  placeholder="19950710"
                  inputMode="numeric"
                />
              </div>
              <div className="field">
                <label className="label">전화번호</label>
                <div className="row">
                  <input className="input" style={{ maxWidth: 90, textAlign: 'center' }} value="010" disabled />
                  <span className="muted">-</span>
                  <input
                    ref={phoneMidRef}
                    className="input"
                    style={{ maxWidth: 120, textAlign: 'center' }}
                    value={phoneMid}
                    maxLength={4}
                    inputMode="numeric"
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneMid(next)
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
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, '').slice(0, 4)
                      setPhoneLast(next)
                      if (next.length === 4) setTimeout(() => emailRef.current?.focus(), 0)
                    }}
                  />
                </div>
              </div>
              <div className="panel soft">
                <div className="row-between">
                  <span className="label">자동가입방지</span>
                  <button className="button secondary" onClick={refresh}>
                    새로 만들기
                  </button>
                </div>
                <div className="row-between" style={{ marginTop: 12 }}>
                  <div className="card-value">{challengeCode}</div>
                  <input
                    className="input"
                    style={{ maxWidth: 140, textAlign: 'center' }}
                    value={antiBotCode}
                    maxLength={4}
                    onChange={(e) => setAntiBotCode(e.target.value)}
                    placeholder="4자리"
                    inputMode="numeric"
                  />
                </div>
              </div>
              <button className="button" disabled={loading} onClick={onSubmit}>
                {loading ? '처리 중...' : '가입하기'}
              </button>
            </>
          ) : null}

          {error ? <div className="message-error small">{error}</div> : null}
          {message ? <div className="message-success small">{message}</div> : null}
          <div className="small muted">
            이미 계정이 있나요? <Link className="link" href="/v3/login">로그인하기</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
