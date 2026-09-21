'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'
import { fetchMe } from '@/lib/session/me-client'
import { getHomeHref } from '@/lib/v3/menu'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    if (loading) return
    setError('')
    if (!email.trim() || !password) {
      setError(!email.trim() ? '아이디를 입력해 주세요.' : '비밀번호를 입력해 주세요.')
      return
    }
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
          setError(data?.error || '아이디를 찾을 수 없습니다.')
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
        setError('아이디 또는 비밀번호가 맞지 않습니다. 다시 확인해 주세요.')
        return
      }

      // 로그인 기록은 화면 전환을 막을 이유가 없으니 결과를 기다리지 않는다.
      void fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` }
      })

      const me = await fetchMe(data.session.access_token)
      router.push(getHomeHref(me.roleType))
    } catch (e: any) {
      setError(e?.message || '로그인 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-center">
        <form
          className="panel form-stack"
          style={{ width: '100%', maxWidth: 520 }}
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
        >
          <img className="auth-logo" src="/logo-ant.png" alt="" width={56} height={56} />
          <h1 className="auth-title">여왕개미미디어 CRM</h1>
          <p className="auth-subtitle">영상 등록과 시청자 반응 확인을 한 곳에서</p>
          <div className="field">
            <label className="label">아이디</label>
            <input
              className="input"
              value={email}
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">비밀번호</label>
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="button" type="submit" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
          {error ? <div className="message-error small">{error}</div> : null}
          <div className="small muted">
            처음 사용하시나요? <Link className="link" href="/v3/signup">회원가입</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
