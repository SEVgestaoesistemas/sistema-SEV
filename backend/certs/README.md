# Certificado do Supabase

Baixe o **Server root certificate** no painel do Supabase, em **Database Settings → SSL Configuration**, e salve-o nesta pasta com o nome:

`supabase-ca.crt`

Depois, no arquivo local `.env`, defina:

`DATABASE_SSL_CA_FILE=certs/supabase-ca.crt`

O certificado é ignorado pelo Git e não deve ser enviado ao repositório.
