import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import './index.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// reducedMotion="user" makes every `motion` animation honour the visitor's OS setting.
createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
