import NexusWorkspaceHeader from "@/components/NexusWorkspaceHeader";

/**
 * Standard page header for operational tools that are not part of a module hub.
 * Keep titles, descriptions, and primary actions in one predictable treatment.
 */
export default function OperationalPageHeader(props) {
  return <NexusWorkspaceHeader {...props} />;
}
