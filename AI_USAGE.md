# AI Usage Disclosure

This file records the AI prompts and command-line checks used while completing
the Node.js payment microservice assessment. It is included to satisfy the
submission requirement to disclose AI-assisted work. Machine-specific paths,
account bindings, credentials, and private key details are intentionally omitted.

## Tools used

- OpenAI Codex assisted with requirement analysis, architecture, implementation,
  tests, documentation, refactoring, Git checkpoints, code review, security/QA
  review, and final verification.

No AI output was accepted as sufficient evidence on its own. Changes were
reviewed against the assessment, exercised through automated tests, and checked
with formatting, linting, type-checking, build, dependency-audit, coverage, and
runtime verification commands.

## User prompt ledger

The following entries preserve the complete assessment-related prompt history.
Minor spelling is retained. Repeated checkpoint-control messages are recorded in
their original order in a dedicated subsection so none are omitted.

### Assessment discovery and technical direction

1. "I want you to check this assessment test:" followed by the supplied Google
   Sheets assessment URL.
2. "What is writing there"
3. "So what are the actionable steps now"
4. "but this is said to be a microservice"
5. "I want to use a structured nestjs for this implementation, with swagger,
   logger, jest for test, and what else?"
6. "instead of joi, can i use zod?"
7. "This should be done:" followed by these requested additions:
   `Idempotency-Key` support, `@nestjs/throttler`, separate readiness and
   liveness, configurable delay, deterministic outcomes, coverage reporting,
   Swagger JSON, and a multi-stage Docker build. The prompt also emphasized
   robust Node.js/Express microservice design, error handling, logging, and
   realistic asynchronous programming.
8. A machine-specific workspace/account setup request that is intentionally
   omitted because a later prompt required removing those details from every
   document.
9. "Next I want us to create a checkpoint list, which I will verify at each
   checkpoint as we progress sequentially."
10. "We will be using bun also instead of npm"
11. "Where is the checkpoint located at?"
12. "I am unable to view it"
13. "We will be using atomic commit principle, with standardized commit message,
    with branch also"

### Payment contract decisions

14. "What is amountMinor" and "Include merchant reference and description"
15. "use another word"
16. "smallestUnitAmount"
17. "USD"
18. "what about idempotencyKey"
19. "so you mean it should not be in the payment creation?"
20. "No it has to follow data:"
21. "also, the port did not reflect in the terminal"
22. The reported response:

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

23. "also, I want status to always be out side, like status:\"\", data:{}"
24. "I expect api to be prefix, instead of blank 4040/.... it should be
    /api/4040/....."
25. "yes, versioning should also apply to all too"
26. "api/v1/ should apply to alll"
27. "yes, but I need to indicate if status is success or not, I also believe its
    different for the status inside the data"
28. "correct"
29. "Approved, commit all, including the port change to 4040"

### Testing, documentation, and repository decisions

30. "approved, but ignore Docker build, CI, focus only on Readme, theres no time"
31. A request to remove or rewrite machine-specific workspace references using
    the portable `/node-payment-microservice` path and to remove the previously
    mentioned account binding.
32. An unrelated website navigation/footer/Web3Forms request that was explicitly
    withdrawn by the next prompt and was not implemented in this repository.
33. "ignore previous message, continue with what you do, 1 to 3 is okay, i dont
    get 4 explain, continue with remain"
34. A request to keep local repository access configuration unchanged while
    ensuring documentation contains no machine-specific path.
35. A request to remove all documentation about local repository access
    configuration and related verification details.
36. "install what?"
37. "What is next"
38. "How will they test, will they test from swagger?"
39. "can you .rest request for each client so they can test"
40. "for each controller i mean"
41. "no in each controller file, beside it is where you should add"

### Source-organization decisions

42. A request to separate interfaces, types, and constants into matching concern
    files such as `payment.constants.ts` and `payment.types.ts` across the codebase.
43. "except the line of code is above 250, do not create folder, instead of
    types/payment.types.ts it should be /payment.types.ts"
44. "no enums instead use object, and as const"
45. A request to group multi-file concerns such as `api-response` in a matching
    parent folder and to apply the rule that anything with more than one file has
    a concern-owned parent.
46. "what is payment.ts for?"
47. "what about dto?"
48. "okayproceed with implementation"
49. "I notice app is not structured I mean app.* its supposed to be in a folder"
50. "now push, i have connected origin"
51. "commit all"

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

### Submission-readiness prompt

The final submission prompt required completion within 48 hours by Thursday at
5:00 PM Nigerian time, inclusion of the completed assessment and every AI
prompt/script used, thorough testing, production-ready quality, freedom from
critical bugs, and careful Codex review and validation of AI-generated output.

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

## Human-review handoff

Before submission, the reviewer should confirm that:

- this disclosure reflects the final repository state;
- every command in the README passes on the submitted commit; and
- the remote repository URL points to that same verified commit.
