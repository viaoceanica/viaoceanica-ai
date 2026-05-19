import React from 'react';
import { renderToString } from 'react-dom/server';
const mod = await import('./app/page.tsx');
const html = renderToString(React.createElement(mod.default));
console.log(JSON.stringify({
  newTicketBeforeFastPanel: html.indexOf('Novo ticket') < html.indexOf('Painel rápido'),
  descriptionLabel: html.includes('Descrição'),
  routingLabels: html.includes('Estado') && html.includes('Prioridade') && html.includes('Responsável'),
  autoReplyLabel: html.includes('Resposta automática'),
}));
