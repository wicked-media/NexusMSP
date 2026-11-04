# Integration-test credentials

Authenticated tests must obtain their administrator login from environment
variables, never from a committed source file:

```powershell
$env:NEXUS_TEST_ADMIN_EMAIL = "admin@example.com"
$env:NEXUS_TEST_ADMIN_PASSWORD = "use-a-test-only-secret"
```

New tests should use `from credentials import admin_credentials` and pass the
returned mapping to the login request. Existing fixtures are progressively
being standardised on the same environment variables. Do not commit passwords,
tokens, or tenant secrets.
