import type { ReactNode } from 'react';

/** 라인 아이콘(Lucide 파생) — 이모지 아이콘 대체용.
 *  currentColor를 상속하고 1em로 그려져 텍스트 옆에서 색·크기를 함께 따른다.
 *  의미 전달은 옆 텍스트/aria-label가 맡으므로 여기선 aria-hidden. */
export type IconName = 'home' | 'refresh' | 'file' | 'copy' | 'close';

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M21 21v-5h-5" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h8" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
};

export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon${className ? ' ' + className : ''}`}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
