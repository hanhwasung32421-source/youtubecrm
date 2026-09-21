// 불러오는 동안 "빈 화면"이나 "불러오는 중…" 글자 대신 보여 주는 가벼운 뼈대(shimmer는 CSS, 움직임 줄이기 설정을 따름).
// 실제 화면과 같은 자리·비슷한 높이로 그려서 데이터가 들어와도 화면이 출렁이지 않게 한다.

export function Skel({ w, h = 14, className = '' }: { w?: number | string; h?: number | string; className?: string }) {
  return <span className={`v2-skel ${className}`} style={{ width: w, height: h }} aria-hidden="true" />
}

// 스크린리더용 안내(화면에는 안 보임)
export function SkelStatus({ label = '불러오는 중' }: { label?: string }) {
  return (
    <span className="v2-sr-only" role="status">
      {label}
    </span>
  )
}

// 로그인 확인 중: 사이드바(메뉴 알약 + 계정)와 본문 자리를 미리 잡아 둔다.
export function ShellSkeleton() {
  return (
    <div className="workspace v2-shell-skel" aria-busy="true">
      <aside className="sidebar v2-sidebar">
        <div className="sidebar-section v2-sidebar-brand">
          <span className="v2-brand-line">여왕개미미디어</span>
          <div className="small muted v2-brand-tag">검색에 잘 걸리는 영상 관리</div>
        </div>
        <div className="v2-navwrap">
          <div className="sidebar-section v2-navgroup">
            <div className="sidebar-nav">
              <Skel className="v2-skel-pill" />
              <Skel className="v2-skel-pill" />
              <Skel className="v2-skel-pill" />
            </div>
          </div>
        </div>
        <div className="sidebar-section v2-account-section">
          <div className="v2-account">
            <Skel w={72} h={16} />
            <Skel w={40} h={12} className="v2-skel-gap" />
          </div>
          <Skel className="v2-skel-btn" />
        </div>
      </aside>
      <section className="content-area">
        <div className="document-head">
          <Skel w="38%" h={28} />
          <Skel w="70%" h={14} className="v2-skel-gap" />
        </div>
        <div className="panel">
          <Skel w="30%" h={16} />
          <Skel h={46} className="v2-skel-gap" />
          <Skel h={46} className="v2-skel-gap" />
        </div>
        <SkelStatus />
      </section>
    </div>
  )
}

// 내가 등록한 영상 목록: 실제 한 줄(제목 + 메타 + 버튼)과 비슷한 높이의 줄 몇 개
export function VideoListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="list v2-vlist" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="list-item v2-vrow v2-vrow-skel" key={i} aria-hidden="true">
          <Skel w={i % 2 === 0 ? '62%' : '48%'} h={16} />
          <Skel w="80%" h={12} className="v2-skel-gap" />
        </div>
      ))}
      <SkelStatus label="등록한 영상을 불러오는 중" />
    </div>
  )
}
