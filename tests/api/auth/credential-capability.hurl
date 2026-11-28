GET {{base_url}}/api/auth/credential-capability
HTTP 401

GET {{base_url}}/api/auth/credential-capability?userId={{other_user_id}}
Cookie: better-auth.session_token={{password_cookie}}
HTTP 200
[Asserts]
header "Cache-Control" == "private, no-store"
jsonpath "$.status" == "password"

GET {{base_url}}/api/auth/credential-capability
Cookie: better-auth.session_token={{social_cookie}}
HTTP 200
[Asserts]
header "Cache-Control" == "private, no-store"
jsonpath "$.status" == "none"

GET {{base_url}}/api/auth/credential-capability
Cookie: better-auth.session_token={{unknown_cookie}}
HTTP 200
[Asserts]
header "Cache-Control" == "private, no-store"
jsonpath "$.status" == "unknown"
