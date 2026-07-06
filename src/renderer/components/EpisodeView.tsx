import { useHub } from '../store/useHub';

export default function EpisodeView() {
  const { detail } = useHub();
  if (!detail) return <div className="empty-state">에피소드를 선택하세요</div>;
  return <h2>{detail.title}</h2>;
}
