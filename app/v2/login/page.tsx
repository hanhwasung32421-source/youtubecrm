'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref, isAdminRoleType } from '@/lib/v2/menu'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const idRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    idRef.current?.focus()
  }, [])

  const onSubmit = async () => {
    setError('')
    setLoading(true)

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
        setError('아이디 또는 비밀번호가 맞지 않아요. 다시 확인해 주세요.')
        return
      }

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` }
      })

      // 관리자는 성과 요약, 직원은 영상 등록 화면에서 시작한다.
      const me = await fetchMe(data.session.access_token)
      router.push(getHomeHref(isAdminRoleType(me.roleType)))
    } catch (e: any) {
      setError(e?.message || '로그인 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-center">
        <div className="panel form-stack" style={{ width: '100%', maxWidth: 520 }}>
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <h1 className="auth-title">여왕개미미디어 CRM</h1>
          <p className="auth-subtitle">검색에 잘 걸리는 영상 관리</p>
          <div className="field">
            <label className="label" htmlFor="v2-login-id">아이디</label>
            <input
              id="v2-login-id"
              ref={idRef}
              className="input"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSubmit()
              }}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="v2-login-pw">비밀번호</label>
            <input
              id="v2-login-pw"
              className="input"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSubmit()
              }}
            />
          </div>
          <button className="button" disabled={loading} onClick={onSubmit}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
          {error ? <div className="message-error small">{error}</div> : null}
          <div className="small muted">
            계정이 없나요? <Link className="link" href="/v2/signup">회원가입</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
