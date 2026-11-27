import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root is missing.');
}

createRoot(root).render(
  <main>
    <h1>ローカル麻雀</h1>
    <p>開発環境は正常に起動しています。</p>
  </main>,
);
