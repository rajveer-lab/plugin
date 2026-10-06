"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const claims = require("../engine/claims.js");
const verifier = require("../engine/verifier.js");
const conversation = require("../engine/conversation.js");
const grounder = require("../engine/grounder.js");

const user = (text) => ({ role: "user", text });
const assistant = (text) => ({ role: "assistant", text });
const PASTED = [
  "Can you summarize these meeting notes?",
  "",
  "Project Alder sync, Tuesday. The launch is set for 21 May and the budget is $5,000.",
  "Priya will send the deck to the client by Friday. Marco is handling the venue booking.",
  "The pilot will run with 40 users in the east office before the wider rollout.",
].join("\n");

/** A stand-in for external sources: claims containing a "true" phrase are supported, "false" ones contradicted. */
function fakeSources({ supported = [], contradicted = [] }) {
  return (claim, evidence) => {
    const external = (evidence || []).some((e) => e.id === "wiki");
    const text = claim.text;
    const status = !external
      ? verifier.verifyClaim(claim, evidence).status
      : supported.some((s) => text.includes(s))
        ? "supported"
        : contradicted.some((s) => text.includes(s))
          ? "contradicted"
          : "unsupported";
    return { claimId: claim.id, claimText: text, status, evidenceId: external ? "wiki" : null, judge: "heuristic" };
  };
}

function check(history, answer, verify, judge) {
  const question = conversation.questionFor(history, "");
  const list = claims.extract(answer, { question });
  const verdicts = list.map((claim) => verify(claim, [{ id: "wiki", text: "x", kind: "wikipedia" }]));
  return conversation.compare({ claims: list, verdicts, history, evidence: [{ id: "wiki", text: "x", kind: "wikipedia" }], verify, extract: claims.extract, judge });
}

// ---- values ----

test("values are typed and normalized: money, dates, times, quantities, years, rooms", () => {
  const values = conversation.valuesOf("The $5k budget covers 14 May at 3:30 pm for 12 people in Room 204, as in 1889.");
  const byType = Object.fromEntries(values.map((v) => [v.type, v.lo]));
  assert.equal(byType.money, 5000);
  assert.equal(byType.date, 514);
  assert.equal(byType.time, 15 * 60 + 30);
  assert.equal(byType["qty:person"], 12);
  assert.equal(byType["after:room"], 204);
  assert.equal(byType.year, 1889);
});

test("values keep their own text, without the punctuation after them", () => {
  assert.deepEqual(conversation.valuesOf("My budget is $500, and it's on 14 May. Sept. 3 works.").map((v) => v.raw), ["$500", "14 May", "Sept. 3"]);
});

test("'may' the verb is not a month, and 1500 people is a count, not a year", () => {
  assert.deepEqual(conversation.valuesOf("You may want to invite them.").map((v) => v.type), []);
  assert.deepEqual(conversation.valuesOf("It holds 1500 people.").map((v) => v.type), ["qty:person"]);
});

test("loose and negated values are marked", () => {
  const [about] = conversation.valuesOf("It costs about $500.");
  assert.equal(about.approx, true);
  const [not, yes] = conversation.valuesOf("It is not on Tuesday; it is on Friday.");
  assert.equal(not.negated, true);
  assert.equal(yes.negated, false);
});

test("same value allows rounding and ranges, not a different amount", () => {
  const [a] = conversation.valuesOf("$5,000");
  const [b] = conversation.valuesOf("$4,950");
  const [c] = conversation.valuesOf("$500");
  const [range] = conversation.valuesOf("2-3 hours");
  const [three] = conversation.valuesOf("3 hours");
  assert.equal(conversation.sameValue(a, b), true);
  assert.equal(conversation.sameValue(a, c), false);
  assert.equal(conversation.sameValue(range, three), true);
});

// ---- conflicts ----

test("a different value about the same thing is a conflict", () => {
  const conflict = conversation.conflictBetween("The launch is planned for 14 May.", "Launch: 21 May");
  assert.equal(conflict.type, "date");
  assert.equal(conflict.claimValue, "14 May");
  assert.equal(conflict.passageValue, "21 May");
  assert.equal(conversation.conflictBetween("With your $800 budget, take the premium model.", "My budget is $500.").type, "money");
});

test("no conflict when the values are about different things", () => {
  assert.equal(conversation.conflictBetween("The visa costs $80.", "My budget is $500."), null);
  assert.equal(conversation.conflictBetween("The launch is planned for 14 May.", "The review is on 21 May."), null);
});

test("no conflict when the claim's value appears elsewhere in the source", () => {
  const source = "Launch: 21 May. Rehearsal: 14 May.";
  assert.equal(conversation.conflictBetween("The rehearsal is on 14 May.", "Launch: 21 May.", source), null);
});

test("a sentence naming both values is a comparison, not a contradiction", () => {
  assert.equal(conversation.conflictBetween("The launch is on Friday, not Thursday.", "The launch is on Thursday."), null);
});

test("a swapped person is a conflict, unless the source also says the claim's version", () => {
  assert.equal(conversation.conflictBetween("On Friday, Marco will send the deck.", "On Friday, Priya will send the deck.").type, "name");
  const both = "On Monday, Priya joined the team. On Tuesday, Marco joined the team.";
  assert.equal(conversation.conflictBetween("In May, Marco joined the team.", "On Monday, Priya joined the team.", both), null);
  assert.equal(conversation.conflictBetween("Canberra is the capital of Australia.", "Sydney is the largest city in Australia."), null);
});

test("a capitalized word opening a sentence isn't a name unless it's used as one elsewhere", () => {
  assert.equal(conversation.conflictBetween("Repairs are expected to take about nine days.", "Work is expected to last nine days."), null);
  assert.equal(conversation.conflictBetween("Marco will send the deck by Friday.", "Priya will send the deck by Friday."), null);
});

// ---- the user's messages ----

test("what the user states is a source; a question is not", () => {
  assert.equal(conversation.isSource(PASTED), true);
  assert.equal(conversation.isSource("My budget is $500, and I can't go above that."), true);
  assert.equal(conversation.isSource("Is Sydney the capital of Australia?"), false);
  assert.equal(conversation.isSource("Thanks!"), false);
  assert.equal(conversation.askOf("My budget is $500, and I can't go above that."), "My budget is $500, and I can't go above that.");
  const sources = conversation.pastedSources([user("Hi there"), assistant("Hello"), user(PASTED)]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].kind, "conversation");
  assert.equal(sources[0].source, "Your message");
  assert.equal(conversation.pastedSources([user("Short note.")], { all: true }).length, 1);
});

test("the question is the user's request, never the pasted text, and skips pushbacks", () => {
  assert.equal(conversation.askOf(PASTED), "Can you summarize these meeting notes?");
  assert.equal(conversation.askOf("Who wrote Hamlet?"), "Who wrote Hamlet?");
  const history = [user("When was the first iPhone released?"), assistant("In 2008."), user("Are you sure? I thought it was 2007.")];
  assert.equal(conversation.questionFor(history, ""), "When was the first iPhone released?");
  assert.equal(conversation.questionFor([], "Who wrote Hamlet?"), "Who wrote Hamlet?");
});

test("pushbacks are recognized; a request for a change is not one", () => {
  for (const text of ["Are you sure?", "That's not right.", "No, it was 1887.", "Can you double-check that?", "I thought it was 2007."]) {
    assert.equal(conversation.isPushback(text), true, text);
  }
  for (const text of ["Make it $600 instead.", "Thanks, that helps!", "Now write the email."]) {
    assert.equal(conversation.isPushback(text), false, text);
  }
  assert.equal(conversation.isPushback(grounder.pushbackPrompt("The tower is 330 metres tall.")), true);
});

// ---- pasted text as a source ----

test("a claim that conflicts with the pasted text is contradicted, one it states is supported", () => {
  const passages = conversation.pastedSources([user(PASTED)]).flatMap((source) =>
    claims.splitSentences(source.text).map((text, i) => ({ ...source, id: `${source.id}#${i + 1}`, text })),
  );
  const [wrong] = claims.extract("The launch is set for 14 May.", { question: "Can you summarize these meeting notes?" });
  const wrongVerdict = conversation.checkPasted(wrong, passages, verifier.verifyClaim);
  assert.equal(wrongVerdict.status, "contradicted");
  assert.match(wrongVerdict.evidenceId, /^conversation:1#/);

  const [right] = claims.extract("The pilot will run with 40 users in the east office.", { question: "" });
  const rightVerdict = conversation.checkPasted(right, passages, verifier.verifyClaim);
  assert.equal(rightVerdict && rightVerdict.status, "supported");

  const [outside] = claims.extract("Pilots usually reveal problems early.", { question: "" });
  assert.equal(conversation.checkPasted(outside, passages, verifier.verifyClaim), null);
});

// ---- comparing with earlier answers ----

test("a changed value with no source to settle it: contradicts itself", async () => {
  const history = [user("The workshop is in Room 204."), assistant("Room 204, noted. The workshop starts at 9 am."), user("Write the reminder.")];
  const items = await check(history, "Reminder: the workshop starts at 10 am. Bring a laptop.", fakeSources({}));
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "changed_unknown");
  assert.equal(items[0].tone, "warn");
  assert.equal(items[0].earlierRole, "assistant");
  assert.match(items[0].note, /9 am/);
});

test("following the user's requested change is not a contradiction", async () => {
  const history = [user("Keep the estimate at $500."), assistant("Okay, the estimate is $500."), user("Actually, make it $600 instead.")];
  assert.deepEqual(await check(history, "The revised estimate is $600.", fakeSources({})), []);
});

test("saying what the user said, wrongly, is a misquote", async () => {
  const history = [user("My budget is $500, and I can't go above that.")];
  const items = await check(history, "With your $800 budget, you could choose the premium model.", fakeSources({}));
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "misquote");
  assert.equal(items[0].earlierRole, "user");
  assert.equal(items[0].tone, "bad");
  assert.deepEqual(await check(history, "With your $500 budget, the basic model fits.", fakeSources({})), []);
});

test("after a pushback: caving on a right answer and fixing a wrong one", async () => {
  const history = [
    user("When was the Eiffel Tower completed?"),
    assistant("The Eiffel Tower was completed in 1889."),
    user("Are you sure? I read it was 1887."),
  ];
  const caved = await check(history, "You're right, the Eiffel Tower was completed in 1887.", fakeSources({ supported: ["1889"], contradicted: ["1887"] }));
  assert.equal(caved.length, 1);
  assert.equal(caved[0].type, "changed_wrong");
  assert.equal(caved[0].afterPushback, true);
  assert.match(caved[0].note, /Gave in when you pushed back/);

  const fixed = await check(history, "You're right, the Eiffel Tower was completed in 1887.", fakeSources({ supported: ["1887"], contradicted: ["1889"] }));
  assert.equal(fixed[0].type, "changed_fixed");
  assert.equal(fixed[0].tone, "ok");
});

test("after a pushback: standing by an answer, judged by sources", async () => {
  const sentence = "The Eiffel Tower was completed in 1889.";
  const history = [user("When was the Eiffel Tower completed?"), assistant(sentence), user(grounder.pushbackPrompt(sentence))];
  const held = await check(history, "Yes. The Eiffel Tower was completed in 1889, for the World's Fair.", fakeSources({ supported: ["1889"] }));
  assert.equal(held.length, 1);
  assert.equal(held[0].type, "held_correct");
  assert.equal(held[0].afterPushback, true);

  const dug = await check(history, "Yes. The Eiffel Tower was completed in 1889, for the World's Fair.", fakeSources({ contradicted: ["1889"] }));
  assert.equal(dug[0].type, "held_wrong");

  const unknown = await check(history, "Yes. The Eiffel Tower was completed in 1889, for the World's Fair.", fakeSources({}));
  assert.equal(unknown[0].type, "held_unknown");
});

test("nothing to report in a consistent conversation, or without history", async () => {
  const history = [user("Our shift is 90 minutes long."), assistant("That's a 90-minute shift."), user("Draft the reminder.")];
  assert.deepEqual(await check(history, "Reminder: the volunteer shift lasts 90 minutes.", fakeSources({})), []);
  assert.deepEqual(await check([], "The shift lasts 90 minutes.", fakeSources({})), []);
});

test("the pushback prompt quotes the sentence and never claims it's wrong", () => {
  const prompt = grounder.pushbackPrompt('It is called "the Iron Lady".');
  assert.equal(prompt, `Are you sure about this? "It is called 'the Iron Lady'." Please double-check it and tell me plainly whether it's right.`);
  assert.equal(grounder.pushbackPrompt("   "), "");
});

test("requests and instructions aren't things the user stated", () => {
  const message = "I'm testing a fact-checking extension. Reply with exactly these three sentences and nothing else: The Eiffel Tower was completed in 1889.";
  const [source] = conversation.pastedSources([user(message)]);
  assert.equal(source.text, "I'm testing a fact-checking extension.\nThe Eiffel Tower was completed in 1889.");
  assert.equal(conversation.pastedSources([user("Please summarize: Mira prefers a window seat.")])[0].text, "Mira prefers a window seat.");
  assert.equal(conversation.isSource("Please summarize this. Can you keep it short?"), false);
  assert.equal(conversation.isSource("Make it $600 instead."), false);
  assert.equal(conversation.isSource("Remember the opening date: 12 April."), true);
  assert.equal(conversation.isSource("We expect 48 guests at the supper."), true);
});
