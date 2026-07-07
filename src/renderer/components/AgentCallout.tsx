import type { GroupKey } from '@shared/groups';
import iconBase from '../assets/agents/claude-code.png';
import iconPlanning from '../assets/agents/planning.png';
import iconProducts from '../assets/agents/products.png';
import iconPrompts from '../assets/agents/prompts.png';
import iconRenders from '../assets/agents/renders.png';
import iconScript from '../assets/agents/script.png';
import iconPublish from '../assets/agents/publish.png';

/** 역할별 커스텀 캐릭터 (ChatGPT 생성, 2026-07-08) — 미생성분은 베이스 아이콘 폴백 */
const ICONS: Record<GroupKey, string> = {
  planning: iconPlanning,
  products: iconProducts,
  prompts: iconPrompts,
  renders: iconRenders,
  script: iconScript,
  publish: iconPublish,
  validation: iconBase,
  manuscript: iconBase,
  final: iconBase,
  osmu: iconBase,
};

/** 탭(단계)별 담당 에이전트 소개 — 비개발자 Owner용 한 줄 안내 (2026-07-07 Owner 요청) */
const CALLOUTS: Record<GroupKey, { agent: string; role: string }> = {
  planning: {
    agent: 'Agent 5 · Topic Strategist (기획팀)',
    role: 'IP 라이브러리 60종을 점수로 매겨 이번 에피소드의 주제 후보를 골라요. 최종 선택은 부부의 몫!',
  },
  products: {
    agent: 'Agent 6·7 · Curator & Room Composer (리서치·제작팀)',
    role: '실제 판매 중인 제품을 수집·선별하고, 예산 안에서 확정 SKU 조합과 정확한 견적을 짜요.',
  },
  prompts: {
    agent: 'Agent 8 · Master Sheet (프롬프트팀)',
    role: '확정 제품마다 Gemini·ChatGPT·힉스필드용 이미지 프롬프트를 설계해요. 복사해서 생성한 뒤 드롭존에 놓아주세요.',
  },
  renders: {
    agent: '렌더 보관함 (Owner 수동 생성)',
    role: '무료티어에서 직접 생성한 렌더 이미지가 모이는 곳이에요. 렌더 프롬프트 탭의 드롭존에 끌어다 놓으면 여기 저장돼요.',
  },
  script: {
    agent: 'Agent 9 · Script Writer (제작팀)',
    role: '확정 룸을 인용해 부부 5-column 콘티(대장·부장 티키타카)를 써요. 가격·모델명은 절대 지어내지 않아요.',
  },
  publish: {
    agent: 'Agent 10·11 · Title & Thumbnail (제작팀)',
    role: '훅 5패턴 제목 후보와 썸네일 프롬프트, 숏폼 변환본을 준비해요. 발행 전 부부 승인은 필수!',
  },
  validation: {
    agent: 'Validator (검수)',
    role: '앞 단계를 전혀 모르는 깨끗한 눈으로 콘티·제목·썸네일을 재검토해요 — 보이스 일치, 5초 후킹, 룰 위반을 잡아요.',
  },
  manuscript: {
    agent: 'Agent 13 · Manuscript Compiler',
    role: '전 단계 산출물을 촬영·녹음용 통합 제작 원고 한 편으로 취합해요. 파이프라인의 종착지!',
  },
  final: {
    agent: '최종 영상 보관함 (Owner 편집 완성본)',
    role: '편집 끝난 유튜브 본편·릴스·썸네일 클립을 이 에피소드의 final 폴더에 넣으면 여기서 바로 재생돼요.',
  },
  osmu: {
    agent: 'OSMU 변환 담당',
    role: '본편을 블로그 글·쓰레드·인스타 캡션으로 변환한 텍스트가 모여요. 발행하면 발행 탭에서 기록해 주세요!',
  },
};

export default function AgentCallout({ group }: { group: GroupKey }) {
  const c = CALLOUTS[group];
  return (
    <div className="agent-callout">
      <img className="agent-avatar" src={ICONS[group]} alt="담당 에이전트" />
      <div className="agent-bubble">
        <div className="agent-name">{c.agent}</div>
        <div className="agent-role">{c.role}</div>
      </div>
    </div>
  );
}
