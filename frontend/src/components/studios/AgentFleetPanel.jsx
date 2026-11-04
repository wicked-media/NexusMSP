import {
  ObservationError,
  ObservationHeader,
  ObservationLoading,
  ObservationNote,
  ObservationUnbound,
  Observed,
  ObservedEmpty,
  ObservedRows,
  ObservedTotals,
  useStudioObservation,
} from "./StudioObservationKit";

/**
 * Agent Studio's Inventory tab: the agent fleet the platform actually observes.
 *
 * The Nexus Agent Centre already serves this projection at `/nexus-agent/agents`
 * — the enrolled agent records, with `agent_token` removed server-side and two
 * derived fields added (`online`, and a `trust` object computed by the agent
 * trust projection). The studio adopts that projection instead of building a
 * second fleet list, so the two surfaces cannot disagree about a machine.
 *
 * What this panel models, and nothing more: the identity the endpoint reported
 * (hostname, client, transport, policy version, self-repair state, trust
 * status) and when it was last seen. An agent that never reported a field is
 * shown as not reported rather than as a clean identity, and a fingerprint,
 * install id or token is never rendered here.
 */

const TRUST_DOT = {
  mtls_verified: "bg-emerald-500",
  certificate_issued: "bg-amber-500",
  certificate_expired: "bg-amber-500",
};

export default function AgentFleetPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const agents = Array.isArray(data) ? data : [];
  const online = agents.filter((agent) => agent.online === true).length;
  const verified = agents.filter((agent) => agent.trust?.status === "mtls_verified").length;

  const rows = agents.map((agent) => ({
    key: agent.device_id || agent.id,
    label: agent.hostname || agent.name || agent.device_id || agent.id,
    meta: [
      <Observed key="client" value={agent.client_name || agent.client_id} what="client" />,
      <Observed key="transport" value={agent.trust?.transport} what="transport" />,
      <Observed
        key="policy"
        value={
          agent.trust?.policy_version === null || agent.trust?.policy_version === undefined
            ? null
            : `policy v${agent.trust.policy_version}`
        }
        what="policy version"
      />,
      <Observed
        key="self-repair"
        value={
          agent.trust?.self_repair_status && agent.trust.self_repair_status !== "not_reported"
            ? agent.trust.self_repair_status
            : null
        }
        what="self-repair state"
      />,
    ],
    status: agent.trust?.status,
    dotClass: TRUST_DOT[String(agent.trust?.status || "").toLowerCase()] || "bg-slate-500",
    observedAt: agent.last_seen,
  }));

  return (
    <div className="space-y-3" data-testid="studio-agent-fleet">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading the observed agent fleet…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && agents.length === 0 && (
        <ObservedEmpty
          title="No agent in your scope has enrolled or reported"
          note="This endpoint returns enrolled agent records only, so an empty list means no machine in your boundary is reporting — an observed absence, not a clean fleet. Nothing on this tab installs, commands or re-keys an agent."
        />
      )}

      {!loading && !error && agents.length > 0 && (
        <>
          <ObservedTotals
            totals={[
              { label: "Agents in scope", value: agents.length },
              { label: "Reporting online", value: online },
              {
                label: "mTLS verified identity",
                value: verified,
                detail:
                  verified === agents.length
                    ? "Every reporting agent carries a verified client-certificate transport."
                    : `${agents.length - verified} agent record(s) do not carry a verified client-certificate transport; their trust status names what they do carry.`,
              },
            ]}
          />
          <ObservedRows rows={rows} label="Enrolled agents, most recently seen first" />
        </>
      )}

      <ObservationNote>
        Agent identity trust is derived server-side by the agent trust projection, and this endpoint
        never returns an agent token or certificate material. A field an agent has not reported is
        shown as not reported rather than as a clean state, and nothing on this tab issues a command
        or changes a policy.
      </ObservationNote>
    </div>
  );
}
