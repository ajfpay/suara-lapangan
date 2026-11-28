POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.1
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.2
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.3
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.4
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.5
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.6
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.7
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.8
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.9
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.10
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: ::ffff:{{client_ip}}
X-Auth-Client-IP: 203.0.113.11
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 429
[Asserts]
header "X-Retry-After" exists
jsonpath "$.message" isString

POST {{base_url}}/api/auth/sign-in/email
Origin: {{base_url}}
Content-Type: application/json
X-Forwarded-For: {{client_ip}}
X-Auth-Client-IP: 203.0.113.12
[Options]
delay: 61000
{"email":"{{unknown_email}}","password":"Fixture-password-42!"}
HTTP 401
