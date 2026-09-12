const CORE_INTEGRATIONS = [
  {
    id: "rmm",
    label: "Remote management",
    detail: "Technician device access and health signals",
    tab: "integrations",
    actionLabel: "Review remote management",
  },
  {
    id: "m365",
    label: "Microsoft 365",
    detail: "Tenant relationship and identity operations",
    tab: "cipp",
    actionLabel: "Review Microsoft 365",
  },
  {
    id: "acronis",
    label: "Backup coverage",
    detail: "Protection source and recovery visibility",
    tab: "integrations",
    actionLabel: "Review backup coverage",
  },
];

function numberOrUnknown(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
function statusFromCount(value) {
  const count = numberOrUnknown(value);
  if (count === null) return "unknown";
  return count > 0 ? "complete" : "attention";
}

function formatCount(value, singular, plural = `${singular}s`) {
  const count = numberOrUnknown(value);
  if (count === null) return "Not confirmed";
  return `${count} ${count === 1 ? singular : plural}`;
}

function integrationStatus(integrations, id) {
  if (!Object.prototype.hasOwnProperty.call(integrations, id) || integrations[id] === null || integrations[id] === undefined) return "unknown";
  return integrations[id] ? "complete" : "attention";
}

function formatCurrency(value) {
  const amount = numberOrUnknown(value);
  if (amount === null) return null;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function isActiveOnboarding(client = {}) {
  const lifecycle = String(client.lifecycle || "").toLowerCase();
  const onboardingStatus = String(client.onboarding_status || "").toLowerCase();
  return lifecycle === "onboarding" || onboardingStatus === "in_progress" || onboardingStatus === "paused";
}

function hasUnstartedOnboarding(client = {}) {
  const lifecycle = String(client.lifecycle || "").toLowerCase();
  const onboardingStatus = String(client.onboarding_status || "").toLowerCase();
  return lifecycle === "prospect" || onboardingStatus === "not_started";
}

/**
 * Return the ordered, evidence-backed coverage checks for a client record.
 * A missing property remains unknown; it is never presented as an invented gap.
 */
export function getClientCoverageChecklist(client = {}) {
  const integrations = client.integrations && typeof client.integrations === "object" ? client.integrations : {};

  return [
    {
      id: "contacts",
      label: "Key contacts",
      detail: formatCount(client.contact_count, "contact"),
      status: statusFromCount(client.contact_count),
      tab: "contacts",
      actionLabel: numberOrUnknown(client.contact_count) === 0 ? "Add contact" : "Open contacts",
      attentionMessage: "Add the people technicians should contact before starting work.",
    },
    {
      id: "assets",
      label: "Managed estate",
      detail: formatCount(client.asset_count, "asset"),
      status: statusFromCount(client.asset_count),
      tab: "assets",
      actionLabel: numberOrUnknown(client.asset_count) === 0 ? "Add asset" : "Open assets",
      attentionMessage: "Record the devices and services Nexus is expected to protect.",
    },
    {
      id: "agreements",
      label: "Active agreements",
      detail: formatCount(client.active_contracts, "agreement"),
      status: statusFromCount(client.active_contracts),
      tab: "subscriptions",
      actionLabel: numberOrUnknown(client.active_contracts) === 0 ? "Add agreement" : "Open agreements",
      attentionMessage: "Link an active service agreement so scope and billing stay clear.",
    },
    ...CORE_INTEGRATIONS.map((integration) => ({
      ...integration,
      status: integrationStatus(integrations, integration.id),
      detail: integrationStatus(integrations, integration.id) === "complete"
        ? "Connected"
        : integrationStatus(integrations, integration.id) === "attention"
          ? "Not connected"
          : "Not confirmed",
      attentionMessage: `${integration.label} has not been connected to this client record.`,
    })),
  ];
}

/**
 * Pick one next action from evidence already held by the client record.
 * The action object is intentionally presentation-neutral so the caller owns navigation.
 */
export function getClientPrimaryPriority(client = {}) {
  const overdueCount = numberOrUnknown(client.overdue_count);
  const overdueAmount = numberOrUnknown(client.overdue_amount);
  const openTickets = numberOrUnknown(client.open_tickets);
  const healthScore = numberOrUnknown(client.health_score);
  const coverage = getClientCoverageChecklist(client);

  if ((overdueCount !== null && overdueCount > 0) || (overdueAmount !== null && overdueAmount > 0)) {
    const formattedAmount = formatCurrency(overdueAmount);
    return {
      id: "overdue-billing",
      eyebrow: "Commercial attention",
      title: formattedAmount ? `Resolve ${formattedAmount} overdue` : "Resolve overdue billing",
      description: overdueCount && overdueCount > 0
        ? `${overdueCount} outstanding invoice${overdueCount === 1 ? " requires" : "s require"} a clear next step.`
        : "An overdue balance is recorded against this account and needs a clear next step.",
      action: { kind: "navigate", tab: "billing", label: "Open billing" },
      tone: "rose",
    };
  }

  if (openTickets !== null && openTickets > 10) {
    return {
      id: "service-pressure",
      eyebrow: "Service attention",
      title: `${openTickets} open tickets need review`,
      description: "Check ownership, SLA exposure and repeat demand before more work is added.",
      action: { kind: "navigate", tab: "tickets", label: "Review tickets" },
      tone: "amber",
    };
  }

  if (isActiveOnboarding(client)) {
    return {
      id: "continue-onboarding",
      eyebrow: "Client onboarding",
      title: "Continue the onboarding plan",
      description: "The client is in onboarding. Keep the linked setup work moving before treating the account as complete.",
      action: { kind: "continue-onboarding", label: "Continue onboarding" },
      tone: "cyan",
    };
  }

  if (hasUnstartedOnboarding(client)) {
    return {
      id: "start-onboarding",
      eyebrow: "Client onboarding",
      title: "Start a linked onboarding plan",
      description: "Turn the initial setup into attributable work for people, assets, services and handover checks.",
      action: { kind: "start-onboarding", label: "Start onboarding" },
      tone: "cyan",
    };
  }

  if (healthScore !== null && healthScore < 70) {
    return {
      id: "health-intervention",
      eyebrow: "Health intervention",
      title: `Restore the ${healthScore}/100 health score`,
      description: "Review the operational evidence and address the weakest service condition first.",
      action: { kind: "navigate", tab: "security", label: "Review health" },
      tone: "amber",
    };
  }

  const firstGap = coverage.find((item) => item.status === "attention");
  if (firstGap) {
    return {
      id: `coverage-${firstGap.id}`,
      eyebrow: "Coverage gap",
      title: `Complete ${firstGap.label.toLowerCase()}`,
      description: firstGap.attentionMessage,
      action: { kind: "navigate", tab: firstGap.tab, label: firstGap.actionLabel },
      tone: "cyan",
    };
  }

  return {
    id: "account-review",
    eyebrow: "Account ready",
    title: "Keep the client record current",
    description: "Core relationship records are connected. Confirm contact and account details before the next review.",
    action: { kind: "edit-profile", label: "Review profile" },
    tone: "emerald",
  };
}

export function getClientCoverageSummary(checklist = []) {
  const known = checklist.filter((item) => item.status !== "unknown");
  const complete = known.filter((item) => item.status === "complete");
  return {
    complete: complete.length,
    known: known.length,
    unknown: checklist.length - known.length,
    total: checklist.length,
  };
}
