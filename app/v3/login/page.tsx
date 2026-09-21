'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v3/menu'
import { PasswordField } from '@/components/v3/password-field'
import { LAST_LOGIN_ID_KEY, readSafe, writeSafe } from '@/components/v3/safe-storage'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<'id' | 'pw' | null>(null)
  const [remembered, setRemembered] = useState(false)
  const [loading, setLoading] = useState(false)
  const busy = useRef(false) // Enter와 클릭이 겹쳐도 한 번만 로그인 요청
  const idRef = useRef<HTMLInputElement | null>(null)
  const pwRef = useRef<HTMLInputElement | null>(null)

  // 지난번에 쓴 아이디를 채워 두고(비밀번호는 저장하지 않는다), 커서는 비어 있는 쪽으로
  useEffect(() => {
    const saved = readSafe(LAST_LOGIN_ID_KEY)
    if (saved) {
      setEmail(saved)
      setRemembered(true)
      pwRef.current?.focus()
    } else {
      idRef.current?.focus()
    }
  }, [])

  const fail = (message: string, field: 'id' | 'pw') => {
    setError(message)
    setErrorField(field)
    window.setTimeout(() => (field === 'id' ? idRef : pwRef).current?.focus(), 0)
  }

  const onSubmit = async () => {
    if (busy.current) return
    setError('')
    setErrorField(null)
    if (!email.trim() || !password) {
      if (!email.trim()) fail('아이디를 입력해 주세요.', 'id')
      else fail('비밀번호를 입력해 주세요.', 'pw')
      return
    }
    busy.current = true
    setLoading(true)
    let leaving = false

    try {
      let loginEmail = email.trim()
      const loginPassword = password

      if (!loginEmail.includes('@')) {
        const res = await fetch('/api/auth/resolve-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loginId: loginEmail })
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          fail(data?.error || '아이디를 찾을 수 없습니다.', 'id')
          return
        }
        loginEmail = data.email
      }

      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword
      })

      if (error || !data.session?.access_token) {
        fail('아이디 또는 비밀번호가 맞지 않습니다. 다시 확인해 주세요.', 'pw')
        return
      }

      writeSafe(LAST_LOGIN_ID_KEY, email.trim())

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` }
      })

      const me = await fetchMe(data.session.access_token)
      leaving = true // 화면이 넘어가는 동안 버튼을 다시 열지 않는다(중복 로그인 방지)
      router.push(getHomeHref(me.roleType))
    } catch (e: any) {
      fail(e?.message || '로그인 중 오류가 발생했습니다.', 'pw')
    } finally {
      if (!leaving) {
        busy.current = false
        setLoading(false)
      }
    }
  }

  return (
    <div className="auth-wrap v3-auth">
      <div className="auth-center">
        <form
          className="panel form-stack"
          style={{ width: '100%', maxWidth: 520 }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
        >
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <h1 className="auth-title">여왕개미미디어 CRM</h1>
          <p className="auth-subtitle">영상 등록과 시청자 반응 확인을 한 곳에서</p>
          <div className="field">
            <label className="label" htmlFor="v3-login-id">아이디</label>
            <input
              id="v3-login-id"
              ref={idRef}
              className={`input ${errorField === 'id' ? 'invalid' : ''}`}
              value={email}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              readOnly={loading}
              aria-invalid={errorField === 'id' || undefined}
              aria-describedby={remembered ? 'v3-login-id-help' : undefined}
              onChange={(e) => {
                setEmail(e.target.value)
                setRemembered(false)
              }}
            />
            {remembered ? <div id="v3-login-id-help" className="v3-field-help">지난번에 쓴 아이디를 채워 뒀어요.</div> : null}
          </div>
          <PasswordField
            id="v3-login-pw"
            label="비밀번호"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            readOnly={loading}
            invalid={errorField === 'pw'}
            inputRef={(el) => {
              pwRef.current = el
            }}
          />
          <button className="button v3-submit" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="v3-spinner" aria-hidden /> 로그인 중…
              </>
            ) : (
              '로그인'
            )}
          </button>
          <div role="alert">{error ? <div className="message-error small">{error}</div> : null}</div>
          <div className="small muted">
            처음 사용하시나요? <Link className="link" href="/v3/signup">회원가입</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
