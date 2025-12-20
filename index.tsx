import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e: any) {
  console.error("Mount Error:", e);
  rootElement.innerHTML = `
    <div style="padding: 20px; color: #9f1239; font-family: sans-serif; direction: ltr;">
      <h1>Mount Error</h1>
      <pre style="background: #fff1f2; padding: 15px; border: 1px solid #fda4af;">${e?.message || e}</pre>
    </div>
  `;
}