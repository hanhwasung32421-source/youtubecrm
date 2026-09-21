'use client'

import Link from 'next/link'
import { PageHeader } from '@/components/v2/app-shell'
import { useV2Me } from '@/components/v2/session-context'

// 사용 방법: 직원용 4단계 · 단축키 · 자주 묻는 질문 · (관리자만) 매일 아침 5분 루틴.
// 서버에서 가져오는 것이 없는 정적 화면이라 로딩 없이 바로 보인다.

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: '주소 붙여넣기',
    body: (
      <>
        유튜브에서 영상 주소를 복사해서 「영상 등록」의 주소 칸에 <b>Ctrl+V</b>(맥은 <b>⌘+V</b>)로 붙여 넣어요. 칸 옆의 「붙여넣기」 버튼을 눌러도 돼요. 쇼츠 주소면 형식이 저절로 숏폼이 돼요.
      </>
    )
  },
  {
    title: '종목 적기',
    body: <>어떤 종목 영상인지 종목명을 적어요. 아래 「최근 종목」을 누르면 바로 채워져요. 같은 종목이 이어지면 다음 영상부터는 그대로 두면 돼요.</>
  },
  {
    title: '등록하기',
    body: <>Enter를 누르면 등록돼요. 주소 칸이 비워지니 다음 영상 주소를 바로 붙여 넣으면 돼요. 조회수·좋아요는 자동으로 가져와요.</>
  },
  {
    title: '잘못 넣었다면 되돌리기',
    body: <>등록하고 10초 동안 「되돌리기」가 보여요. 종목만 틀렸다면 「종목 고치기」가 더 빨라요. 시간이 지났다면 아래 목록에서 「수정」이나 「삭제」를 눌러요.</>
  }
]

const SHORTCUTS: { keys: React.ReactNode; what: string }[] = [
  {
    keys: <kbd>Enter</kbd>,
    what: '등록하기'
  },
  {
    keys: (
      <>
        <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd>
      </>
    ),
    what: '어느 칸에 있든 바로 등록'
  },
  {
    keys: <kbd>/</kbd>,
    what: '글을 쓰는 중이 아닐 때 주소 칸으로 이동'
  },
  {
    keys: (
      <>
        주소 칸에서 <kbd>Esc</kbd>
      </>
    ),
    what: '주소 지우기'
  },
  {
    keys: (
      <>
        종목 칸에서 <kbd>Esc</kbd>
      </>
    ),
    what: '종목 지우기 (한 번 더 누르면 주소 칸으로)'
  },
  {
    keys: (
      <>
        주소 칸이 빈 채로 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>
      </>
    ),
    what: '방금 등록한 영상 되돌리기 (10초 안에)'
  }
]

const ROUTINE: { href: string; label: string; minutes: string; what: string }[] = [
  { href: '/v2/report', label: '성과 요약', minutes: '1분', what: '어떤 영상·담당자가 검색에서 잘 되고 있는지 순위로 봐요.' },
  { href: '/v2/optimization', label: '영상 점검', minutes: '2분', what: '점수가 낮은 영상을 찾아서 제목·썸네일을 고칠 영상을 담당자에게 알려요.' },
  { href: '/v2/keywords', label: '키워드 모음', minutes: '1분', what: '오늘 다루면 좋은 검색어를 확인하고, 새 검색어를 추가해요.' },
  { href: '/v2/planner', label: '업로드 계획', minutes: '1분', what: '이번 주에 비어 있는 칸이 없는지 보고, 담당자별 올릴 영상을 정해요.' }
]

export default function HelpPage() {
  const me = useV2Me()

  return (
    <>
      <PageHeader title="사용 방법" />

      <div className="panel v2-help">
        <div className="panel-header">
          <div>
            <h2 className="panel-title v2-panel-h">처음이라면 이 4단계만 기억하세요</h2>
            <p className="panel-subtitle">영상 하나를 등록하는 데 10초면 돼요.</p>
          </div>
          <Link className="button secondary xs" href="/v2/register">
            영상 등록으로 가기
          </Link>
        </div>
        <ol className="v2-help-steps">
          {STEPS.map((step, i) => (
            <li className="v2-help-step" key={step.title}>
              <span className="v2-help-num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <div className="v2-help-step-title">
                  <span className="v2-sr-only">{i + 1}단계. </span>
                  {step.title}
                </div>
                <p className="v2-help-step-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="panel v2-help">
        <div className="panel-header">
          <div>
            <h2 className="panel-title v2-panel-h">단축키</h2>
            <p className="panel-subtitle">키보드를 쓰면 손을 떼지 않고 빠르게 등록할 수 있어요.</p>
          </div>
        </div>
        <dl className="v2-help-keys">
          {SHORTCUTS.map((item, i) => (
            <div className="v2-help-key-row" key={i}>
              <dt>{item.keys}</dt>
              <dd>{item.what}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="panel v2-help">
        <div className="panel-header">
          <div>
            <h2 className="panel-title v2-panel-h">자주 묻는 질문</h2>
          </div>
        </div>
        <div className="v2-faq">
          <details>
            <summary>같은 영상을 두 번 올리면 어떻게 되나요?</summary>
            <p>
              내가 이미 등록한 영상이면 새로 만들지 않고 종목만 바꿔요. 종목도 같다면 아무 일도 일어나지 않아요. 다른 담당자가 먼저 등록한 영상이면 확인 창이 떠요. 그대로 등록하면 그 영상이 내 영상으로 바뀌고 그 담당자 목록에서는 빠져요. 이런 경우에는 「되돌리기」가 나오지 않아요.
            </p>
          </details>
          <details>
            <summary>숏폼(쇼츠) 주소는 어떻게 넣나요?</summary>
            <p>
              <code>youtube.com/shorts/…</code> 주소를 그대로 붙여 넣으면 돼요. 형식이 자동으로 「숏폼」으로 바뀌어요. 잘못 바뀌었다면 「형식」에서 다시 골라 주세요.
            </p>
          </details>
          <details>
            <summary>조회수는 언제 보이나요?</summary>
            <p>
              영상을 등록하는 순간 유튜브에서 가져와요. 방금 올린 영상은 유튜브에서도 숫자가 아직 적어요. 계속 0이거나 제목이 「불러오는 중」으로 남아 있으면 관리자에게 알려 주세요.
            </p>
          </details>
          <details>
            <summary>로그아웃됐어요. 적어 둔 내용은 어떻게 되나요?</summary>
            <p>
              한참 자리를 비우면 로그인이 끊길 수 있어요. 등록하려는 순간 끊겼다면 「다시 로그인」 버튼이 나와요. 누르고 로그인하면 하던 화면으로 돌아오고, 적어 둔 주소와 종목도 그대로 채워져 있어요(30분 안). 아이디나 비밀번호가 기억나지 않으면 관리자에게 알려 주세요.
            </p>
          </details>
          <details>
            <summary>영상이 많아요. 한 번에 올릴 수 있나요?</summary>
            <p>
              주소 칸에 주소를 여러 줄 한꺼번에 붙여 넣으면 「여러 개 한 번에 붙여넣기」 화면으로 바뀌어요. 한 줄에 「주소 종목명」을 적으면 종목도 함께 채워져요.
            </p>
          </details>
        </div>
      </div>

      {me.isAdmin ? (
        <div className="panel v2-help">
          <div className="panel-header">
            <div>
              <h2 className="panel-title v2-panel-h">매일 아침 5분 루틴 (관리자)</h2>
              <p className="panel-subtitle">이 순서로 열어 보면 오늘 챙길 것이 정리돼요.</p>
            </div>
          </div>
          <ol className="v2-help-steps">
            {ROUTINE.map((item, i) => (
              <li className="v2-help-step" key={item.href}>
                <span className="v2-help-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <div className="v2-help-step-title">
                    <Link className="link" href={item.href}>
                      {item.label}
                    </Link>{' '}
                    <span className="muted v2-help-min">· {item.minutes}</span>
                  </div>
                  <p className="v2-help-step-body">{item.what}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  )
}
