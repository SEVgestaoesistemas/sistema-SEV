# API de integração SEV — versão 1

Esta API permite que um sistema externo envie dados para o estoque e as vendas da própria empresa no SEV. A primeira versão aceita somente operações de escrita e vendas já pagas.

## Segurança

1. Em **Configurações → Integrações API**, um proprietário ou administrador cria uma chave e escolhe os escopos necessários.
2. Copie a chave no momento da criação: o SEV não armazena seu valor original, apenas um hash criptográfico.
3. Envie-a em todas as chamadas externas:

```http
Authorization: Bearer sev_live_sua_chave_aqui
Idempotency-Key: identificador-unico-da-tentativa
Content-Type: application/json
```

Não coloque a chave no navegador, em repositórios Git ou em mensagens. Se suspeitar de vazamento, revogue-a na tela de Configurações e crie outra. A revogação vale imediatamente.

Cada chave pertence a uma única empresa. O `organization_id` nunca é recebido do cliente: ele é obtido exclusivamente a partir da chave e reforçado por RLS no banco.

## Endereço base

```text
https://api.sevgestaoesistemas.com.br/api/v1/integrations/v1
```

## Idempotência

Todas as operações que alteram dados exigem `Idempotency-Key`. Reenvie **a mesma chave e exatamente o mesmo payload** quando houver timeout ou dúvida sobre a entrega. O SEV devolve a resposta original sem duplicar a operação.

Uma mesma chave com payload diferente retorna `409 IDEMPOTENCY_KEY_REUSED`. A retenção é de sete dias. Os identificadores externos também evitam duplicações de negócio.

## Produtos

Escopo necessário: `inventory:write`.

### Criar ou atualizar produto

```http
PUT /products/{externalId}
```

```json
{
  "name": "Camiseta azul M",
  "sku": "CAM-AZ-M",
  "minimumQuantity": 3,
  "unitPriceCents": 7990
}
```

`externalId` é um código estável escolhido pelo sistema cliente (1–128 caracteres, letras, números, `.`, `_`, `:`, `-`). A quantidade inicial é zero: entradas e ajustes devem ser enviados pela rota de movimentação.

### Movimentar estoque

```http
POST /products/{externalProductId}/stock-movements
```

Entrada:

```json
{
  "externalMovementId": "nf-123-item-1",
  "type": "entry",
  "quantity": 12,
  "note": "Entrada da nota 123"
}
```

Saída usa `type: "exit"` e `quantity`. Para corrigir a contagem, use a quantidade final, não uma diferença:

```json
{
  "externalMovementId": "inventario-2026-08-06-cam-az-m",
  "type": "adjustment",
  "targetQuantity": 9
}
```

O estoque nunca pode ficar negativo. Uma saída acima do disponível retorna `409 INSUFFICIENT_STOCK` e não grava alteração parcial.

## Vendas pagas

Escopo necessário: `sales:write`.

```http
PUT /sales/{externalSaleId}
```

```json
{
  "customer": {
    "externalId": "cliente-42",
    "name": "Cliente Exemplo Ltda.",
    "document": "12345678000190",
    "email": "financeiro@cliente.example"
  },
  "paymentMethod": "pix",
  "paymentStatus": "paid",
  "items": [
    {
      "productExternalId": "camiseta-azul-m",
      "quantity": 2,
      "unitPriceCents": 7990
    }
  ]
}
```

Valores monetários são sempre inteiros em centavos. O cliente e os produtos são associados por seus identificadores externos da mesma empresa. Produtos devem existir no SEV antes de a venda ser enviada.

Nesta fase, `paymentStatus` precisa ser exatamente `"paid"`. Valores como `pending` recebem `422 VALIDATION_ERROR`, com a mensagem de que vendas a prazo ainda não são suportadas pela API. Portanto essa rota não cria Contas a Receber.

Reenviar a venda com o mesmo `externalSaleId` e dados novos atualiza a venda de forma transacional: o estoque anterior é devolvido e o novo é baixado na mesma transação. Se algo falhar, nada é confirmado.

## Logs de sincronização

Escopo externo necessário: `sync-logs:read`.

```http
GET /sync-logs?limit=50
```

O proprietário e administradores também veem os logs na tela **Configurações → Integrações API**. Cada registro informa data, rota, evento, identificador externo, status, código de erro (quando houver) e duração. O payload completo e a chave jamais são registrados.

## Erros

As respostas de erro seguem este formato:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos para a integração.",
    "details": [
      { "path": "paymentStatus", "message": "Vendas a prazo ainda não são suportadas pela API. Envie paymentStatus como \"paid\"." }
    ]
  }
}
```

Principais códigos:

| HTTP | Código | Ação sugerida |
| --- | --- | --- |
| 401 | `API_KEY_INVALID` / `API_KEY_REVOKED` | Corrija ou gere uma nova chave. |
| 403 | `API_SCOPE_FORBIDDEN` | Crie uma chave com o escopo necessário. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Use uma nova chave de idempotência para um payload novo. |
| 409 | `INSUFFICIENT_STOCK` | Corrija o estoque ou a quantidade. |
| 422 | `VALIDATION_ERROR` | Veja `details` e corrija o payload. |
| 429 | `API_RATE_LIMITED` / `API_DAILY_LIMITED` | Aguarde e reduza a frequência. |

## Limites

O limite padrão é de 30 requisições por minuto e 2.000 por dia para cada empresa. Ele é aplicado no backend, por organização, além dos controles de segurança gerais. Projetos que precisem enviar muitos registros devem processar em fila, reutilizar requisições em caso de timeout e evitar paralelismo excessivo.
