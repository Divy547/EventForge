import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { BrowserRouter } from 'react-router';
import './index.css';
import { App } from './App';
import { applyTheme, initialTheme } from './lib/theme';

// Before the first render, so a dark-mode visitor does not see a light flash.
applyTheme(initialTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// reducedMotion="user" makes every `motion` animation honour the visitor's OS setting.
createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {/* Vite's `base` and the API's static route both put the app under /dashboard. */}
      <BrowserRouter basename="/dashboard">
        <App />
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
