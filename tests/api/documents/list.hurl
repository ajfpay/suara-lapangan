GET {{base_url}}/api/documents
HTTP 401
[Asserts]
jsonpath "$.error" == "unauthorized"

GET {{base_url}}/api/documents?limit=0
Cookie: better-auth.session_token={{cookie_a}}
HTTP 400
[Asserts]
jsonpath "$.error" == "invalid_request"

GET {{base_url}}/api/documents?cursor=invalid
Cookie: better-auth.session_token={{cookie_a}}
HTTP 400

GET {{base_url}}/api/documents?limit=1
Cookie: better-auth.session_token={{cookie_a}}
HTTP 200
[Captures]
next_cursor: jsonpath "$.nextCursor"
[Asserts]
jsonpath "$.items" count == 1
jsonpath "$.items[0].id" == "{{latest_id}}"
jsonpath "$.items[0].version" == 2
jsonpath "$.items[0].turnsHash" not exists
jsonpath "$.items[0].pdfPath" not exists
jsonpath "$.items[0].document" not exists
jsonpath "$.nextCursor" isString

GET {{base_url}}/api/documents?limit=1&cursor={{next_cursor}}
Cookie: better-auth.session_token={{cookie_a}}
HTTP 200
[Asserts]
jsonpath "$.items" count == 1
jsonpath "$.items[0].id" == "{{search_id}}"
jsonpath "$.nextCursor" == null

GET {{base_url}}/api/documents?search=%25&status=draf
Cookie: better-auth.session_token={{cookie_a}}
HTTP 200
[Asserts]
jsonpath "$.items" count == 1
jsonpath "$.items[0].id" == "{{search_id}}"

GET {{base_url}}/api/documents?status=disetujui
Cookie: better-auth.session_token={{cookie_a}}
HTTP 200
[Asserts]
jsonpath "$.items" count == 0

GET {{base_url}}/api/documents
Cookie: better-auth.session_token={{cookie_b}}
HTTP 200
[Asserts]
jsonpath "$.items" count == 1
jsonpath "$.items[0].id" == "{{other_id}}"

GET {{base_url}}/api/documents/{{root_id}}/versions
Cookie: better-auth.session_token={{cookie_a}}
HTTP 200
[Asserts]
jsonpath "$.items" count == 2
jsonpath "$.items[0].id" == "{{latest_id}}"
jsonpath "$.items[1].id" == "{{root_id}}"

GET {{base_url}}/api/documents/{{root_id}}/versions
Cookie: better-auth.session_token={{cookie_b}}
HTTP 404

GET {{base_url}}/api/documents/{{root_id}}/versions
HTTP 401
