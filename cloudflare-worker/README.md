# Proxy de IP real da API SEV

Este Worker deve receber todo o tráfego de `api.sevgestaoesistemas.com.br/*`.
Ele lê o IP entregue pela Cloudflare, assina o valor com HMAC-SHA-256 e encaminha
a requisição ao Render. O backend só usa esse IP se a assinatura, o método, o
caminho e a janela de 60 segundos forem válidos.

## Configuração pelo painel Cloudflare

1. Em **Workers & Pages**, crie um Worker chamado `sev-api-client-ip-proxy`.
2. Cole o conteúdo de `src/index.js` e faça o deploy inicial.
3. Em **Settings > Variables and Secrets**, adicione:
   - `ORIGIN_URL` (texto): `https://sev-api-7j7b.onrender.com`
   - `WORKER_IP_SIGNATURE_SECRET` (secret): uma senha aleatória com pelo menos 32 caracteres.
4. Em **Settings > Triggers**, adicione a rota `api.sevgestaoesistemas.com.br/*`.
5. No Render, cadastre o mesmo valor secreto em `WORKER_IP_SIGNATURE_SECRET` e faça o deploy do backend.
6. Desative em **Rules > Transform Rules > Managed Transforms** qualquer regra que remova IPs de visitante. Embora o Worker não dependa do header no Render, ele precisa receber `CF-Connecting-IP` da borda Cloudflare.
7. Verifique `GET https://api.sevgestaoesistemas.com.br/api/v1/health` e execute uma sincronização de integração. O valor de `api_sync_logs.source_ip` deve coincidir com o IP do chamador.

Não coloque o segredo em `wrangler.toml`, em `.env.example` ou no Git.
