// 불러오는 동안 "곧 이런 모양이 나타나요"를 보여주는 뼈대 화면.
// 반짝임(shimmer)은 CSS(.v4-skel)에 있고, 움직임 줄이기 설정이면 멈춘다.
// 화면 낭독기에는 뼈대 조각은 숨기고 "불러오는 중" 한 마디만 알려준다.

import type { CSSProperties } from 'react'

export function Skel({ w, h = 14, r, style, className = '' }: { w?: number | string; h?: number | string; r?: number | string; style?: CSSProperties; className?: string }) {
  return <span aria-hidden="true" className={`v4-skel ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />
}

// 감싸는 영역: 스크린리더에 한 번만 "불러오는 중"을 알린다.
export function SkelRegion({ label = '불러오는 중', children, className = '' }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="v4-sr">{label}</span>
      {children}
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div className="metric-card v4-kpi v4-kpi-skel" aria-hidden="true">
      <Skel w={72} h={12} />
      <Skel w="62%" h={30} style={{ marginTop: 14 }} />
      <Skel w="88%" h={12} style={{ marginTop: 14 }} />
    </div>
  )
}

export function ListSkeleton({ rows = 5, thumb = false }: { rows?: number; thumb?: boolean }) {
  return (
    <SkelRegion className="v4-skel-list">
      {Array.from({ length: rows }, (_, i) => (
        <div className={`v4-skel-row ${thumb ? 'with-thumb' : ''}`} key={i} aria-hidden="true">
          {thumb ? <Skel w={72} h={42} r={8} /> : null}
          <div className="v4-skel-row-main">
            <Skel w={`${68 - (i % 3) * 12}%`} h={14} />
            <Skel w={`${38 + (i % 2) * 10}%`} h={11} style={{ marginTop: 8 }} />
          </div>
          <Skel w={48} h={14} />
        </div>
      ))}
    </SkelRegion>
  )
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <SkelRegion>
      <Skel h={height} r={12} style={{ display: 'block', width: '100%' }} />
    </SkelRegion>
  )
}

export function HeroSkeleton() {
  return (
    <SkelRegion>
      <div aria-hidden="true">
        <Skel w={72} h={12} />
        <Skel w="92%" h={22} style={{ marginTop: 14, display: 'block' }} />
        <Skel w="70%" h={22} style={{ marginTop: 8, display: 'block' }} />
        <Skel w="54%" h={14} style={{ marginTop: 14, display: 'block' }} />
      </div>
    </SkelRegion>
  )
}
