import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { PlatformApp } from './platform/PlatformApp.js';
import './styles.css';

// El panel de super-admin de plataforma vive bajo /platform (token y login propios).
const isPlatform = window.location.pathname.startsWith('/platform');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPlatform ? <PlatformApp /> : <App />}</React.StrictMode>,
);
