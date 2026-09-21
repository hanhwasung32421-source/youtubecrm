'use client'

import { V3_SQL_FILE } from '@/lib/v3/tables'

// ── 샘플 데이터 배너 ────────────────────────────────────────────
// 한 줄로 조용히: 지금 보는 숫자가 예시이고, 무엇을 하면 실제 데이터로 바뀌는지만 알려준다.
export function SampleBanner({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="v3-sample-banner" role="status">
      <span>
        예시 데이터를 보고 있어요. 실제 데이터를 보려면 관리자가 <code>{V3_SQL_FILE}</code> 설정을 먼저 끝내야 해요.
      </span>
    </div>
  )
}

// ── 문서 섹션 ──────────────────────────────────────────────────
export function Section({
  title,
  count,
  description,
  actions,
  children
}: {
  title: string
  count?: number
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="v3-section">
      <div className="v3-section-head">
        <div>
          <h2 className="v3-section-title">
            {title}
            {typeof count === 'number' ? <span className="v3-count">{count}</span> : null}
          </h2>
          {description ? <p className="v3-section-desc">{description}</p> : null}
        </div>
        {actions ? <div className="toolbar">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

// ── 태그 ───────────────────────────────────────────────────────
export function Tag({ tone = 'gray', children }: { tone?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'gray'; children: React.ReactNode }) {
  return <span className={`v3-tag ${tone}`}>{children}</span>
}

// ── 빈 상태: 무엇을 보는 곳인지 + 무엇을 하면 되는지 + (선택) 버튼 ─────────
export function EmptyState({ children, title, action }: { children?: React.ReactNode; title?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      {title ? <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div> : null}
      {children}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  )
}
