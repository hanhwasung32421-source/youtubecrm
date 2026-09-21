// 잠깐 비어 보이는 화면 대신 보여 주는 가벼운 뼈대(회색 블록). 실제 내용과 같은 높이로 잡아서
// 내용이 들어올 때 화면이 아래로 밀리지 않게 한다. 반짝임은 prefers-reduced-motion에서 꺼진다(theme.css).

export function Skel({ w, h = 14, r, style }: { w?: number | string; h?: number | string; r?: number | string; style?: React.CSSProperties }) {
  return <span className="v3-skel" aria-hidden style={{ width: w, height: h, borderRadius: r, ...style }} />
}

// 화면에는 안 보이고 스크린리더에만 읽히는 "불러오는 중"
export function BusyLabel({ children = '불러오는 중이에요' }: { children?: React.ReactNode }) {
  return <span className="v3-sr-only">{children}</span>
}

// 페이지 전체가 준비되기 전(로그인 확인 중): 제목 + 블록 몇 개
export function PageSkeleton() {
  return (
    <div className="v3-skel-page" aria-busy="true">
      <BusyLabel />
      <div className="v3-skel-head">
        <Skel w="38%" h={30} r={8} />
        <Skel w="62%" h={14} style={{ marginTop: 12 }} />
      </div>
      <Skel h={88} r={10} />
      <Skel h={160} r={10} />
    </div>
  )
}

// 내가 등록한 영상 목록이 오는 동안: 실제 줄(.v3-vrow)과 같은 높이의 줄 몇 개
export function VideoListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="data-table v3-vtable" aria-busy="true">
      <BusyLabel>내가 등록한 영상 목록을 불러오는 중이에요</BusyLabel>
      <div className="v3-skel-rows">
        {Array.from({ length: rows }, (_, i) => (
          <div className="v3-skel-row" key={i}>
            <Skel w={44} h={14} />
            <div className="v3-skel-stack">
              <Skel w={i % 2 ? '70%' : '86%'} h={14} />
              <Skel w={64} h={12} />
            </div>
            <Skel w={44} h={22} r={4} />
          </div>
        ))}
      </div>
    </div>
  )
}

// 링크 미리보기 자리(주소를 붙여넣고 잠시 기다리는 동안)
export function PreviewSkeleton() {
  return (
    <div className="v3-reg-preview" aria-hidden>
      <Skel w={64} h={36} r={4} />
      <Skel w="55%" h={14} />
    </div>
  )
}

// 사이드바 메뉴가 준비되기 전(역할에 따라 순서가 달라서 그때까지 자리만 잡는다)
export function NavSkeleton() {
  return (
    <div className="v3-nav-skel" aria-busy="true">
      <BusyLabel>메뉴를 불러오는 중이에요</BusyLabel>
      {[70, 56, 64, 78, 92].map((w, i) => (
        <Skel key={i} w={`${w}%`} h={30} r={8} />
      ))}
    </div>
  )
}
