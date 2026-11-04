export const STANDARD_SERVICE_KIT = "standard";

export const SERVICE_KITS = [
  {
    id: "workshop_repair",
    name: "Workshop Repair Kit",
    shortName: "Workshop",
    workflow: "workshop",
    description: "Device intake, repair bench, parts, quote, verification and customer handover.",
    outcome: "Creates one parent ticket and a linked workshop work card.",
    accent: "cyan",
  },
  {
    id: "cabling_field",
    name: "Cabling & Field Kit",
    shortName: "Field service",
    workflow: "field",
    description: "Site brief, dispatch, materials, verification evidence and sign-off.",
    outcome: "Creates one parent ticket and a linked field-service work card.",
    accent: "violet",
  },
];

export const SERVICE_KIT_DEFAULT_CONTEXT = {
  workshop_repair: {
    device_type: "",
    device_brand: "",
    device_model: "",
    serial_number: "",
    condition_on_arrival: "",
    accessories_received: [],
  },
  cabling_field: {
    service_address: "",
    zone: "",
    job_category: "installation",
    scheduled_date: "",
    scheduled_time: "",
    estimated_duration: 60,
  },
};

export function serviceKitById(id) {
  return SERVICE_KITS.find((kit) => kit.id === id) || null;
}

export function serviceKitContextFor(id, existing = {}) {
  if (!SERVICE_KIT_DEFAULT_CONTEXT[id]) return {};
  return { ...SERVICE_KIT_DEFAULT_CONTEXT[id], ...(existing || {}) };
}

export function serviceKitCreateLabel(id) {
  const kit = serviceKitById(id);
  return kit ? `Create ticket and start ${kit.shortName} kit` : "Create and open ticket";
}
