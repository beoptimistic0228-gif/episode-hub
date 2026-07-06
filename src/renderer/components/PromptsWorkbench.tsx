import type { EpisodeDetail } from '@shared/types';

export default function PromptsWorkbench({ detail }: { detail: EpisodeDetail }) {
  return <p>렌더 작업대 (Task 9): {detail.files.prompts.length}개 프롬프트 문서</p>;
}
