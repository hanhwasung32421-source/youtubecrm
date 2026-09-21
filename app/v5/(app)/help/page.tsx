'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Badge } from '@/components/v5/widget'

// 사용 방법: 직원용 "영상 등록" 4단계 + 단축키 + 자주 묻는 질문, 관리자용 "매일 아침 5분 루틴".
// 글이 전부 이 파일 안에 있어서 고치기 쉽다. 짧고 훑어보기 좋게 유지할 것.

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: '주소 붙여넣기',
    body: '유튜브 영상에서 ‘공유 → 링크 복사’를 누르고, 등록 화면의 주소칸에 붙여 넣어요. ‘붙여넣기’ 버튼이나 Ctrl+V 둘 다 돼요.'
  },
  {
    title: '종목 적기',
    body: '주소를 붙이면 커서가 종목 칸으로 넘어가요. 종목 이름을 적어요(예: 삼성전자). 아래 ‘최근 종목’ 버튼을 누르면 다시 적지 않아도 돼요.'
  },
  {
    title: '등록하기',
    body: 'Enter를 누르면 등록돼요. 제목·조회수·좋아요·댓글은 자동으로 가져와요. 끝나면 커서가 주소칸으로 돌아오니 다음 영상을 바로 붙여 넣으세요.'
  },
  {
    title: '되돌리기',
    body: '잘못 올렸다면 등록 직후 10초 안에 ‘되돌리기’를 눌러요. 종목만 틀렸다면 ‘종목 고치기’로 바로 바꿀 수 있어요. 시간이 지났다면 아래 목록의 ‘수정’ ‘삭제’를 쓰세요.'
  }
]

const SHORTCUTS: Array<{ keys: string[]; text: string }> = [
  { keys: ['Enter'], text: '주소칸에서는 종목 칸으로, 종목 칸에서는 등록해요' },
  { keys: ['Ctrl', 'Enter'], text: '어느 칸에서든 바로 등록해요 (맥은 ⌘ + Enter)' },
  { keys: ['/'], text: '다른 곳에 있다가 주소칸으로 돌아와요' },
  { keys: ['Esc'], text: '주소칸에서 눌러 잘못 붙인 주소를 지워요' },
  { keys: ['←', '→'], text: '탭·선택 버튼 사이를 옮겨요' },
  { keys: ['Esc'], text: '열려 있는 오른쪽 패널을 닫아요' }
]

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: '같은 영상을 두 번 올리면 어떻게 되나요?',
    a: '내가 이미 올린 영상이면 등록 전에 미리 알려 줘요. 종목이 다르면 ‘종목만 바꾸기’가 나오고, 같으면 바꿀 게 없다고 안내해요. 다른 팀원이 올린 영상을 그대로 등록하면 그 영상이 내 영상으로 바뀌어요. 누가 올렸는지도 미리 보여 주니 확인하고 진행하세요.'
  },
  {
    q: '숏폼 주소는 어떻게 올리나요?',
    a: 'youtube.com/shorts/… 주소도 그대로 붙여 넣으면 돼요. 형식이 숏폼으로 자동으로 바뀌어요. 잘못 바뀌었다면 ‘롱폼·숏폼’ 버튼에서 직접 골라 주세요.'
  },
  {
    q: '조회수는 언제 보이나요?',
    a: '등록할 때 유튜브에서 한 번 가져와요. 그 뒤 숫자는 관리자가 ‘영상 점수판’에서 ‘유튜브에서 조회수 받기’를 누를 때 새로 고쳐져요. 방금 올린 영상은 0이거나 ‘제목 수집 전’으로 보일 수 있어요.'
  },
  {
    q: '로그아웃됐어요. 적던 내용이 사라지나요?',
    a: '오래 쉬면 로그인이 풀릴 수 있어요. 등록하다가 풀리면 ‘다시 로그인’을 누르세요. 로그인하면 하던 화면으로 돌아오고, 적던 주소와 종목도 (30분 안이면) 그대로 채워져 있어요.'
  }
]

const ROUTINE: Array<{ name: string; where: string; href: string; body: string }> = [
  {
    name: '반응 점수',
    where: '영상 점수판',
    href: '/v5/scoreboard',
    body: '먼저 ‘유튜브에서 조회수 받기’를 눌러 숫자를 새로 받아요. 점수가 높은 영상과 낮은 영상을 훑어봐요.'
  },
  {
    name: '실험 보드',
    where: '성장 실험',
    href: '/v5/canvas',
    body: '진행 중인 실험의 결과를 확인하고, 끝난 실험은 성공·실패로 옮겨요.'
  },
  {
    name: '성공 공식',
    where: '성공 공식',
    href: '/v5/playbook',
    body: '반응이 좋았던 영상의 공통점을 공식으로 남겨요. 직원들이 등록할 때 골라 쓸 수 있어요.'
  },
  {
    name: '주간 회고',
    where: '주간 회고',
    href: '/v5/retros',
    body: '금요일에만 해요. 한 주를 돌아보고 잘된 점, 고칠 점, 다음 주 할 일을 남겨요.'
  }
]

// 한국 시간 기준으로 오늘이 금요일인가(회고 단계에 "오늘이에요" 표시).
function isFridayInKorea() {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date()) === 'Fri'
  } catch {
    return false
  }
}

export default function HelpPage() {
  const me = useV5Me()
  const isAdmin = Boolean(me?.isAdmin)
  const friday = useMemo(isFridayInKorea, [])

  return (
    <>
      <PageHeader title="사용 방법" subtitle="영상 등록부터 되돌리기까지, 자주 쓰는 방법을 짧게 모았어요." />

      <section className="panel v5-help" aria-labelledby="v5-help-start">
        <h2 className="panel-title" id="v5-help-start">
          영상 등록 4단계
        </h2>
        <ol className="v5-help-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="v5-help-num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <div className="v5-help-step-title">
                  <span className="v5-sr-only">{i + 1}단계. </span>
                  {step.title}
                </div>
                <p className="v5-help-text">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="v5-help-foot">
          <Link className="link" href="/v5/register">
            영상 등록 화면으로 가기
          </Link>
        </p>
      </section>

      <section className="panel v5-help" aria-labelledby="v5-help-keys">
        <h2 className="panel-title" id="v5-help-keys">
          키보드 단축키
        </h2>
        <ul className="v5-help-keys">
          {SHORTCUTS.map((row) => (
            <li key={`${row.keys.join('+')}-${row.text}`}>
              <span className="v5-help-keycap">
                {row.keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 ? ' + ' : ''}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </span>
              <span>{row.text}</span>
            </li>
          ))}
        </ul>
        <p className="v5-help-note">폰이나 태블릿에서는 키보드 없이 버튼만 눌러도 똑같이 쓸 수 있어요.</p>
      </section>

      <section className="panel v5-help" aria-labelledby="v5-help-faq">
        <h2 className="panel-title" id="v5-help-faq">
          자주 묻는 질문
        </h2>
        <div className="v5-help-faq">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p className="v5-help-text">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {isAdmin ? (
        <section className="panel v5-help" aria-labelledby="v5-help-routine">
          <h2 className="panel-title" id="v5-help-routine">
            매일 아침 5분 루틴 <Badge tone="indigo">관리자</Badge>
          </h2>
          <ol className="v5-help-steps">
            {ROUTINE.map((step, i) => {
              const isRetro = step.href === '/v5/retros'
              return (
                <li key={step.href}>
                  <span className="v5-help-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <div className="v5-help-step-title">
                      <span className="v5-sr-only">{i + 1}단계. </span>
                      {step.name}
                      {isRetro ? <span className="v5-help-when">{friday ? ' · 오늘은 금요일이에요' : ' · 금요일에만'}</span> : null}
                    </div>
                    <p className="v5-help-text">{step.body}</p>
                    <Link className="link v5-help-go" href={step.href}>
                      {step.where} 열기
                    </Link>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}
    </>
  )
}
