/**
 * dsh-plus-plus — DeepSeek Harness plugin entry.
 *
 * Registers a `/dshpp` slash command that returns a short usage summary by
 * reading the harness session logs (the dsh-plus-plus CLI already does this in
 * full; this is the thin in-harness surface).
 */

const name = "dshpp";
const inject = ["commands"];

async function handler() {
  let text = "dsh-plus-plus";
  try {
    const { collectUsage, formatTokens } = await import("../src/usage.mjs");
    const r = await collectUsage({});
    const pct = (r.totals.cacheHitRate || 0).toFixed(1);
    text = `dsh-plus-plus · ${r.sessions} session(s) / ${r.calls} call(s) · in ${formatTokens(r.totals.inputTokens)} / out ${formatTokens(r.totals.outputTokens)} · cache ${pct}% · est $${r.totals.cost.toFixed(3)}`;
  } catch (e) {
    text = `dsh-plus-plus · usage unavailable: ${e.message}`;
  }
  return { kind: "success", text };
}

function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: "dshpp",
      description: "Show a dsh-plus-plus usage summary (tokens, cache, cost)",
      handler,
    });
  }, "dshpp lifecycle");
}

export { apply, inject, name };
