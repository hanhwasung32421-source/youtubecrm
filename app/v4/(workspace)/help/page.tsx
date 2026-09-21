'use client'

import Link from 'next/link'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'

const STEPS = [
  {
    title: '주소 붙여넣기',
    body: '유튜브에서 영상 주소를 복사해요. 등록 화면의 첫 칸에 붙여넣으면 돼요. (Ctrl+V 또는 "붙여넣기" 버튼)'
  },
  {
    title: '종목 적기',
    body: '다룬 종목명을 적어요. 아래 "최근 종목" 버튼을 누르면 다시 적지 않아도 돼요. 종목은 다음 영상에도 그대로 남아 있어요.'
  },
  {
    title: '등록하기',
    body: 'Enter 를 누르거나 "등록" 버튼을 눌러요. 끝나면 주소 칸이 비워져서 바로 다음 주소를 붙여넣을 수 있어요.'
  },
  {
    title: '되돌리기',
    body: '잘못 올렸다면 등록 직후 10초 안에 "되돌리기"를 눌러요. 그 뒤에는 아래 목록에서 "수정"이나 "삭제"를 누르세요.'
  }
] as const

const SHORTCUTS = [
  ['/', '주소 칸으로 이동 (글을 쓰는 중이 아닐 때)'],
  ['Enter', '주소 칸에서는 종목 칸으로, 종목 칸에서는 등록'],
  ['Ctrl + Enter', '어느 칸에서든 바로 등록 (맥은 Cmd + Enter)'],
  ['Esc', '주소 칸 비우기 (종목 칸에서는 종목명 비우기)'],
  ['Enter · Esc (수정할 때)', '수정한 내용 저장 · 수정 창 닫기']
] as const

const FAQ = [
  {
    q: '같은 영상을 두 번 올리면 어떻게 되나요?',
    a: (
      <>
        <p>이미 등록한 영상이면 주소 아래에 알려 드려요. 새로 등록하는 대신 종목만 바꿀 수 있고, 영상 정보와 조회수는 그대로예요.</p>
        <p>다른 사람이 등록한 영상을 내가 다시 등록하면 담당자가 나로 바뀔 수 있어요. 헷갈리면 먼저 물어보세요.</p>
      </>
    )
  },
  {
    q: '숏폼(쇼츠) 주소는 어떻게 하나요?',
    a: <p>youtube.com/shorts/… 로 시작하는 주소도 그대로 붙여넣으면 돼요. 형식이 자동으로 &quot;숏폼&quot;으로 바뀌어요.</p>
  },
  {
    q: '조회수는 언제 보이나요?',
    a: (
      <>
        <p>등록할 때 유튜브에서 한 번 가져와요. 그 뒤에는 관리자가 성장 현황에서 &quot;유튜브에서 최신 조회수 받기&quot;를 누를 때 새로 고쳐져요.</p>
        <p>등록 직후에는 조회수가 0이거나 비어 있을 수 있어요. 고장이 아니에요.</p>
      </>
    )
  },
  {
    q: '로그아웃됐어요. 적던 내용은 어떻게 되나요?',
    a: (
      <>
        <p>로그인이 풀리면 &quot;로그인이 풀렸어요&quot;라고 알려 드려요. 적어 둔 주소와 종목은 그대로 남아 있어요.</p>
        <p>&quot;다시 로그인 (새 창)&quot;을 눌러 로그인한 뒤 원래 화면으로 돌아와서 &quot;다시 시도&quot;를 누르세요.</p>
      </>
    )
  }
] as const

const ROUTINE = [
  {
    title: '성장 현황',
    href: '/v4/dashboard',
    minutes: '1분',
    look: '맨 위 한 줄 요약과 "다음 할 일" 카드, 그리고 조회수 기준 시각.',
    action: '카드가 시키는 것부터 해요. 기준 시각이 오래됐다면 "최신 조회수 받기"를 눌러 주세요.'
  },
  {
    title: '담당자 비교',
    href: '/v4/staff',
    minutes: '1~2분',
    look: '오늘 등록이 적은 사람, 롱폼과 숏폼이 한쪽으로만 쏠린 사람.',
    action: '뒤처진 사람에게 짧게 물어봐요. 잘하는 사람의 방식을 다른 사람과 나눠요.'
  },
  {
    title: '영상 성과 순위',
    href: '/v4/ranking',
    minutes: '1~2분',
    look: '많이 본 영상 위쪽의 공통점 (종목, 롱폼·숏폼, 제목 말투).',
    action: '오늘 올릴 영상에 반영할 점 한 가지를 정해요.'
  },
  {
    title: '제목·썸네일 실험',
    href: '/v4/experiments',
    minutes: '1분',
    look: '진행 중인 실험이 끝났는지, 어느 쪽이 더 잘 나왔는지.',
    action: '결과를 기록하고, 다음에 해 볼 실험 한 가지를 등록해요.'
  }
] as const

export default function HelpPage() {
  const { isAdmin } = useV4Me()

  return (
    <>
      <PageHeader title="사용 방법" subtitle="처음이어도 5분이면 익숙해져요. 매일 하는 일은 영상 등록이에요." />

      <section className="panel v4-help" aria-labelledby="v4-help-quick">
        <div className="panel-header">
          <div>
            <h2 className="panel-title" id="v4-help-quick">
              영상 등록, 4단계
            </h2>
            <p className="panel-subtitle">하루에 10~15개도 금방 올릴 수 있게 만들었어요.</p>
          </div>
          <Link className="button v4-mini" href="/v4/register">
            영상 등록하러 가기
          </Link>
        </div>
        <ol className="v4-help-steps">
          {STEPS.map((step, index) => (
            <li className="v4-help-step" key={step.title}>
              <span className="v4-help-num" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <div className="v4-help-step-title">{step.title}</div>
                <p className="v4-help-step-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="v4-help-note">
          영상이 여러 개라면 &quot;여러 개 붙여넣기&quot; 탭에 주소를 줄마다 하나씩 붙여넣고 한 번에 등록할 수 있어요. 주소가 여러 개 들어 있으면 알아서 권해 드려요.
        </p>
      </section>

      <section className="panel v4-help" aria-labelledby="v4-help-keys">
        <div className="panel-header">
          <div>
            <h2 className="panel-title" id="v4-help-keys">
              키보드 단축키
            </h2>
            <p className="panel-subtitle">손을 키보드에서 떼지 않고 등록할 수 있어요.</p>
          </div>
        </div>
        <dl className="v4-help-keys">
          {SHORTCUTS.map(([key, what]) => (
            <div className="v4-help-key-row" key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="v4-help-note">등록 화면 아래쪽 &quot;주소만 붙이면 바로 등록&quot;을 켜면, 종목이 채워져 있을 때 붙여넣기만으로 등록이 끝나요.</p>
      </section>

      <section className="panel v4-help" aria-labelledby="v4-help-faq">
        <div className="panel-header">
          <div>
            <h2 className="panel-title" id="v4-help-faq">
              자주 묻는 질문
            </h2>
          </div>
        </div>
        <div className="v4-help-faq">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <div className="v4-help-answer">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      {isAdmin ? (
        <section className="panel v4-help" aria-labelledby="v4-help-routine">
          <div className="panel-header">
            <div>
              <h2 className="panel-title" id="v4-help-routine">
                매일 아침 5분 루틴 (관리자)
              </h2>
              <p className="panel-subtitle">위에서 아래로 차례대로 열어 보세요. 화면마다 볼 것 한 가지, 할 일 한 가지만 챙기면 돼요.</p>
            </div>
          </div>
          <ol className="v4-help-routine">
            {ROUTINE.map((item, index) => (
              <li className="v4-help-routine-item" key={item.href}>
                <span className="v4-help-num" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="v4-help-routine-body">
                  <div className="v4-help-step-title">
                    <Link className="link" href={item.href}>
                      {item.title}
                    </Link>
                    <span className="v4-help-min"> · {item.minutes}</span>
                  </div>
                  <p className="v4-help-step-body">
                    <strong>볼 것</strong> {item.look}
                  </p>
                  <p className="v4-help-step-body">
                    <strong>할 일</strong> {item.action}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  )
}
