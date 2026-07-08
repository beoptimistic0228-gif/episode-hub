import { useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import EpisodeView from './components/EpisodeView';
import { useHub } from './store/useHub';

export default function App() {
  const { init, root, pickRoot, page } = useHub();
  useEffect(() => {
    void init();
    const offEpisodes = window.hub.events.onEpisodesChanged(() => {
      void useHub.getState().refresh();
      void useHub.getState().refreshGitLocal();
    });
    const offStats = window.hub.events.onStatsChanged(() => {
      void useHub.getState().loadStats();
    });
    return () => { offEpisodes(); offStats(); };
  }, [init]);

  return (
    <div className="layout">
      <Sidebar />
      <main className="main">
        {root ? (
          page === 'dashboard' ? <Dashboard /> : <EpisodeView />
        ) : (
          <div className="empty-state">
            <p>orchestrator 폴더를 찾지 못했어요.</p>
            <p style={{ margin: '12px 0 20px' }}>레포를 클론한 위치의 <code>orchestrator</code> 폴더를 선택해 주세요.</p>
            <button className="btn-pill primary" onClick={pickRoot}>orchestrator 폴더 선택</button>
          </div>
        )}
      </main>
    </div>
  );
}
