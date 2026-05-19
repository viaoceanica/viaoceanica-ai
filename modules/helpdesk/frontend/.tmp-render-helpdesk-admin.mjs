import React from 'react';
import { renderToString } from 'react-dom/server';
const mod = await import('./app/admin/page.tsx');
const html = renderToString(React.createElement(mod.default));
console.log(JSON.stringify({
  title: html.includes('Administração do helpdesk'),
  apiBaseHint: html.includes('Catálogos e operação'),
}));
