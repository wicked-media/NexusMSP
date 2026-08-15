"""Guarded Synergy Wholesale SOAP connector.

Nexus owns the workflow and audit record; this module only performs the final
provider call after policy and approval have been evaluated by the router.  The
operation catalogue is deliberately explicit so unsupported SOAP methods can
never be invoked by passing arbitrary method names from the browser.
"""
from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException


def _catalogue(*operations: tuple[str, str, str, bool]) -> dict[str, dict[str, Any]]:
    return {
        operation_id: {"id": operation_id, "command": command, "area": area, "mutates": mutates}
        for operation_id, command, area, mutates in operations
    }


# Synergy Wholesale API v3.17 capability map.  WSDL discovery is still checked
# before execution, protecting Nexus if the provider changes a SOAP operation.
SYNERGY_OPERATIONS = _catalogue(
    ("account.balance", "balanceQuery", "account", False),
    ("domain.info", "domainInfo", "domains", False), ("domain.list", "listDomains", "domains", False),
    ("domain.availability", "checkDomain", "domains", False), ("domain.bulk_availability", "bulkCheckDomain", "domains", False),
    ("domain.pricing", "getDomainPricing", "domains", False), ("domain.register", "domainRegister", "domains", True),
    ("domain.renew", "renewDomain", "domains", True), ("domain.restore", "restoreDomain", "domains", True),
    ("domain.transfer", "transferDomain", "domains", True), ("domain.transfer_cancel", "transferCancel", "domains", True),
    ("domain.nameservers", "updateNameServers", "domains", True), ("domain.contacts", "updateContacts", "domains", True),
    ("domain.lock", "lockDomain", "domains", True), ("domain.unlock", "unlockDomain", "domains", True),
    ("domain.dnssec_list", "DNSSECListDS", "domains", False), ("domain.dnssec_add", "DNSSECAddDS", "domains", True),
    ("domain.dnssec_remove", "DNSSECRemoveDS", "domains", True), ("domain.id_protection_enable", "enableIDProtection", "domains", True),
    ("domain.id_protection_disable", "disableIDProtection", "domains", True), ("domain.auto_renew_enable", "enableAutoRenewal", "domains", True),
    ("domain.auto_renew_disable", "disableAutoRenewal", "domains", True),
    ("dns.zone_list", "listDNSZone", "dns", False), ("dns.zone_add", "addDNSZone", "dns", True),
    ("dns.zone_delete", "deleteDNSZone", "dns", True), ("dns.record_get", "getDNSRecord", "dns", False),
    ("dns.record_add", "addDNSRecord", "dns", True), ("dns.record_update", "updateDNSRecord", "dns", True),
    ("dns.record_delete", "deleteDNSRecord", "dns", True), ("dns.mail_forward_list", "listMailForwards", "dns", False),
    ("dns.mail_forward_add", "addMailForward", "dns", True), ("dns.mail_forward_delete", "deleteMailForward", "dns", True),
    ("dns.url_forward_list", "listSimpleURLForwards", "dns", False), ("dns.url_forward_add", "addSimpleURLForward", "dns", True),
    ("dns.url_forward_delete", "deleteSimpleURLForward", "dns", True),
    ("hosting.list", "listHosting", "hosting", False), ("hosting.info", "hostingGetService", "hosting", False),
    ("hosting.packages", "hostingListPackages", "hosting", False), ("hosting.purchase", "hostingPurchaseService", "hosting", True),
    ("hosting.suspend", "hostingSuspendService", "hosting", True), ("hosting.unsuspend", "hostingUnsuspendService", "hosting", True),
    ("hosting.password", "hostingChangePassword", "hosting", True), ("hosting.package", "hostingChangePackage", "hosting", True),
    ("hosting.preview_enable", "hostingEnableTempUrl", "hosting", True), ("hosting.preview_disable", "hostingDisableTempUrl", "hosting", True),
    ("hosting.firewall_check", "hostingCheckFirewall", "hosting", False), ("hosting.firewall_unblock", "hostingUnblockFirewall", "hosting", True),
    ("hosting.recreate", "hostingRecreateService", "hosting", True), ("hosting.terminate", "hostingTerminateService", "hosting", True),
    ("hosting.login", "hostingGetLogin", "hosting", False),
    ("ssl.pricing", "getSSLPricing", "ssl", False), ("ssl.status", "SSL_getCertificateStatus", "ssl", False),
    ("ssl.csr_generate", "SSL_generateCSR", "ssl", False), ("ssl.csr_decode", "SSL_decodeCSR", "ssl", False),
    ("ssl.purchase", "SSL_purchaseCertificate", "ssl", True), ("ssl.renew", "SSL_renewCertificate", "ssl", True),
    ("ssl.reissue", "SSL_reissueCertificate", "ssl", True), ("ssl.cancel", "SSL_cancelCertificate", "ssl", True),
    ("ssl.resend_approval", "SSL_resendApprovalEmail", "ssl", True), ("ssl.list", "SSL_listAllCertificates", "ssl", False),
    ("ssl.txt_check", "SSL_checkTxtCodes", "ssl", False),
    ("m365.client_list", "subscriptionListClients", "microsoft365", False), ("m365.client_create", "subscriptionCreateClient", "microsoft365", True),
    ("m365.client_update", "subscriptionUpdateClient", "microsoft365", True), ("m365.purchasable", "subscriptionListPurchasable", "microsoft365", False),
    ("m365.subscription_purchase", "subscriptionPurchase", "microsoft365", True), ("m365.subscription_details", "subscriptionGetDetails", "microsoft365", False),
    ("m365.subscription_quantity", "subscriptionUpdateQuantity", "microsoft365", True), ("m365.subscription_suspend", "subscriptionSuspend", "microsoft365", True),
    ("m365.subscription_unsuspend", "subscriptionUnsuspend", "microsoft365", True), ("m365.subscription_list", "subscriptionListClientSubscriptions", "microsoft365", False),
    ("m365.subscription_terminate", "subscriptionTerminate", "microsoft365", True),
)

_CREDENTIAL_KEYS = frozenset({"resellerid", "apikey", "reseller_id", "api_key"})


def connector_status(credentials: Mapping[str, Any] | None = None) -> dict[str, Any]:
    credentials = credentials or {}
    reseller_id = str(credentials.get("reseller_id") or os.environ.get("SYNERGY_WHOLESALE_RESELLER_ID") or "").strip()
    api_key = str(credentials.get("api_key") or os.environ.get("SYNERGY_WHOLESALE_API_KEY") or "").strip()
    wsdl = str(credentials.get("wsdl") or os.environ.get("SYNERGY_WHOLESALE_WSDL") or "").strip()
    configured = bool(reseller_id and api_key)
    try:
        import zeep  # noqa: F401
        library_ready = True
    except ImportError:
        library_ready = False
    return {"configured": configured, "wsdl_configured": bool(wsdl), "client_library_ready": library_ready,
            "ready": configured and bool(wsdl) and library_ready, "endpoint": "https://api.synergywholesale.com"}


def public_catalogue() -> list[dict[str, Any]]:
    return list(SYNERGY_OPERATIONS.values())


def validate_parameters(parameters: Mapping[str, Any]) -> dict[str, Any]:
    if any(str(key).replace("-", "_").lower() in _CREDENTIAL_KEYS for key in parameters):
        raise HTTPException(status_code=400, detail="Provider credentials are server-managed and cannot be supplied in an action")
    return dict(parameters)


def seal_action_parameters(parameters: Mapping[str, Any]) -> str:
    """Encrypt pending action inputs; provider changes must not persist clear text."""
    key = os.environ.get("SYNERGY_ACTION_ENCRYPTION_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Synergy action encryption is not configured")
    try:
        from cryptography.fernet import Fernet
        import json
        return Fernet(key.encode()).encrypt(json.dumps(validate_parameters(parameters)).encode()).decode()
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="Synergy action encryption key is invalid") from exc


def unseal_action_parameters(ciphertext: str) -> dict[str, Any]:
    key = os.environ.get("SYNERGY_ACTION_ENCRYPTION_KEY", "").strip()
    if not key or not ciphertext:
        raise HTTPException(status_code=503, detail="The encrypted Synergy action input is unavailable")
    try:
        from cryptography.fernet import Fernet
        import json
        return validate_parameters(json.loads(Fernet(key.encode()).decrypt(ciphertext.encode()).decode()))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The encrypted Synergy action input could not be decrypted") from exc


def execute(operation_id: str, parameters: Mapping[str, Any], credentials: Mapping[str, Any] | None = None) -> Any:
    operation = SYNERGY_OPERATIONS.get(operation_id)
    if not operation:
        raise HTTPException(status_code=404, detail="Unknown Synergy Wholesale operation")
    credentials = credentials or {}
    reseller_id = str(credentials.get("reseller_id") or os.environ.get("SYNERGY_WHOLESALE_RESELLER_ID") or "").strip()
    api_key = str(credentials.get("api_key") or os.environ.get("SYNERGY_WHOLESALE_API_KEY") or "").strip()
    wsdl = str(credentials.get("wsdl") or os.environ.get("SYNERGY_WHOLESALE_WSDL") or "").strip()
    status = connector_status({"reseller_id": reseller_id, "api_key": api_key, "wsdl": wsdl})
    if not status["ready"]:
        raise HTTPException(status_code=503, detail="Synergy connector requires server credentials, source-IP allowlisting, WSDL configuration and the SOAP client dependency")
    try:
        from zeep import Client
        from zeep.helpers import serialize_object
    except ImportError as exc:  # defensive: status check can race deployment
        raise HTTPException(status_code=503, detail="Synergy SOAP client is not installed") from exc
    client = Client(wsdl)
    method = getattr(client.service, operation["command"], None)
    if method is None:
        raise HTTPException(status_code=503, detail="Configured Synergy WSDL does not expose this documented operation")
    payload = validate_parameters(parameters)
    payload.update({"resellerID": reseller_id, "apiKey": api_key})
    return serialize_object(method(**payload))
