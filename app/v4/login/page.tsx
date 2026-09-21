'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { homeHrefForRole } from '@/lib/v4/menu'
import { PasswordField } from '@/components/v4/password-field'
import { readStorage, writeStorage } from '@/components/v4/register-utils'

// 마지막에 쓴 아이디만 이 기기에 기억한다. 비밀번호는 절대 저장하지 않는다.
const LAST_ID_KEY = 'v4.login.lastId'
const REMEMBER_KEY = 'v4.login.remember'

function forgetLastId() {
  try {
    window.localStorage.removeItem(LAST_ID_KEY)
  } catch {
    // 저장이 막힌 환경이면 넘어간다.
  }
}

// Supabase 가 주는 영어 문구를 쉬운 한국어로 바꾼다.
function friendlyLoginError(raw?: string | null) {
  const text = String(raw || '')
  if (/invalid login credentials|invalid_credentials/i.test(text)) return '아이디 또는 비밀번호가 맞지 않아요. 다시 확인해 주세요.'
  if (/email not confirmed/i.test(text)) return '이메일 확인이 아직 끝나지 않았어요.'
  if (/rate limit|too many/i.test(text)) return '시도가 너무 많아요. 잠시 후 다시 해 주세요.'
  if (/network|failed to fetch/i.test(text)) return '인터넷 연결을 확인해 주세요.'
  return text || '로그인에 실패했습니다.'
}

export default function LoginPage() {
  const router = useRouter()
  const idRef = useRef<HTMLInputElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const focusAfterRef = useRef<'id' | 'pw' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 처음 열 때: 지난번 아이디를 채우고, 있으면 곧장 비밀번호 칸으로 (없으면 아이디 칸으로)
  useEffect(() => {
    const savedRemember = readStorage(REMEMBER_KEY)
    const keep = savedRemember !== 'off'
    setRemember(keep)
    const savedId = keep ? readStorage(LAST_ID_KEY) : null
    if (savedId) {
      setEmail(savedId)
      window.setTimeout(() => pwRef.current?.focus(), 0)
    } else {
      idRef.current?.focus()
    }
  }, [])

  // 입력 칸은 로그인 중에 잠겨 있으므로, 풀린 다음에 커서를 옮긴다.
  useEffect(() => {
    if (loading || !focusAfterRef.current) return
    const target = focusAfterRef.current === 'id' ? idRef.current : pwRef.current
    focusAfterRef.current = null
    target?.focus()
    target?.select()
  }, [loading])

  const onSubmit = async () => {
    if (submittingRef.current) return
    const loginId = email.trim()
    if (!loginId) {
      setError('아이디를 입력해 주세요.')
      idRef.current?.focus()
      return
    }
    if (!password) {
      setError('비밀번호를 입력해 주세요.')
      pwRef.current?.focus()
      return
    }

    submittingRef.current = true
    setError('')
    setLoading(true)
    let navigating = false

    try {
      let loginEmail = loginId

      if (!loginEmail.includes('@')) {
        const res = await fetch('/api/auth/resolve-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loginId: loginEmail })
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || '아이디를 찾을 수 없습니다.')
          focusAfterRef.current = 'id'
          return
        }
        loginEmail = data.email
      }

      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password
      })

      if (error || !data.session?.access_token) {
        setError(friendlyLoginError(error?.message))
        focusAfterRef.current = 'pw' // 비밀번호는 지우지 않는다 ("보기"로 확인하고 고칠 수 있게)
        return
      }

      // 성공했을 때만 아이디를 기억한다 (원하지 않으면 지운다).
      writeStorage(REMEMBER_KEY, remember ? 'on' : 'off')
      if (remember) writeStorage(LAST_ID_KEY, loginId)
      else forgetLastId()

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` }
      })

      // 직원은 매일 하는 영상 등록, 관리자는 성장 현황이 첫 화면.
      const me = await fetchMe(data.session.access_token)
      navigating = true
      router.push(homeHrefForRole(me.roleType))
    } catch (e: any) {
      setError(e?.message || '로그인 중 오류가 발생했습니다.')
    } finally {
      submittingRef.current = false
      // 이동 중에는 버튼을 계속 잠가 두어 두 번 눌리지 않게 한다.
      if (!navigating) setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-center">
        <form
          className="panel form-stack v4-auth-card"
          noValidate
          aria-busy={loading || undefined}
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
        >
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <h1 className="auth-title">여왕개미미디어 CRM</h1>
          <p className="auth-subtitle">영상을 등록하고, 무엇이 잘 되는지 확인하는 공간입니다.</p>
          <fieldset className="v4-auth-fields" disabled={loading}>
            <div className="field">
              <label className="label" htmlFor="v4-login-id">
                아이디
              </label>
              <input
                id="v4-login-id"
                ref={idRef}
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="아이디 또는 이메일"
                value={email}
                aria-invalid={error && !email.trim() ? true : undefined}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (error) setError('')
                }}
              />
            </div>
            <PasswordField
              id="v4-login-pw"
              label="비밀번호"
              autoComplete="current-password"
              value={password}
              inputRef={pwRef}
              invalid={Boolean(error && !password)}
              onChange={(next) => {
                setPassword(next)
                if (error) setError('')
              }}
            />
            <label className="v4-check" htmlFor="v4-login-remember">
              <input id="v4-login-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>이 기기에서 아이디 기억하기 (비밀번호는 저장하지 않아요)</span>
            </label>
            <button className="button v4-auth-submit" type="submit" disabled={loading}>
              {loading ? '로그인 중…' : '로그인'}
            </button>
          </fieldset>
          <div className="v4-auth-msg">
            {error ? (
              <div className="message-error small" role="alert">
                {error}
              </div>
            ) : null}
          </div>
          <div className="small muted">
            계정이 없나요? <Link className="link" href="/v4/signup">회원가입</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
