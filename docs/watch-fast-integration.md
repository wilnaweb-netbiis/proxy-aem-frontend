# Como usar o `ui.frontend` com este proxy (modo rápido)

Este documento explica o processo para o `ui.frontend` de um projeto AEM gerar os arquivos que este proxy consome, com o menor tempo de espera possível entre uma alteração de código e o reflexo no navegador.

## Contexto

O proxy (`server.mjs`) serve os assets estáticos direto da pasta apontada por `frontendDist` (ver [proxy.config.mjs](../proxy.config.mjs)):

```js
frontendDist: '/caminho/para/seu-projeto-aem/ui.frontend/dist/clientlib-site',
```

Substitua `/caminho/para/seu-projeto-aem` pelo caminho do projeto AEM na sua máquina.

Ele também observa essa pasta com `fs.watch(..., { recursive: true })` e, quando `hotReload: true`, dispara um reload automático no navegador (via Server-Sent Events) assim que os arquivos mudam.

Ou seja: **o proxy só sabe recarregar quando o `dist/clientlib-site` muda fisicamente em disco.** Ele não tem nenhuma integração direta com o Webpack — é um watcher de sistema de arquivos "burro".

## Problema do script padrão

O `ui.frontend` tem um script `npm run watch` "clássico", que reprocessa o projeto inteiro do zero a cada alteração (mata e recria o processo do Webpack + roda o `clientlib` recopiando tudo). Isso é lento (na prática, próximo de **2 minutos** por alteração), então o proxy demora bastante para perceber a mudança e recarregar a página.

## Solução: `npm run watch:fast`

No `ui.frontend`, foi criado um script novo, `watch:fast`, que:

1. Usa o modo `--watch` **nativo** do Webpack (processo único, persistente, com cache incremental de módulos) — só recompila o que realmente mudou.
2. Depois de cada build, sincroniza automaticamente os arquivos gerados para dentro do `ui.apps` (necessário para o AEM real, mas irrelevante para este proxy).
3. Sempre escreve fisicamente em `ui.frontend/dist/` (não é o `webpack-dev-server`, então não existe modo "em memória" aqui — o `--watch` do Webpack sempre grava em disco).

Resultado medido: ~2 segundos por alteração, ao invés de ~2 minutos.

## Passo a passo para rodar os dois processos juntos

Terminal 1 — dentro de `ui.frontend`:

```bash
cd /caminho/para/seu-projeto-aem/ui.frontend
npm run watch:fast
```

Deixe esse processo rodando. Ele vai:
- Compilar tudo na primeira vez (build inicial mais demorado, ~20s).
- A partir daí, recompilar incrementalmente (~1–2s) a cada alteração salva em `src/`.
- Logar `[clientlib] synced to ui.apps` depois de cada build.

Terminal 2 — dentro deste projeto de proxy:

```bash
cd /caminho/para/proxy-aem-frontend
npm start
```

Abra `http://localhost:3000` (a mesma URL de produção, mas servida localmente).

## O que esperar

- Alterar um arquivo `.scss`/`.ts`/`.js` dentro de `src/main/webpack` no `ui.frontend` dispara a recompilação incremental.
- O Webpack grava o novo `site.css`/`site.js` em `ui.frontend/dist/clientlib-site`.
- O proxy detecta a mudança nesse diretório (`fs.watch`) e envia o evento de `reload` para o navegador.
- Página recarrega sozinha em poucos segundos após salvar o arquivo.

## Pontos de atenção

- **Não usar `npm run start`** (o `webpack-dev-server`) junto com este proxy — por padrão ele não escreve nada em disco (`writeToDisk: false`), então o proxy nunca veria as mudanças. O `webpack-dev-server` serve os bundles só em memória, na própria porta 8080, sem gravar em `dist/`.
- Se quiser manter o comportamento antigo e mais lento por qualquer motivo, `npm run watch` (sem `:fast`) continua disponível e não foi removido.
- O primeiro build do `watch:fast` ainda é "full" (não incremental) — é normal ele demorar mais na primeira vez que você inicia o processo.
