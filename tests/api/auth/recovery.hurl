POST {{base_url}}/api/auth/update-user
Origin: {{base_url}}
Content-Type: application/json
{"name":"Anonymous fixture"}
HTTP 401

POST {{base_url}}/api/auth/request-password-reset
Origin: {{base_url}}
Content-Type: application/json
{"email":"{{unknown_email}}","redirectTo":"/en/reset-password"}
HTTP 200
[Asserts]
jsonpath "$.status" == true
jsonpath "$.message" isString

POST {{base_url}}/api/auth/reset-password
Origin: {{base_url}}
Content-Type: application/json
{"token":"invalid-fixture-token","newPassword":"Fixture-password-42!"}
HTTP 400
[Asserts]
jsonpath "$.code" == "INVALID_TOKEN"

GET {{base_url}}/en/forgot-password
HTTP 200

GET {{base_url}}/en/reset-password
HTTP 200
