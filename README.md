# Proxy de clientlibs AEM

1. Copie esta pasta para a raiz do repositório AEM, ao lado de `ui.frontend`.
2. Renomeie `proxy.config.example.mjs` para `proxy.config.mjs` e ajuste `target`, `frontendDist` e `localClientlibPrefix`.
3. Instale as dependências com `npm install` nesta pasta.
4. Em outro terminal, execute o script de build em modo watch existente no `ui.frontend`.
5. Execute `npm start` nesta pasta e abra a mesma URL de produção usando `http://localhost:3000`.

O proxy só intercepta CSS, JavaScript e arquivos auxiliares abaixo de `localClientlibPrefix`; todo o restante continua vindo do Publish remoto.

Requisições POST são encaminhadas com o corpo e o Content-Type originais. Quando o Referer aponta para o próprio proxy, sua origem é substituída pela origem do AEM remoto; o caminho e os parâmetros são preservados. Outros valores de Referer não são alterados. Isso não substitui autenticação, tokens CSRF ou as permissões exigidas pelo AEM.

Com `debug: true` na configuração, cada requisição aparece no terminal com método, URL, destino, status HTTP e duração:

```text
[REQUEST] GET /etc.clientlibs/meu-projeto/clientlibs/clientlib-site.css -> LOCAL /caminho/ui.frontend/dist/clientlib-site/site.css | 200 | 3.2 ms
[REQUEST] GET /content/pagina.html -> REMOTO https://publish.exemplo.com/content/pagina.html | 200 | 152.8 ms
```

Use `debug: false` para desativar esses logs.

## Hot reload

Com `hotReload: true`, o proxy observa `frontendDist` e recarrega automaticamente a página quando o build muda. Mantenha `npm run watch` ativo no `ui.frontend` e `npm start` ativo neste proxy.

O proxy injeta o cliente de live reload somente nas respostas HTML abertas por `localhost`; o site remoto não é alterado.

## Descobrindo os valores exatos

No `ui.frontend`, procure no `package.json` pelo script de build e no `webpack` por `output.path` e pelos plugins `clientlib`/`aem-clientlib-generator`. O diretório de saída e os nomes de CSS/JS devem preencher `frontendDist` e `assets`. No HTML da página de Publish, copie o início da URL que carrega a clientlib para `localClientlibPrefix`.
