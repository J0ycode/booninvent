# Sales API

The billing module records sales with this API. Each sale reduces one store's stock. This app has no checkout screen.

## Authentication
The Owner creates the key in **Settings → Sales API key**. It is shown only once; the app stores only a SHA-256 hash.
Rotating creates a new key and stops the old one immediately.

Send the key as `Authorization: Bearer <key>` (or `X-API-Key: <key>`).

## POST /api/v1/sales

```http
POST /api/v1/sales
Authorization: Bearer bbk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "locationId": "<store id from Settings → Store ids>",
  "externalRef": "BILL-2026-000123",
  "items": [
    { "barcode": "BB00000022", "quantity": 2 },
    { "barcode": "8901234567890", "quantity": 1 }
  ]
}
```

- `externalRef` (1-100 chars) is your bill number. It makes the call **idempotent**: if the same `externalRef` is sent again, nothing changes and the first result is returned with `"duplicate": true` (HTTP 200). Retry safely after timeouts.
- Repeated barcodes in `items` are added together. Quantities are whole pieces (1-10,000).
- The whole sale succeeds or nothing changes.

### Responses
`201 Created`: sale recorded.
```json
{
  "saleId": "6ac0b1dac33c8d72b10fbc0b",
  "externalRef": "BILL-2026-000123",
  "locationId": "6ac0b190c42f4dfffc6d5b97",
  "duplicate": false,
  "items": [{ "barcode": "BB00000022", "productId": "6ac0…", "quantity": 2, "balanceAfter": 7 }],
  "createdAt": "2026-10-03T07:42:18.942Z"
}
```
`200 OK`: duplicate `externalRef`; same body with `"duplicate": true` (`balanceAfter` is `null`).

Errors use one shape: `{ "error": { "code": "…", "message": "…", "details": … } }`

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION` | Body is not JSON, or a field is missing or invalid (`details` lists the problems) |
| 401 | `UNAUTHENTICATED` | Missing, wrong, or revoked API key |
| 409 | `INSUFFICIENT_STOCK` | A line asks for more than the store has (`details`: productId, available, requested) |
| 422 | `UNKNOWN_BARCODE` | One or more barcodes do not exist in this shop (`details.barcodes`) |
| 422 | `INVALID_LOCATION` | `locationId` is not one of this shop's stores (the Store Room cannot sell) |
| 423 | `TENANT_SUSPENDED` | The shop is suspended; no stock changes are allowed |
| 500 | `INTERNAL` | Unexpected error; safe to retry with the same `externalRef` |

### curl example
```bash
curl -X POST https://your-app.example.com/api/v1/sales \
  -H "Authorization: Bearer $BOONBABY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"locationId":"<store id>","externalRef":"BILL-1","items":[{"barcode":"BB00000022","quantity":1}]}'
```

## In-system use
Code inside this app (the in-system billing module) calls the same logic directly:

```ts
import { recordSale } from "@/server/stock/sales";
const result = await recordSale(await getCtx(), { locationId, externalRef, items });
```
`recordSale` needs a signed-in OWNER, or STORE_STAFF selling from their own store. It has the same idempotency and errors (thrown as `AppError` with the codes above).
