# Backend — SEV Gestão & Sistemas

API responsável por autenticação, permissões, estoque, despesas, notificações e auditoria.

## Arquitetura inicial

- Node.js + Fastify
- PostgreSQL
- Sessões opacas em cookies `HttpOnly`
- Separação de dados por empresa (`organization_id`)
- Controle de acesso por função
- Registro de auditoria para alterações relevantes

## Executar localmente

1. Copie `.env.example` para `.env` e ajuste a conexão PostgreSQL.
2. Instale as dependências: `npm.cmd install`.
3. Crie as tabelas: `npm.cmd run db:migrate`.
4. Inicie a API: `npm.cmd run dev`.

O endpoint de verificação ficará disponível em `GET /api/v1/health`.

> Os dados do protótipo ainda permanecem no navegador. A próxima etapa conectará as telas atuais a esta API.

## Deploy no Render

O repositório inclui `render.yaml` na raiz para criar a API como um Web Service. No primeiro deploy, o Render solicitará os valores secretos `DATABASE_URL` e `DATABASE_SSL_CA`.

- Use no `DATABASE_URL` a string do **Session Pooler** do Supabase.
- Em `DATABASE_SSL_CA`, cole o conteúdo inteiro do certificado raiz baixado no painel do Supabase.
- O plano inicial no Blueprint é `free`, indicado somente para demonstração. Antes de entregar o sistema ao cliente, altere o serviço para um plano sempre ativo.
