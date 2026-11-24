import React from 'react';
import { createRoot } from 'react-dom/client';
import PulsePerformanceRoom from '../PipeDreamsPulsePerformanceRoom_v0.2.0';
import './index.css';

const demoSession = {
  songId: 'pulse-demo',
  title: 'PULSE Demo',
  bpm: 104,
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PulsePerformanceRoom session={demoSession} />
  </React.StrictMode>,
);
