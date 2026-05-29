---
name: agent-role-generator
description: Generate high-quality system prompts for specialized Claude Code agent roles. Use this skill when a user wants to create a new agent role, refine an existing role prompt, or design an agency of coordinated agents for any purpose (software development, stock analysis, consulting, SaaS operations, etc.). Triggers on phrases like "create a role", "make an agent", "write a system prompt for", "agent that does X", "role for Y", "build an agency", or any description of a specialized agent's responsibilities.
---

# Agent Role Generator

Generates precise, high-quality system prompts for Claude Code subagents. A good role prompt is not a job description — it is an **operational contract**: it tells the agent exactly what to do, how to do it, when to stop, and how to communicate.

The difference between a mediocre role prompt and a great one is specificity of constraints and concreteness of workflow steps.

---

## Two Generation Modes

**Role Mode** — Generate a single role prompt. The role is self-contained; it may optionally be portable (reusable across agencies) or project-specific (locked to one context).

**Agency Mode** — Generate a coordinated set of roles for a specific purpose. Each role is written with awareness of the other roles in the agency.

Ask the user which mode they want before proceeding.

---

## Phase 1: Elicitation

Never generate before gathering this information. Adapt language to the user's domain — avoid technical jargon for non-technical roles.

### Core questions (always ask):

1. **What is this role's single responsibility?** One sentence. If it can't be said in one sentence, the scope is too broad — help them narrow it.
2. **Who gives this role work?** (The user directly? Another agent by role name? Both, depending on context?)
3. **Who does this role hand work to when done?** (The user? Another agent? Nobody — it terminates the chain?)
4. **What tools does this role have access to?** (e.g. Bash, Edit, Glob, Grep, Read, Write, send_message, or domain-specific tools)
5. **Portable or project-specific?** Portable = reusable across agencies, no hardcoded project details. Project-specific = locked to one codebase, product, or context.
6. **Name at least 3 hard constraints** — things this role must never do. If the user struggles to name 3, the role isn't scoped enough yet. Ask: *"What would a bad version of this role do that the good version must not?"*

### Additional questions for non-technical / business roles:

7. **What does "done" look like?** What artifact or answer does this role hand back?
8. **What does this role own that no other role should touch?**
9. **What decisions can this role make unilaterally vs. what requires escalation?**

### Additional questions for Agency Mode:

10. **What is the agency's purpose?** One sentence.
11. **What roles will exist?** List them all.
12. **Who talks to whom?** Sketch the delegation graph (even rough is fine).
13. **Who is the user-facing entry point?**

---

## Phase 2: Role Anatomy

Every role prompt contains these sections in this order. Some are conditional.

### Section 1 — Identity *(required)*

One sentence. Names the role, the context, and who delegates to them.

```
You are the **[role]** for [project or context]. You [core responsibility],
handed to you by [delegator] (or by the user directly, when [condition]).
```

- **Portable**: omit project names. Use `for a [domain] project` or role-in-context phrasing.
- **Project-specific**: name the project explicitly. Reference `CLAUDE.md` or equivalent if it exists.

### Section 2 — Tool Declaration *(required if tools are assigned)*

List exact tool names as given in the agent config. Add one line of guidance if usage is non-obvious.

```
You have the [role] tool set (Bash, Edit, Glob, Grep, Read, Write, send_message) — use it well.
```

### Section 3 — Workflow *(required)*

Numbered, imperative steps. Each step is a concrete action — not a principle. Aim for 4–7 steps.

**Rules for writing workflow steps:**
- Use imperative verbs: "Read", "Run", "Commit", "Deliver" — not "You should read" or "Consider running"
- Be specific: `Run \`pnpm typecheck\` and fix failures before handing back` not "verify your work"
- Order must be sequentially valid — don't reference something before it's established
- The final step always states what "done" looks like and who receives the result

### Section 4 — Output Contract *(required for roles that hand off to another role)*

What this role produces when done. Covers format, completeness, and what the downstream role needs to accept it.

For technical roles:
```
Reply with a concise summary: what you changed, what you verified, anything deferred or blocked.
```

For non-technical / business roles:
```
Deliver a [document/plan/analysis] containing [X, Y, Z].
The [downstream role] cannot begin without [specific required item].
```

### Section 5 — Constraints *(required)*

Hard rules. Use `Never` or `Don't` — not `Avoid`, `Try not to`, or `Prefer`. Ambiguity in constraints is a design flaw.

**Three constraint categories:**

1. **Scope constraints** — what this role must not own or decide (`Never make architectural decisions — escalate to the CTO`)
2. **Behavioral constraints** — how the role must not act (`Don't narrate code with comments that restate what it does`)
3. **Escalation rules** — when to stop (`If scope is unclear, stop and send_message to [role]. Don't invent requirements.`)

For project-specific roles, constraints should reference exact project context:
```
Don't add persistence (SQLite, custom JSONL) — V2.1 is deferred. See CLAUDE.md.
```

### Section 6 — Communication Protocol *(conditional — only if send_message is a listed tool)*

When and how to use `send_message`. Must cover:

- Which roles this agent can message (by **role name**, not instance ID — the agency handles routing)
- When to message vs. reply inline with plain text
- Whether concurrent delegation is allowed (emit multiple `send_message` calls in the same turn)

```
To escalate or delegate, call send_message(to: "[role name]", …).
Never call send_message back at the peer who addressed you — reply with plain text.
```

---

## Phase 3: Writing Principles

Apply these while drafting every role.

**Operational tone, not descriptive.** The prompt is instructions, not a job posting. Cut any sentence that describes the role without directing behavior.

**Constraints must be falsifiable.** "Handle data carefully" is not a constraint. "Never read from the production database directly — use the read replica" is.

**The scope escape hatch is mandatory.** Every role must know what to do when uncertain about scope. Default: stop and message the delegating role. If no messaging tool is available: stop and reply to the user. A role with no escape hatch will hallucinate requirements.

**Role-name addressing.** `send_message(to: "planner")` not `send_message(to: "agent_3")`. The agency layer handles routing. Using instance IDs breaks portability.

**Specificity scales with project-specificity.** Portable roles must rely only on behavioral constraints. Project-specific roles should name exact commands, file paths, commit formats, and architectural boundaries.

---

## Phase 4: Quality Checklist

Before delivering the role prompt, verify every item:

- [ ] Identity is one sentence and names the delegator
- [ ] Workflow steps use imperative verbs and are sequentially valid
- [ ] The role knows what "done" looks like (final workflow step or output contract)
- [ ] At least 3 constraints use `Never` or `Don't`
- [ ] The scope escape hatch exists (what to do when uncertain)
- [ ] Portable roles contain no hardcoded project names, paths, or commands
- [ ] Project-specific roles reference exact conventions (build commands, commit format, etc.)
- [ ] If `send_message` is listed as a tool, the communication protocol section is present
- [ ] No constraint uses `Avoid`, `Try not to`, or `Prefer` where a hard rule is appropriate

---

## Role Archetypes Reference

For starting patterns by role type, see `references/role-archetypes.md`. Covers:

- **Orchestration tier**: PM, Planner, CTO, COO, CIO
- **Execution tier**: Developer, Designer, Analyst, Writer
- **Review / Gate tier**: Reviewer, QA/Tester, Beta Tester, Compliance
- **Support / Specialist tier**: Consultant, Domain Expert, Researcher

Archetypes are anchors, not templates. A PM in a consulting agency is not the same as a PM in a dev shop. Always adapt to the user's actual context and constraints.

For annotated real-world examples, see `references/example-roles.md`.
