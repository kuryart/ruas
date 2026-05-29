import Sidebar from './Sidebar';
import Workspace from './workspace/Workspace';

export default function App() {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--base)',
      }}
    >
      <Sidebar />
      <Workspace />
    </div>
  );
}
