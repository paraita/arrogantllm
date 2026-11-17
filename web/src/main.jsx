import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

async function start() {
  try {
    const response = await fetch('/runtime-config.json');
    if (response.ok) {
      const config = await response.json();
      window.__ARROGANTLLM_PUBLIC_BASE_URL__ = config.publicBaseUrl;
    }
  } catch {
    // During standalone frontend development, the dashboard origin is the public origin.
  }
  createRoot(document.getElementById('root')).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}

start();
