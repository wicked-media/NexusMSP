"""Quality-of-life tools: note translators and diagnostic verdict helpers.

Pure, dependency-free text and verdict logic so the delight layer stays
testable without an LLM or network.  The translators are deliberately
rule-based: text never leaves the server and the output is always a draft a
technician can edit before sending.
"""

from __future__ import annotations

import re

# Technician venting -> composed professional language.
_PROFANITY_MAP = [
    (r"\bf+u+c+k+(ing|ed|s)?\b", "notably"),
    (r"\bsh+i+t+(ty|ty)?\b", "suboptimal"),
    (r"\bass(hole|hat)?\b", "colleague"),
    (r"\bbl+o+a+t+s+u+c+k+s?\b", "regrettably"),
    (r"\bd+a+m+n+(it|ed)?\b", "unfortunately"),
    (r"\bbull+s+h+i+t\b", "concerning feedback"),
    (r"\bc+r+a+p+\b", "issue"),
    (r"\bidiots?\b", "stakeholders"),
    (r"\bmorons?\b", "stakeholders"),
    (r"\buseless\b", "suboptimal"),
]

_FILLER_MAP = [
    (r"\bgonna\b", "going to"),
    (r"\bwanna\b", "want to"),
    (r"\bkids?\b", "users"),
    (r"\bthingy\b", "component"),
]

# Technician jargon -> customer-friendly language for the customer update view.
_CUSTOMER_GLOSSARY = [
    (r"\bTCP/?IP stack\b", "the computer's network configuration"),
    (r"\bTCP/IP stack\b", "the computer's network configuration"),
    (r"\bflush(ed)? (the )?(DNS|resolver) (cache|entries)?\b", "refreshed its network addressing"),
    (r"\bipconfig\s*/(flushdns|renew|registerdns)\b", "renewed the computer's network settings"),
    (r"\brenew(ed)? (the )?DHCP lease\b", "renewed its network connection"),
    (r"\bDNS\b", "the internet's address book"),
    (r"\bDHCP\b", "automatic network addressing"),
    (r"\bVPN (tunnel|connection)s?\b", "secure remote connections"),
    (r"\b(OST|PST) (file|archive)s?\b", "mail data files"),
    (r"\bOutlook profile\b", "mail account setup"),
    (r"\b(Windows )?registry\b", "system settings"),
    (r"\bgpupdate\s*/force\b", "refreshed the security policies"),
    (r"\bGPO(s)?\b", "policies"),
    (r"\bBSOD\b", "unexpected restart"),
    (r"\bEvent (ID )?10016\b", "a system event"),
    (r"\belevat(e|ed|ion) (the )?(privileges?|rights?)\b", "used administrative access"),
    (r"\bNIC\b", "network card"),
    (r"\bRAID (array|volume)s?\b", "the storage system"),
    (r"\bfirmware (flash|update)\b", "device software update"),
    (r"\bdeploy(ed|ing)? (the )?(patch|update)s?\b", "installed updates"),
]


def _apply(text: str, rules: list[tuple[str, str]]) -> str:
    result = text
    for pattern, replacement in rules:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def _tidy(text: str) -> str:
    text = re.sub(r"\s{2,}", " ", text).strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text[0].upper() + text[1:] if text else text


def professionalise(text: str) -> str:
    """Offer the composed version of a venting internal note."""
    cleaned = _apply(str(text or ""), [*_PROFANITY_MAP, *_FILLER_MAP])
    return _tidy(cleaned)


def to_customer_update(text: str) -> str:
    """Rewrite technical technician notes as a customer-friendly update."""
    source = professionalise(text)
    translated = _apply(source, _CUSTOMER_GLOSSARY)
    return _tidy(translated)


def translate(text: str, mode: str) -> str:
    if mode == "professionalise":
        return professionalise(text)
    if mode == "customer":
        return to_customer_update(text)
    raise ValueError("unknown translation mode")


# ============== DNS VERDICT (pure logic; I/O stays in the service) ==============

def dns_verdict(results: list[dict]) -> dict:
    """Turn resolver observations into a YES/NO/MAYBE answer.

    ``results`` items: {"host": str, "ok": bool, "ms": float, "addresses": [..]}.
    """
    if not results:
        return {
            "answer": "MAYBE",
            "confidence": "low",
            "headline": "No hostnames were available to test.",
            "reasons": ["Add devices or a client domain so Nexus has names to resolve."],
            "checks": [],
        }
    failures = [r for r in results if not r.get("ok")]
    slow = [r for r in results if r.get("ok") and float(r.get("ms") or 0) > 250]
    checks = [
        {"host": r["host"], "resolved": bool(r.get("ok")), "ms": round(float(r.get("ms") or 0), 1),
         "addresses": list(r.get("addresses") or [])[:4]}
        for r in results
    ]
    if failures:
        return {
            "answer": "YES",
            "confidence": "high",
            "headline": "Yes. It's DNS.",
            "reasons": [f"{len(failures)} of {len(results)} names failed to resolve."] +
                       [f"{f['host']} did not resolve." for f in failures[:3]],
            "checks": checks,
        }
    if slow:
        return {
            "answer": "MAYBE",
            "confidence": "medium",
            "headline": "DNS is answering, but slowly.",
            "reasons": [f"{len(slow)} name(s) resolved in over 250ms — look at the resolver or upstream."] +
                       [f"{s['host']} took {round(float(s['ms']), 0)}ms." for s in slow[:3]],
            "checks": checks,
        }
    return {
        "answer": "NO",
        "confidence": "high",
        "headline": "No. It's not DNS.",
        "reasons": [
            f"All {len(results)} names resolved quickly and consistently.",
            "It's never DNS. (Have you checked the firewall?)",
        ],
        "checks": checks,
    }
