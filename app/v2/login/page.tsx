'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PasswordField } from '@/components/v2/password-field'
import { safeNextPath } from '@/components/v2/register-flow'
import { setCachedV2Me } from '@/components/v2/session-context'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { clearMeCache, fetchMe } from '@/lib/session/me-client'
import { getHomeHref, isAdminRoleType } from '@/lib/v2/menu'

// 마지막으로 로그인한 "아이디"만 이 기기에 기억한다. 비밀번호는 절대 저장하지 않는다.
const LAST_ID_KEY = 'v2.login.lastId'
const REMEMBER_KEY = 'v2.login.rememberId'

function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // 저장소를 못 써도 로그인에는 영향 없음
  }
}

function readNextPath(): string | null {
  try {
    return safeNextPath(new URLSearchParams(window.location.search).get('next'))
  } catch {
    return null
  }
}

type ErrorField = 'id' | 'pw' | null

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberId, setRememberId] = useState(true)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<ErrorField>(null)
  const [loading, setLoading] = useState(false)
  const idRef = useRef<HTMLInputElement | null>(null)
  const pwRef = useRef<HTMLInputElement | null>(null)
  const busyRef = useRef(false)
  // 로그인이 끊겨서 온 경우(?next=/v2/...) 로그인 뒤 하던 화면으로 돌려보낸다. 같은 사이트의 /v2/ 아래 주소만 받는다.
  const [returning, setReturning] = useState(false)

  // 로그인 화면에 들어오면 이전 사용자의 메모리 캐시는 항상 비운다.
  useEffect(() => {
    clearMeCache()
    setCachedV2Me(null)
    setReturning(readNextPath() !== null)
    const remember = readStored(REMEMBER_KEY) !== '0'
    setRememberId(remember)
    const last = remember ? readStored(LAST_ID_KEY) : ''
    if (last) {
      setEmail(last)
      pwRef.current?.focus()
    } else {
      idRef.current?.focus()
    }
  }, [])

  const fail = (text: string, field: ErrorField) => {
    setError(text)
    setErrorField(field)
    const target = field === 'pw' ? pwRef.current : idRef.current
    target?.focus()
    if (field === 'pw') target?.select()
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Enter와 버튼 클릭이 겹쳐도 요청은 한 번만 보낸다.
    if (busyRef.current) return

    const loginId = email.trim()
    if (!loginId) {
      fail('아이디를 입력해 주세요.', 'id')
      return
    }
    if (!password) {
      fail('비밀번호를 입력해 주세요.', 'pw')
      return
    }

    busyRef.current = true
    setError('')
    setErrorField(null)
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
          fail(data?.error || '아이디를 찾을 수 없어요. 다시 확인해 주세요.', 'id')
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
        fail('아이디 또는 비밀번호가 맞지 않아요. 다시 확인해 주세요.', 'pw')
        return
      }

      writeStored(REMEMBER_KEY, rememberId ? '1' : '0')
      writeStored(LAST_ID_KEY, rememberId ? loginId : null)

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` }
      })

      // 관리자는 성과 요약, 직원은 영상 등록 화면에서 시작한다.
      const me = await fetchMe(data.session.access_token)
      navigating = true
      router.push(readNextPath() ?? getHomeHref(isAdminRoleType(me.roleType)))
    } catch (err: unknown) {
      fail(err instanceof Error && err.message ? err.message : '로그인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.', null)
    } finally {
      // 화면이 넘어가는 중에는 버튼을 계속 잠가 두어 두 번 누르는 일을 막는다.
      if (!navigating) {
        busyRef.current = false
        setLoading(false)
      }
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-center">
        <form className="panel form-stack v2-auth-panel" onSubmit={onSubmit} noValidate aria-busy={loading}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <h1 className="auth-title">여왕개미미디어 CRM</h1>
          <p className="auth-subtitle">검색에 잘 걸리는 영상 관리</p>
          {returning ? (
            <div className="v2-return-note small" role="status">
              로그인하면 하던 화면으로 바로 돌아가요.
            </div>
          ) : null}

          <div className="field">
            <label className="label" htmlFor="v2-login-id">
              아이디
            </label>
            <input
              id="v2-login-id"
              ref={idRef}
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              value={email}
              readOnly={loading}
              aria-invalid={errorField === 'id' ? true : undefined}
              aria-describedby={errorField === 'id' && error ? 'v2-login-error' : undefined}
              onChange={(e) => {
                setEmail(e.target.value)
                if (errorField === 'id') {
                  setError('')
                  setErrorField(null)
                }
              }}
            />
          </div>

          <PasswordField
            id="v2-login-pw"
            label="비밀번호"
            value={password}
            onChange={(v) => {
              setPassword(v)
              if (errorField === 'pw') {
                setError('')
                setErrorField(null)
              }
            }}
            autoComplete="current-password"
            inputRef={pwRef}
            readOnly={loading}
            invalid={errorField === 'pw'}
            describedBy={errorField === 'pw' && error ? 'v2-login-error' : undefined}
          />

          <label className="v2-check-line">
            <input type="checkbox" checked={rememberId} disabled={loading} onChange={(e) => setRememberId(e.target.checked)} />
            <span>이 기기에서 아이디 기억하기 (비밀번호는 저장하지 않아요)</span>
          </label>

          {error ? (
            <div className="message-error small" id="v2-login-error" role="alert">
              {error}
            </div>
          ) : null}

          <button className="button v2-submit" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="v2-spin" aria-hidden="true" /> 로그인 중…
              </>
            ) : (
              '로그인'
            )}
          </button>

          <div className="small muted">
            계정이 없나요?{' '}
            <Link className="link" href="/v2/signup">
              회원가입
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
