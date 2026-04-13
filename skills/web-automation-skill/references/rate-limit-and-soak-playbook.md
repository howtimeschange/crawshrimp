# Rate-Limit And Soak Playbook

Use this playbook when a web automation task is long-running, throttled, or likely to trigger platform protection.

## Target Output

Before calling the flow “stable under load”, you should have:

- one conservative baseline frequency
- a bounded retry and cooldown plan
- separate handling for timeout vs rate limit vs no-data
- one soak run or long-batch validation result

## 1. Treat Safe Frequency As Unknown Until Measured

Do not assume the platform can tolerate:

- back-to-back page turns
- back-to-back list API calls
- rapid site or tab switching
- repeated drawer reopen cycles

Start conservative, then measure.

## 2. Model Pacing In Layers

Useful pacing knobs:

- base request throttle
- site-switch cooldown
- recovery cooldown
- post-retry cooldown
- burst-size limit
- burst cooldown
- max backoff cap

Keep them explicit and named.

Avoid hiding pacing inside many unrelated helper sleeps.

## 3. Separate Failure Types

At minimum, classify:

- rate limit or anti-bot response
- network timeout
- page freeze or re-render race
- business empty result

Each one should have its own cooldown rule.

## 4. Use Conservative Backoff

Good backoff properties:

- starts from a safe baseline
- increases predictably
- has a max cap
- resets when the page is healthy again

Bad backoff properties:

- unbounded growth
- hidden random sleeps with no rationale
- same delay for all error types

## 5. Keep Recovery Bounded

A stable flow should bound:

- retries per page
- retries per row
- retries per site or scope
- refresh count
- drawer reopen count

If retries are not bounded, soak runs become impossible to trust.

## 6. Soak-Test In A Ladder

Recommended order:

1. single page
2. a few pages
3. one small batch
4. one full multi-scope batch
5. one soak run with realistic duration

Track:

- error count
- retry count
- refresh count
- average delay per page or request
- whether progress remains monotonic

## 7. Know When Slower Is Better

Sometimes a larger page size or faster loop looks attractive but lowers survival rate.

Measure:

- whether fewer page turns actually reduce failures
- whether larger page size increases server-side protection
- whether a slower but steadier loop finishes more reliably

Optimize for successful completion, not just theoretical throughput.

## 8. Stop Conditions

Stop and report instead of looping forever when:

- the same rate-limit signal repeats beyond the configured cap
- recovery keeps reopening the same broken state
- host or scope no longer matches the requested context
- output correctness can no longer be guaranteed

## When To Load This Playbook

Load this reference when:

- a task will run over large volumes
- the platform complains about traffic or timeout
- you need to probe acceptable request frequency
- you are tuning throttles, cooldowns, or retry caps
