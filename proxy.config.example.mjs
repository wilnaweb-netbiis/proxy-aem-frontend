import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  // URL do Publish/ambiente que fornece HTML, DAM, APIs e o restante.
  target: 'https://publish.exemplo.com',
  port: 3000,
  debug: true,
  hotReload: true,

  // Aponte para a pasta gerada por `npm run build` ou `npm run watch` do ui.frontend.
  // O Adobe AEM Project Archetype normalmente gera: ui.frontend/dist/clientlib-site
  frontendDist: path.resolve(here, '../ui.frontend/dist'),

  // Prefixo que aparece nas URLs de produção. Confirme-o no HTML da página.
  // Exemplo: /etc.clientlibs/meu-projeto/clientlibs/clientlib-site
  localClientlibPrefix: '/etc.clientlibs/meu-projeto/clientlibs/clientlib-site',

  // Arquivos relativos a frontendDist que correspondem a cada tipo de asset.
  // Ajuste depois de conferir a estrutura real do `dist`.
  assets: {
    css: 'clientlib-site.css',
    js: 'clientlib-site.js',
    fontsDir: 'resources',
    mapsDir: '.'
  },

  // Opcional: reescreve URLs absolutas que vierem no HTML para continuarem no proxy local.
  rewriteHtmlOrigin: true
};
