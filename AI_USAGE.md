# AI Usage Disclosure

This file summarizes the AI-assisted implementation decisions and command-line
checks used while developing the Node.js payment microservice. Machine-specific
paths, account bindings, credentials, and private key details are intentionally
omitted.

## Tools used

- OpenAI Codex assisted with requirement analysis, architecture, implementation,
  tests, documentation, refactoring, Git checkpoints, code review, security/QA
  review, and final verification.

No AI output was accepted as sufficient evidence on its own. Changes were
reviewed against the assessment, exercised through automated tests, and checked
with formatting, linting, type-checking, build, dependency-audit, coverage, and
runtime verification commands.

## Implementation decision record

The following entries record technical decisions made during implementation.
Minor spelling is retained where a direct instruction is quoted.

### Payment contract decisions

1. "What is amountMinor" and "Include merchant reference and description"
2. "use another word"
3. "smallestUnitAmount"
4. "USD"
5. "what about idempotencyKey"
6. "so you mean it should not be in the payment creation?"
7. "No it has to follow data:"
8. "also, the port did not reflect in the terminal"
9. The reported response:

   ```json
   {
     "statusCode": 404,
     "code": "NOT_FOUND",
     "message": "Cannot GET /api/health/live",
     "requestId": "cd7029a8-f76a-4c2b-be43-23e02e47be8c",
     "timestamp": "2026-08-27T08:44:32.494Z",
     "path": "/api/health/live"
   }
   ```

10. "also, I want status to always be out side, like status:\"\", data:{}"
11. "I expect api to be prefix, instead of blank 4040/.... it should be
    /api/4040/....."
12. "yes, versioning should also apply to all too"
13. "api/v1/ should apply to alll"
14. "yes, but I need to indicate if status is success or not, I also believe its
    different for the status inside the data"
15. "correct"
16. "Approved, commit all, including the port change to 4040"

### Testing, documentation, and repository decisions

17. "approved, but ignore Docker build, CI, focus only on Readme, theres no time"
18. A request to remove or rewrite machine-specific workspace references using
    the portable `/node-payment-microservice` path and to remove the previously
    mentioned account binding.
19. An unrelated website navigation/footer/Web3Forms request that was explicitly
    withdrawn by the next prompt and was not implemented in this repository.
20. "ignore previous message, continue with what you do, 1 to 3 is okay, i dont
    get 4 explain, continue with remain"
21. A request to keep local repository access configuration unchanged while
    ensuring documentation contains no machine-specific path.
22. A request to remove all documentation about local repository access
    configuration and related verification details.
23. "install what?"
24. "What is next"
25. "How will they test, will they test from swagger?"
26. "can you .rest request for each client so they can test"
27. "for each controller i mean"
28. "no in each controller file, beside it is where you should add"

### Source-organization decisions

29. A request to separate interfaces, types, and constants into matching concern
    files such as `payment.constants.ts` and `payment.types.ts` across the codebase.
30. "except the line of code is above 250, do not create folder, instead of
    types/payment.types.ts it should be /payment.types.ts"
31. "no enums instead use object, and as const"
32. A request to group multi-file concerns such as `api-response` in a matching
    parent folder and to apply the rule that anything with more than one file has
    a concern-owned parent.
33. "what is payment.ts for?"
34. "what about dto?"
35. "okayproceed with implementation"
36. "I notice app is not structured I mean app.* its supposed to be in a folder"
37. "now push, i have connected origin"
38. "commit all"

### Checkpoint-control prompts

The short control prompts, in chronological order, were:

```text
proceed to integration
proceed
proceed
procced
yes
yes
okay
okay
proceed
proceed
proceed
yes
yes
yes
yes
yes
yes
proceed
2
Whats next
proceed
Continue
proceed
proceed
2
Next
Proceed
approve
proceed
1
proceed
1
proceed
proceed
1
continue
yes
yes
1
1
proceed
yes
yes
yes
proceed
```

The numeric responses selected options presented during sequential checkpoint
reviews. The surrounding tracked plans, commits, and `CHECKPOINTS.md` preserve
the resulting decisions.

## Commands and scripts used

No custom hidden automation script was used. Repository operations were performed
with standard Bun, Git, and POSIX-shell commands. The repeatable quality commands
are:

```bash
bun install --frozen-lockfile
bun audit
bun run format:check
bun run lint
bun run typecheck
bun run build
bun run test
bun run test:e2e
bun run test:e2e -- --detectOpenHandles
bun run test:cov
git diff --check
git status --short --branch
```

Temporary diagnostic commands were also used to run focused Jest suites, inspect
tracked source, verify ignored artifacts, inspect Git diffs/history, retrieve the
user-provided assessment as CSV, and smoke-test the compiled HTTP service. No
credentials, environment secrets, generated coverage output, build output, or
machine-specific paths are tracked.

## Repository review

The reviewer should confirm that:

- this disclosure reflects the final repository state;
- every command in the README passes on the reviewed commit; and
- the remote repository URL points to that same verified commit.
