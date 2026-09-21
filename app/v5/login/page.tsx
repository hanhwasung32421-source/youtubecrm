'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v5/menu'
import { readNextFromSearch } from '@/components/v5/register-logic'
import { useHomeRedirect } from '@/components/v5/use-home-redirect'
import { PasswordField } from '@/components/v5/password-field'
import { Skeleton, SkeletonRegion } from '@/components/v5/widget'

// 마지막으로 쓴 "아이디"만 이 기기에 기억한다. 비밀번호는 절대 저장하지 않는다.
const LS_LAST_ID = 'v5.login.lastId'
const LS_REMEMBER = 'v5.login.remember'

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {}
}

export default function LoginPage() {
  const router = useRouter()
  // 이미 로그인돼 있으면 역할에 맞는 첫 화면으로 바로 보낸다.
  const checking = useHomeRedirect()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [returning, setReturning] = useState(false) // 하던 화면으로 돌아가는 로그인인가(?next=)
  const idRef = useRef<HTMLInputElement | null>(null)
  const pwRef = useRef<HTMLInputElement | null>(null)
  const submittingRef = useRef(false)

  // 확인이 끝나 폼이 보일 때: 기억해 둔 아이디가 있으면 채우고 비밀번호 칸으로, 없으면 아이디 칸으로.
  useEffect(() => {
    if (checking) return
    setReturning(readNextFromSearch(window.location.search) !== null)
    const saved = readStorage(LS_LAST_ID)
    const wantsRemember = readStorage(LS_REMEMBER) !== '0'
    setRemember(wantsRemember)
    if (saved && wantsRemember) {
      setEmail(saved)
      pwRef.current?.focus()
    } else {
      idRef.current?.focus()
    }
  }, [checking])

  const onSubmit = async () => {
    if (loading || submittingRef.current) return
    setError('')
    if (!email.trim()) {
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
    setLoading(true)
    let moved = false

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
          setError(data?.error || '아이디를 찾을 수 없어요. 다시 확인해 주세요.')
          idRef.current?.focus()
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
        setError('아이디나 비밀번호가 맞지 않아요. 다시 확인해 주세요.')
        setPassword('')
        pwRef.current?.focus()
        return
      }

      // 아이디만 기억한다(체크를 끄면 지운다).
      writeStorage(LS_REMEMBER, remember ? '1' : '0')
      writeStorage(LS_LAST_ID, remember ? email.trim() : null)

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` }
      })

      // 하던 화면(?next=/v5/…, 같은 사이트의 V5 화면만 허용)이 있으면 그곳으로, 없으면
      // 직원 = 영상 등록, 관리자 = 성장 실험 화면으로.
      const me = await fetchMe(data.session.access_token)
      moved = true // 화면이 바뀔 때까지 버튼을 계속 잠가 둔다.
      router.replace(readNextFromSearch(window.location.search) ?? getHomeHref(me.roleType))
    } catch (e: any) {
      setError(e instanceof TypeError ? '인터넷 연결을 확인해 주세요.' : typeof e?.message === 'string' && /[가-힣]/.test(e.message) ? e.message : '로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    } finally {
      if (!moved) {
        submittingRef.current = false
        setLoading(false)
      }
    }
  }

  if (checking) {
    return (
      <div className="auth-wrap">
        <div className="auth-center">
          <SkeletonRegion label="로그인 상태를 확인하는 중" className="panel form-stack v5-auth-card">
            <Skeleton circle height={56} className="v5-auth-skel-logo" />
            <Skeleton height={22} width="60%" className="v5-auth-skel-center" />
            <Skeleton height={48} radius={10} />
            <Skeleton height={48} radius={10} />
            <Skeleton height={48} radius={10} />
          </SkeletonRegion>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth-center">
        <form
          className="panel form-stack v5-auth-card"
          aria-busy={loading}
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
        >
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <h1 className="auth-title">여왕개미미디어</h1>
          <p className="auth-subtitle">{returning ? '로그인이 풀렸어요. 다시 로그인하면 하던 화면으로 돌아가요.' : '영상 등록부터 성장 관리까지, 한곳에서'}</p>
          <div className="field">
            <label className="label" htmlFor="v5-login-id">
              아이디
            </label>
            <input
              id="v5-login-id"
              ref={idRef}
              className="input"
              value={email}
              disabled={loading}
              onChange={(e) => {
                setEmail(e.target.value)
                if (error) setError('')
              }}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              aria-describedby={error ? 'v5-login-error' : undefined}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="v5-login-pw">
              비밀번호
            </label>
            <PasswordField
              id="v5-login-pw"
              inputRef={pwRef}
              value={password}
              disabled={loading}
              autoComplete="current-password"
              describedBy={error ? 'v5-login-error' : undefined}
              onChange={(v) => {
                setPassword(v)
                if (error) setError('')
              }}
            />
          </div>
          <label className="v5-check v5-remember">
            <input type="checkbox" checked={remember} disabled={loading} onChange={(e) => setRemember(e.target.checked)} />
            <span>이 기기에서 아이디 기억하기</span>
          </label>
          <button className="button v5-submit" type="submit" disabled={loading} aria-busy={loading}>
            {loading ? (
              '로그인 중...'
            ) : (
              '로그인'
            )}
          </button>
          <div id="v5-login-error">
            {error ? (
              <div className="message-error small" role="alert">
                {error}
              </div>
            ) : null}
          </div>
          <div className="small muted">
            계정이 없나요?{' '}
            <Link className="link" href="/v5/signup">
              회원가입
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
