import React from 'react';
import { renderToString } from 'react-dom/server';
const mod = await import('./app/page.tsx');
const html = renderToString(React.createElement(mod.default));
const a = html.indexOf('Novo ticket');
const b = html.indexOf('Painel rápido');
console.log(JSON.stringify({a,b,orderOk:a >= 0 && b >= 0 && a < b}));
