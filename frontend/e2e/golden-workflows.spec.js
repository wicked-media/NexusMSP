const { randomUUID } = require("node:crypto");
const { test, expect, request } = require("@playwright/test");

const API_ORIGIN = (process.env.NEXUS_ACCEPTANCE_BASE_URL || "").replace(/\/$/, "");
const TEST_ENVIRONMENT = /^(1|true|yes|on)$/i.test(process.env.NEXUS_TEST_ENVIRONMENT || "");

if (!API_ORIGIN || !TEST_ENVIRONMENT) {
  throw new Error(
    "Golden browser acceptance requires NEXUS_TEST_ENVIRONMENT=1 and an explicit NEXUS_ACCEPTANCE_BASE_URL.",
  );
}

const runId = randomUUID().slice(0, 8);
const fixture = {
  users: {},
  clients: {},
  devices: {},
  tickets: {},
  contracts: {},
  invoices: {},
  purchaseOrders: {},
  sites: {},
  portals: {},
};

function password() {
  return `Nexus!A9-${randomUUID()}-Z7`;
}

function email(label) {
  return `nexus-browser-${label}-${runId}@example.com`;
}

async function jsonBody(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function apiCall(api, method, path, { token, data, expected = 200 } = {}) {
  const response = await api.fetch(`${API_ORIGIN}/api${path}`, {
    method,
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeout: 30_000,
  });
  const body = await jsonBody(response);
  expect(response.status(), `${method} ${path}: ${JSON.stringify(body)}`).toBe(expected);
  return body;
}

async function browserCall(page, token, method, path, data) {
  return page.evaluate(
    async ({ apiOrigin, tokenValue, requestMethod, requestPath, requestData }) => {
      const response = await fetch(`${apiOrigin}/api${requestPath}`, {
        method: requestMethod,
        headers: {
          Authorization: `Bearer ${tokenValue}`,
          ...(requestData === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: requestData === undefined ? undefined : JSON.stringify(requestData),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, body };
    },
    {
      apiOrigin: API_ORIGIN,
      tokenValue: token,
      requestMethod: method,
      requestPath: path,
      requestData: data,
    },
  );
}

async function login(page, credentials) {
  await page.goto("/login");
  await expect(page.getByTestId("login-page")).toBeVisible();
  await page.getByTestId("login-email-input").fill(credentials.email);
  await page.getByTestId("login-password-input").fill(credentials.password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith("/api/auth/login")),
    page.getByTestId("login-submit-button").click(),
  ]);
  expect(response.status()).toBe(200);
  const payload = await response.json();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  return payload.token;
}

function observeRuntime(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().startsWith(API_ORIGIN) && response.status() >= 500) {
      failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return failures;
}

async function capture(page, testInfo, name) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

function expectDenied(result) {
  expect([403, 404]).toContain(result.status);
}

async function createClientEstate(api, adminToken, label) {
  const client = await apiCall(api, "POST", "/clients", {
    token: adminToken,
    data: { name: `Browser Acceptance Client ${label} ${runId}` },
  });
  const device = await apiCall(api, "POST", "/devices", {
    token: adminToken,
    data: { client_id: client.id, name: `Browser-${label}-WS01-${runId}`, device_type: "workstation" },
  });
  const ticket = await apiCall(api, "POST", "/tickets", {
    token: adminToken,
    data: {
      client_id: client.id,
      device_id: device.id,
      title: `Browser ${label} ticket ${runId}`,
      description: label === "A"
        ? "<img src=x onerror=window.__nexusBrowserXss=1> Browser acceptance payload"
        : "Foreign client browser acceptance fixture",
      priority: "medium",
    },
  });
  const contract = await apiCall(api, "POST", "/contracts", {
    token: adminToken,
    data: {
      client_id: client.id,
      name: `Browser ${label} Managed Service ${runId}`,
      start_date: "2026-09-01",
      value: 250,
    },
  });
  const invoice = await apiCall(api, "POST", "/invoices", {
    token: adminToken,
    data: {
      client_id: client.id,
      contract_id: contract.id,
      ticket_id: ticket.id,
      invoice_name: `Browser ${label} Invoice ${runId}`,
      due_date: "2026-10-15",
      line_items: [{ name: "Managed service", quantity: 1, unit_price: 250 }],
      tax_rate: 10,
    },
  });
  const purchaseOrder = await apiCall(api, "POST", "/purchase-orders", {
    token: adminToken,
    data: {
      client_id: client.id,
      client_name: client.name,
      ticket_id: ticket.id,
      vendor: `Browser Vendor ${label}`,
      line_items: [{
        product_name: `Replacement Router ${label}`,
        quantity: 1,
        unit_price: 125,
        destination_type: "ticket",
        destination_ticket_id: ticket.id,
      }],
    },
  });
  const site = await apiCall(api, "POST", "/web-studio/sites", {
    token: adminToken,
    data: {
      client_id: client.id,
      name: `Browser ${label} Website ${runId}`,
      primary_domain: `browser-${label.toLowerCase()}-${runId}.example.com`,
      platform: "wordpress",
      stage: "maintenance",
      billing_status: "not_linked",
    },
  });
  const portalEmail = email(`portal-${label.toLowerCase()}`);
  const portalUser = await apiCall(api, "POST", `/client-portal/users/${client.id}`, {
    token: adminToken,
    data: {
      name: `Browser ${label} Contact`,
      email: portalEmail,
      password: password(),
      can_view_all_tickets: true,
      can_create_tickets: true,
      can_view_assets: true,
      can_view_invoices: true,
      can_remote_devices: false,
      send_welcome_email: false,
    },
  });
  const portal = await apiCall(api, "POST", `/client-portal/generate-token/${client.id}`, {
    token: adminToken,
    data: {
      contact_name: `Browser ${label} Contact`,
      contact_email: portalEmail,
      expiry_days: 1,
    },
  });
  return { client, device, ticket, contract, invoice, purchaseOrder, site, portal, portalUser };
}

async function createTechnician(api, adminToken, label, clientId) {
  const credentials = {
    email: email(`tech-${label.toLowerCase()}`),
    password: password(),
  };
  const user = await apiCall(api, "POST", "/technicians", {
    token: adminToken,
    data: {
      name: `Browser ${label} Technician`,
      ...credentials,
      role: "service_desk_manager",
      client_scope_mode: "restricted",
      client_scope_ids: [clientId],
      site_scope_ids: [],
    },
  });

  // Exercise the same account-owned readiness contract a newly invited
  // technician must satisfy. The operational route guard is server-derived,
  // so acceptance identities must not bypass it with browser storage or UI
  // state injection.
  const session = await apiCall(api, "POST", "/auth/login", { data: credentials });
  const readiness = await apiCall(api, "GET", "/technician-onboarding/me", {
    token: session.token,
  });
  for (const step of readiness.onboarding.steps) {
    await apiCall(api, "POST", `/technician-onboarding/me/steps/${encodeURIComponent(step.id)}/complete`, {
      token: session.token,
      data: { acknowledged: true },
    });
  }
  return { ...credentials, user };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fixture.api = await request.newContext();
  const adminCredentials = { email: email("admin"), password: password() };
  const registration = await apiCall(fixture.api, "POST", "/auth/register", {
    data: { ...adminCredentials, name: "Nexus Browser Acceptance Administrator" },
  });
  fixture.users.admin = { ...adminCredentials, token: registration.token, user: registration.user };

  for (const label of ["A", "B"]) {
    const estate = await createClientEstate(fixture.api, registration.token, label);
    fixture.clients[label] = estate.client;
    fixture.devices[label] = estate.device;
    fixture.tickets[label] = estate.ticket;
    fixture.contracts[label] = estate.contract;
    fixture.invoices[label] = estate.invoice;
    fixture.purchaseOrders[label] = estate.purchaseOrder;
    fixture.sites[label] = estate.site;
    fixture.portals[label] = estate.portal;
    fixture.users[label] = await createTechnician(fixture.api, registration.token, label, estate.client.id);
  }
});

test.afterAll(async () => {
  await fixture.api?.dispose();
});

test("1 ticket delivery and client history remain scoped", async ({ page, browser }, testInfo) => {
  const failures = observeRuntime(page);
  const tokenA = await login(page, fixture.users.A);
  await page.goto("/tickets");
  await expect(page.getByTestId("tickets-page")).toBeVisible();
  await expect(page.getByText(fixture.tickets.A.title, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(fixture.tickets.B.title, { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => window.__nexusBrowserXss)).toBeUndefined();

  const publicReply = await browserCall(page, tokenA, "POST", `/tickets/${fixture.tickets.A.id}/comments`, {
    content: "<p>Browser acceptance update ready for client review.</p>",
    is_internal: false,
    notify_client: false,
  });
  expect(publicReply.status).toBe(200);
  expect(publicReply.body.portal_visible).toBe(true);
  expect(publicReply.body.delivery_status).toBe("portal_only");

  const foreignContext = await browser.newContext();
  const foreignPage = await foreignContext.newPage();
  const tokenB = await login(foreignPage, fixture.users.B);
  const foreignReply = await browserCall(foreignPage, tokenB, "POST", `/tickets/${fixture.tickets.A.id}/comments`, {
    content: "Rejected foreign browser update",
    is_internal: false,
    notify_client: false,
  });
  expectDenied(foreignReply);
  await foreignContext.close();

  const resolved = await browserCall(page, tokenA, "PUT", `/tickets/${fixture.tickets.A.id}`, {
    status: "resolved",
    resolution_notes: "Browser acceptance completed.",
  });
  expect(resolved.status).toBe(200);
  expect(resolved.body.ticket.status).toBe("closed");

  await page.goto(`/portal/${fixture.portals.A.token}`);
  await expect(page.getByTestId("portal-dashboard")).toBeVisible();
  await page.getByTestId("portal-nav-requests").click();
  await expect(page.getByText(fixture.tickets.A.title, { exact: false }).first()).toBeVisible();
  await page.getByText(fixture.tickets.A.title, { exact: false }).first().click();
  await expect(page.getByText("Browser acceptance update ready for client review.", { exact: false })).toBeVisible();
  await capture(page, testInfo, "01-ticket-client-history");
  expect(failures).toEqual([]);
});

test("2 remote request fails honestly when transport is unavailable and masks foreign devices", async ({ page }, testInfo) => {
  const failures = observeRuntime(page);
  const token = await login(page, fixture.users.A);
  await page.goto(`/nexus-remote?device=${fixture.devices.A.id}&ticket=${fixture.tickets.A.id}`);
  await expect(page.getByTestId("remote-access-page")).toBeVisible();
  const unavailable = await browserCall(page, token, "POST", `/devices/${fixture.devices.A.id}/remote-sessions/start`, {
    ticket_id: fixture.tickets.A.id,
    provider: "rustdesk",
    consent_confirmed: true,
    consent_method: "attended_prompt",
    purpose: "Disposable browser acceptance",
    idempotency_key: `browser-remote-${runId}`,
  });
  expect(unavailable.status).toBe(409);
  expect(unavailable.body.detail).toMatch(/not enabled|not enrolled/i);
  const foreign = await browserCall(page, token, "POST", `/devices/${fixture.devices.B.id}/remote-sessions/start`, {
    provider: "rustdesk",
    consent_confirmed: true,
  });
  expectDenied(foreign);
  await capture(page, testInfo, "02-remote-provider-unavailable");
  expect(failures).toEqual([]);
});

test("3 purchase order receipt records ticket notification and rejects foreign orders", async ({ page, browser }, testInfo) => {
  const failures = observeRuntime(page);
  const token = await login(page, fixture.users.A);
  await page.goto("/purchase-orders");
  await expect(page.getByTestId("purchase-orders-page")).toBeVisible();
  await expect(page.getByText(fixture.purchaseOrders.A.po_number, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(fixture.purchaseOrders.B.po_number, { exact: false })).toHaveCount(0);

  const foreign = await browserCall(page, token, "GET", `/purchase-orders/${fixture.purchaseOrders.B.id}`);
  expectDenied(foreign);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminToken = await login(adminPage, fixture.users.admin);
  const approvalRequest = await browserCall(
    adminPage,
    adminToken,
    "POST",
    `/purchase-orders/${fixture.purchaseOrders.A.id}/submit-for-approval`,
    {},
  );
  expect(approvalRequest.status).toBe(200);
  const approval = await browserCall(
    adminPage,
    adminToken,
    "POST",
    `/purchase-orders/${fixture.purchaseOrders.A.id}/approve`,
    { notes: "Approved for disposable browser acceptance" },
  );
  expect(approval.status).toBe(200);
  const submitted = await browserCall(adminPage, adminToken, "PUT", `/purchase-orders/${fixture.purchaseOrders.A.id}`, {
    status: "submitted",
  });
  expect(submitted.status).toBe(200);
  await adminContext.close();

  const receipt = await browserCall(page, token, "POST", `/purchase-orders/${fixture.purchaseOrders.A.id}/receive`, {
    items: [{ line_index: 0, quantity: 1 }],
    packing_slip_number: `SLIP-${runId}`,
    evidence_reference: "Disposable browser acceptance",
    idempotency_key: `browser-po-receive-${runId}`,
  });
  expect(receipt.status).toBe(200);
  expect(receipt.body.status).toBe("received");
  expect(receipt.body.ticket_notifications).toHaveLength(1);
  await capture(page, testInfo, "03-purchase-order-scope");
  expect(failures).toEqual([]);
});

test("4 invoice and provider handoff state remain client scoped", async ({ page, browser }, testInfo) => {
  const failures = observeRuntime(page);
  const token = await login(page, fixture.users.A);
  await page.goto("/invoices");
  await expect(page.getByTestId("invoices-page")).toBeVisible();
  await expect(page.getByText(fixture.invoices.A.invoice_number, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(fixture.invoices.B.invoice_number, { exact: false })).toHaveCount(0);
  const foreign = await browserCall(page, token, "GET", `/invoices/${fixture.invoices.B.id}`);
  expectDenied(foreign);
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminToken = await login(adminPage, fixture.users.admin);
  const xero = await browserCall(adminPage, adminToken, "GET", "/xero/status");
  expect(xero.status).toBe(200);
  expect(xero.body.connected || xero.body.configured || false).toBe(false);
  await adminContext.close();
  const current = await browserCall(page, token, "GET", `/invoices/${fixture.invoices.A.id}`);
  expect(current.status).toBe(200);
  expect(current.body.payment_status).toBe("unpaid");
  await capture(page, testInfo, "04-invoice-pending-provider");
  expect(failures).toEqual([]);
});

test("5 contract records stay client scoped and organisation reconciliation stays global", async ({ page, browser }, testInfo) => {
  const failures = observeRuntime(page);
  const token = await login(page, fixture.users.A);
  await page.goto("/billing-recon");
  await expect(page.getByTestId("billing-recon-page")).toBeVisible();
  const own = await browserCall(page, token, "GET", `/contracts/${fixture.contracts.A.id}`);
  expect(own.status).toBe(200);
  const foreign = await browserCall(page, token, "GET", `/contracts/${fixture.contracts.B.id}`);
  expectDenied(foreign);
  const restrictedOverview = await browserCall(page, token, "GET", "/billing-recon/overview");
  expect(restrictedOverview.status).toBe(403);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminToken = await login(adminPage, fixture.users.admin);
  const overview = await browserCall(adminPage, adminToken, "GET", "/billing-recon/overview");
  expect(overview.status).toBe(200);
  await adminContext.close();
  await capture(page, testInfo, "05-contract-reconciliation-scope");
  expect(failures).toEqual([]);
});

test("6 PBX workspace keeps an unconfigured provider honest and denies foreign linking", async ({ page }, testInfo) => {
  const failures = observeRuntime(page);
  const token = await login(page, fixture.users.A);
  await page.goto("/voice");
  await expect(page.getByTestId("voice-workspace-page")).toBeVisible();
  const voice = await browserCall(page, token, "GET", "/yeastar/voice-workspace");
  expect(voice.status).toBe(200);
  expect(JSON.stringify(voice.body)).not.toContain(fixture.clients.B.name);
  const foreign = await browserCall(page, token, "POST", "/yeastar/pbxs", {
    client_id: fixture.clients.B.id,
    name: "Rejected foreign PBX",
    pbx_url: "https://pbx.invalid",
    client_api_id: "browser-test",
    client_secret: "ephemeral-browser-test-only",
  });
  expectDenied(foreign);
  await capture(page, testInfo, "06-voice-provider-unconfigured");
  expect(failures).toEqual([]);
});

test("7 Microsoft control plane separates saved configuration from verified provider evidence", async ({ page }, testInfo) => {
  const failures = observeRuntime(page);
  const token = await login(page, fixture.users.A);
  await page.goto("/control-plane?module=microsoft365&view=connections");
  await expect(page.getByTestId("nexus-control-plane")).toBeVisible();
  const readiness = await browserCall(page, token, "GET", "/m365/sync/readiness");
  expect(readiness.status).toBe(200);
  expect(JSON.stringify(readiness.body)).not.toMatch(/client_secret|refresh_token|access_token/i);
  const globalOnly = await browserCall(page, token, "POST", "/m365/onboarding/tenants", {
    tenant_id: randomUUID(),
    tenant_name: "Rejected browser tenant",
    primary_domain: "rejected.example.com",
    client_id: fixture.clients.B.id,
  });
  expectDenied(globalOnly);
  await capture(page, testInfo, "07-microsoft-control-plane");
  expect(failures).toEqual([]);
});

test("8 Web Studio records pending connector intent without crossing client scope", async ({ page }, testInfo) => {
  const failures = observeRuntime(page);
  const token = await login(page, fixture.users.A);
  await page.goto("/web-studio");
  await expect(page.getByTestId("web-studio-portfolio")).toBeVisible();
  await expect(page.getByText(fixture.sites.A.name, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(fixture.sites.B.name, { exact: false })).toHaveCount(0);
  const pending = await browserCall(page, token, "POST", `/web-studio/sites/${fixture.sites.A.id}/provider-actions`, {
    action: "renewal_plan",
    reason: "Disposable browser acceptance request",
  });
  expect(pending.status).toBe(200);
  expect(pending.body.action.status).toBe("pending_connector");
  const foreign = await browserCall(page, token, "POST", `/web-studio/sites/${fixture.sites.B.id}/provider-actions`, {
    action: "renewal_plan",
    reason: "Rejected foreign request",
  });
  expectDenied(foreign);
  await capture(page, testInfo, "08-web-studio-pending-connector");
  expect(failures).toEqual([]);
});
