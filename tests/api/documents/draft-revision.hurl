GET {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
HTTP 200
[Captures]
item_id: jsonpath "$.document.pekerjaan[0].id"
[Asserts]
jsonpath "$.draft_revision" == 1
jsonpath "$.document.pekerjaan[0].id" isString

PATCH {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
Content-Type: application/json
{"field":"pekerjaan[0].volume","nilai":2}
HTTP 400

PATCH {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
Idempotency-Key: {{key}}
Content-Type: application/json
{"op":"update_line","item_id":"{{item_id}}","changes":{"volume":2,"harga_satuan":7},"draft_revision":1}
HTTP 200
[Asserts]
jsonpath "$.draft_revision" == 2
jsonpath "$.document.pekerjaan[0].id" == "{{item_id}}"
jsonpath "$.document.total_nominal_minor" == 14

PATCH {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
Idempotency-Key: {{key}}
Content-Type: application/json
{"op":"update_line","item_id":"{{item_id}}","changes":{"volume":2,"harga_satuan":7},"draft_revision":1}
HTTP 200
[Asserts]
jsonpath "$.draft_revision" == 2
jsonpath "$.document.total_nominal_minor" == 14

PATCH {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
Idempotency-Key: {{key}}
Content-Type: application/json
{"op":"update_line","item_id":"{{item_id}}","changes":{"volume":3},"draft_revision":1}
HTTP 409
[Asserts]
jsonpath "$.error" == "idempotency_conflict"

PATCH {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
Idempotency-Key: stale-{{key}}
Content-Type: application/json
{"field":"pekerjaan[0].volume","nilai":3,"draft_revision":1}
HTTP 409
[Asserts]
jsonpath "$.error" == "stale_revision"
jsonpath "$.draft_revision" == 2

PATCH {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
Idempotency-Key: invalid-{{key}}
Content-Type: application/json
{"op":"update_line","item_id":"{{item_id}}","changes":{"volume":0},"draft_revision":2}
HTTP 400

GET {{base_url}}/api/documents/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
HTTP 200
[Asserts]
jsonpath "$.draft_revision" == 2
jsonpath "$.document.total_nominal_minor" == 14

POST {{base_url}}/api/documents/{{document_id}}/approve
Cookie: better-auth.session_token={{cookie}}
HTTP 400

POST {{base_url}}/api/documents/{{document_id}}/approve
Cookie: better-auth.session_token={{cookie}}
Content-Type: application/json
Idempotency-Key: approval-{{key}}
{"draft_revision":1}
HTTP 409
[Asserts]
jsonpath "$.error" == "stale_revision"

GET {{base_url}}/api/pdf/{{document_id}}
HTTP 401
[Asserts]
header "Cache-Control" == "private, no-store"

GET {{base_url}}/api/pdf/{{document_id}}/preview
Cookie: better-auth.session_token={{cookie}}
HTTP 200
[Asserts]
header "Cache-Control" == "private, no-store"
body contains "draft-watermark"

POST {{base_url}}/api/documents/{{document_id}}/approve
Cookie: better-auth.session_token={{cookie}}
Content-Type: application/json
Idempotency-Key: approval-{{key}}
{"draft_revision":2}
HTTP 200
[Captures]
official_path: jsonpath "$.pdf_path"
official_number: jsonpath "$.document.nomor"
[Asserts]
jsonpath "$.draft_revision" == 2
jsonpath "$.status" == "disetujui"
jsonpath "$.pdf_path" matches "^snapshots/[a-f0-9]{64}\\.pdf$"

POST {{base_url}}/api/documents/{{document_id}}/approve
Cookie: better-auth.session_token={{cookie}}
Content-Type: application/json
Idempotency-Key: approval-{{key}}
{"draft_revision":2}
HTTP 200
[Asserts]
jsonpath "$.pdf_path" == "{{official_path}}"
jsonpath "$.document.nomor" == "{{official_number}}"

GET {{base_url}}/api/pdf/{{document_id}}
Cookie: better-auth.session_token={{cookie}}
HTTP 200
[Asserts]
header "Content-Type" == "application/pdf"
header "Cache-Control" == "private, no-store"

GET {{base_url}}/api/pdf/{{document_id}}
Cookie: better-auth.session_token={{other_cookie}}
HTTP 404
[Asserts]
header "Cache-Control" == "private, no-store"

GET {{base_url}}/api/pdf/{{document_id}}/preview
Cookie: better-auth.session_token={{other_cookie}}
HTTP 404
[Asserts]
header "Cache-Control" == "private, no-store"
