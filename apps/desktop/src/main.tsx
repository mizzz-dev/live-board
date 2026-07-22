import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppV2 } from './AppV2';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppV2 />
  </StrictMode>,
);
