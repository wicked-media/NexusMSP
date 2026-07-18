# Integration-test credentials

Authenticated tests must obtain their administrator login from environment
variables, never from a committed source file:

```powershell
$env:NEXUS_TEST_ADMIN_EMAIL = "admin@example.com"
$env:NEXUS_TEST_ADMIN_PASSWORD = "use-a-test-only-secret"
```

Use `from credentials import admin_credentials` in test files, then pass the
returned mapping to the login request. Do not commit passwords, tokens, or
tenant secrets.
