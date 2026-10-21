"""Autonomy levels per action type (docs/SPEC.md "Policy, approvals and autonomy").

The gateway checks these when an agent calls a tool, so a prompt cannot talk its way past them.
"""
OFF, ASK, DO_AND_TELL, AUTO = 0, 1, 2, 3
LEVEL_NAMES = {OFF: "off", ASK: "ask", DO_AND_TELL: "do_and_tell", AUTO: "auto"}

# Defaults for a normal install. Staff permissions override per agent.
DEFAULTS: dict[str, int] = {
    "knowledge.read": AUTO,
    "report": AUTO,
    "content.draft": DO_AND_TELL,
    "outreach.draft": DO_AND_TELL,
    "content.publish": ASK,
    "outreach.send": ASK,
    "code.pr": DO_AND_TELL,
    "code.merge": OFF,
    "deploy": OFF,
    "db.write": OFF,
    "ops.command": ASK,
    "money.spend": ASK,
    "pricing.change": ASK,
    "staff.change": ASK,
    "staff.delegate": OFF,  # Chief of Staff gets AUTO
    "kpi.write": OFF,  # Finance gets AUTO
    "goal.create": OFF,  # Chief of Staff and planning-capable staff get DO_AND_TELL+
    "connector.install": ASK,
    "connector.grant": ASK,
    "skill.change": ASK,
    "docs.write": DO_AND_TELL,  # shared Docs: edit directly, the owner gets a notice and every version is kept
    "knowledge.write": ASK,  # Company knowledge in Docs: a suggestion the owner approves
    "staff.create": ASK,
    "staff.retire": ASK,
    "staff.grant": ASK,
    "folder.grant": ASK,
    "workflow.change": DO_AND_TELL,
}

# Actions that always require owner approval — never auto-run even in permissive/Auto mode.
# These are credential, auth, and irreversible infra operations.
ALWAYS_ASK: frozenset[str] = frozenset({
    "ai.key",
    "harness.account",
    "staff.token_rotate",
    "founder.auth",
    "company.delete",
})

# In strict mode (first weeks of an install) anything above ASK that leaves the company drops to ASK.
EXTERNAL = {"content.publish", "outreach.send", "ops.command", "money.spend", "pricing.change", "code.pr"}


def level_for(action: str, permissions: dict | None, strict: bool = False) -> int:
    perms = (permissions or {}).get("actions", {})
    if action in perms:
        level = int(perms[action])
    else:
        family = action.split(".")[0] + ".*"
        level = int(perms[family]) if family in perms else DEFAULTS.get(action, ASK)
    if strict and action in EXTERNAL and level > ASK:
        level = ASK
    return max(OFF, min(AUTO, level))


def describe(level: int) -> str:
    return LEVEL_NAMES.get(level, str(level))
