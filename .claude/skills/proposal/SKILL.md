---
name: proposal
description: Write a proposal doc for a queue row that needs the owner's decision - what the operator or the audience sees with more than one sensible design, hardware, a licence, an account or the stadium. Use in a builder run (AGENTS.md › A run, step 9).
---

# A proposal

The owner is a teacher, not a developer. The proposal lets him choose by looking, not by reading code.

1. **Read:** the row's file (the words below its `---` line), AGENTS.md › Design system, and the design notes it names.
2. **The doc:** a Claude Doc (load the docs skill, or the Claude Docs guide, first) titled "<repository> <row>: <short
   name> proposal". It holds what was asked; what the software does today in the names he sees; **2 to 3 options**,
   each with a picture or mock and what it means for game day; the parts it would be built in; and a table of only
   the choices he judges, with the columns **What it means for you · Example · My lean · Other option · Your mark**.
   Marks start **blank** (Keep / Change / Skip / Discuss).
3. **Queue:** move the row's file to `queue/needs-you/`, add `Link: <doc link>` and `Needs you: <one plain sentence>`
   to its header (a claude.ai link only: nothing private in this public repository), and land that change with the
   `land` skill (a queue-only pull request still needs every check green).
4. Send **one** push notification: the row's title and "a proposal needs your marks". Then end the run.

A later run that sees all his marks filled moves the file back to `queue/todo/` (AGENTS.md › A run, step 6). Blank
marks never build.
