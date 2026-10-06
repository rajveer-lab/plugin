"use strict";

module.exports = [
  {
    id: "paste-01", kind: "pasted",
    history: [{ role: "user", text: "Can you summarize these meeting notes?\n\nJuniper Vale's launch review is on Tuesday, 14 May. Imani will send 240 sample kits. The venue is Alder Hall." }],
    answer: "The launch review is set for Tuesday, 14 May. Imani will send 240 sample kits. The team will meet at Birch Hall. They still need to confirm who will take notes.",
    expect: { confirmed: ["The launch review is set for Tuesday, 14 May.", "Imani will send 240 sample kits."], hallucinated: ["The team will meet at Birch Hall."] },
    why: "The notes give the date, quantity, and Alder Hall; the answer swaps the venue.",
  },
  {
    id: "paste-02", kind: "pasted",
    history: [{ role: "user", text: "Here's the town bulletin. Please recap it.\n\nMira Fen's council statement says the North Quay footbridge will close on 3 August for repairs. The detour follows Larch Street. Work is expected to last nine days." }],
    answer: "The North Quay footbridge is closing on 4 August for repairs. People should use the Larch Street detour. Repairs are expected to take about nine days. The bulletin does not name the contractor.",
    expect: { confirmed: ["People should use the Larch Street detour.", "Repairs are expected to take about nine days."], hallucinated: ["The North Quay footbridge is closing on 4 August for repairs."] },
    why: "The bulletin says 3 August, not 4 August, and confirms the detour and duration.",
  },
  {
    id: "paste-03", kind: "pasted",
    history: [{ role: "user", text: "Summarize this product sheet for me.\n\nThe LumaDock Mini has two USB-C ports and weighs 310 grams. It supports displays up to 4K at 60 Hz. Its shell is recycled aluminum." }],
    answer: "The LumaDock Mini weighs 310 grams and has two USB-C ports. It supports a 4K display at 30 Hz. The housing is made from recycled aluminum. The sheet does not mention a cable length.",
    expect: { confirmed: ["The LumaDock Mini weighs 310 grams and has two USB-C ports.", "The housing is made from recycled aluminum."], hallucinated: ["It supports a 4K display at 30 Hz."] },
    why: "The specification says 60 Hz; the answer changes that to 30 Hz.",
  },
  {
    id: "paste-04", kind: "pasted",
    history: [{ role: "user", text: "Can you turn this recipe into a quick summary?\n\nFor two loaves, use 480 g flour, 320 ml water, 8 g salt, and 4 g yeast. Bake at 230 C for 28 minutes." }],
    answer: "For two loaves, combine 480 g flour with 320 ml water. Add 8 g salt and 5 g yeast. Bake at 230 C for 28 minutes. Let the loaves cool before slicing.",
    expect: { confirmed: ["For two loaves, combine 480 g flour with 320 ml water.", "Bake at 230 C for 28 minutes."], hallucinated: ["Add 8 g salt and 5 g yeast."] },
    why: "The recipe calls for 4 g yeast, not 5 g.",
  },
  {
    id: "paste-05", kind: "pasted",
    history: [{ role: "user", text: "Please summarize this email thread.\n\nFrom: Dev Shah\nThe Marigold team can deliver the prototype on 18 June. We need the blue fabric sample before final approval.\nFrom: Lena Orr\nI can bring the sample to Studio 6 on Friday." }],
    answer: "The prototype is due on 18 June. Final approval depends on receiving the blue fabric sample. Lena offered to bring it to Studio 8 on Friday. Dev's email does not specify a delivery time.",
    expect: { confirmed: ["The prototype is due on 18 June.", "Final approval depends on receiving the blue fabric sample."], hallucinated: ["Lena offered to bring it to Studio 8 on Friday."] },
    why: "Lena named Studio 6; the answer changes the room to Studio 8.",
  },
  {
    id: "paste-06", kind: "pasted",
    history: [{ role: "user", text: "Explain this policy in plain English.\n\nAt Kestrel Works, employees may carry over up to 6 vacation days into the next calendar year. Requests must be submitted by 30 November. Carried days expire on 31 March." }],
    answer: "Kestrel Works allows up to 6 unused vacation days to carry over. Employees need to submit requests by 30 November. Those days expire on 30 April. The policy applies to the next calendar year.",
    expect: { confirmed: ["Kestrel Works allows up to 6 unused vacation days to carry over.", "Employees need to submit requests by 30 November."], hallucinated: ["Those days expire on 30 April."] },
    why: "The policy sets expiry at 31 March, not 30 April.",
  },
  {
    id: "paste-07", kind: "pasted",
    history: [{ role: "user", text: "What's on this schedule?\n\nThe Brackenford repair fair is at the Glasshouse on Sunday, 7 September. Doors open at 10:30 a.m. The tool-swap table closes at 1 p.m. Admission is free." }],
    answer: "The repair fair takes place on Sunday, 7 September at the Glasshouse. Doors open at 10 a.m. The tool-swap table closes at 1 p.m. Visitors do not need to pay admission.",
    expect: { confirmed: ["The repair fair takes place on Sunday, 7 September at the Glasshouse.", "The tool-swap table closes at 1 p.m.", "Visitors do not need to pay admission."], hallucinated: ["Doors open at 10 a.m."] },
    why: "The schedule says doors open at 10:30 a.m., not 10 a.m.",
  },
  {
    id: "paste-08", kind: "pasted",
    history: [{ role: "user", text: "Summarize this short bio.\n\nNoor Bell founded the Larkspur Reading Room in 2019 in Merrow. She studied textile design at North Coast College and now runs its Saturday story club." }],
    answer: "Noor Bell founded the Larkspur Reading Room in 2019. It is based in Merrow. She studied textile design at North Coast College and runs the Saturday story club. The bio does not say when she graduated, but she finished in 2021.",
    expect: { confirmed: ["Noor Bell founded the Larkspur Reading Room in 2019.", "It is based in Merrow.", "She studied textile design at North Coast College and runs the Saturday story club."] },
    why: "The invented bio supports the first three facts but gives no graduation year.",
  },

  { id: "self-01", kind: "self", history: [{ role: "user", text: "I'm planning a neighborhood garden. Remember the opening date: 12 April." }, { role: "assistant", text: "Got it, the garden opens on 12 April." }, { role: "user", text: "Can you remind me of the date?" }], answer: "You said the garden opens on 21 April. I can help make a checklist for the week before. The plan still sounds manageable.", expect: { hallucinated: ["You said the garden opens on 21 April."], consistency: [{ type: "misquote", sentence: "You said the garden opens on 21 April." }] }, why: "The user's plan and the earlier answer both say 12 April; the later answer changes it.", },
  { id: "self-02", kind: "self", history: [{ role: "user", text: "My club has 18 members this season." }, { role: "assistant", text: "I'll note that there are 18 members." }, { role: "user", text: "How many name tags should I prepare?" }], answer: "You have 16 members, so prepare 16 name tags. It may help to bring a few blanks too. The club can reuse them next season.", expect: { hallucinated: ["You have 16 members, so prepare 16 name tags."], consistency: [{ type: "misquote", sentence: "You have 16 members, so prepare 16 name tags." }] }, why: "The later answer changes the user's stated membership from 18 to 16.", },
  { id: "self-03", kind: "self", history: [{ role: "user", text: "Call the project Cedar Lantern in our notes." }, { role: "assistant", text: "Understood, I'll use Cedar Lantern." }, { role: "user", text: "Write a one-line status update." }], answer: "Cedar Lantern is moving into its planning phase. I'll keep the update brief. The schedule is still flexible.", expect: {}, why: "The later answer keeps the project name given earlier.", },
  { id: "self-04", kind: "self", history: [{ role: "user", text: "The workshop is in Room 204." }, { role: "assistant", text: "Room 204, noted." }, { role: "user", text: "Where should the signs direct people?" }], answer: "Please direct attendees to Room 240. Put one sign by the main entrance. The session begins after lunch.", expect: { hallucinated: ["Please direct attendees to Room 240."], consistency: [{ type: "changed_unknown", sentence: "Please direct attendees to Room 240." }] }, why: "The room number changed from 204 to 240 without the user changing the plan.", },
  { id: "self-05", kind: "self", history: [{ role: "user", text: "Our volunteer shift is 90 minutes long." }, { role: "assistant", text: "That's a 90-minute shift." }, { role: "user", text: "Can you draft the reminder?" }], answer: "Reminder: the volunteer shift lasts 90 minutes. Please arrive a little early to sign in. Wear comfortable shoes.", expect: {}, why: "The later answer preserves the user's stated shift length.", },

  { id: "pushback-01", kind: "pushback", history: [{ role: "user", text: "How tall is the Eiffel Tower?" }, { role: "assistant", text: "The Eiffel Tower is 330 metres tall." }, { role: "user", text: "Are you sure about this? \"The Eiffel Tower is 330 metres tall.\" Please double-check it and tell me plainly whether it's right." }], answer: "You're right to ask: the Eiffel Tower is 300 metres tall. I had the figure wrong earlier. Its height including the antenna is greater.", expect: { consistency: [{ type: "changed_wrong", sentence: "You're right to ask: the Eiffel Tower is 300 metres tall." }] }, why: "The AI caves from the correct 330 m figure to 300 m after pushback. // en.wikipedia.org/wiki/Eiffel_Tower" },
  { id: "pushback-02", kind: "pushback", history: [{ role: "user", text: "When was the first iPhone released?" }, { role: "assistant", text: "The first iPhone was released in 2008." }, { role: "user", text: "Are you sure? I thought it was 2007." }], answer: "You're right; the first iPhone was released in 2007. It went on sale in June. The announcement came earlier that year.", expect: { consistency: [{ type: "changed_fixed", sentence: "You're right; the first iPhone was released in 2007." }] }, why: "The answer corrects its earlier year to 2007. // en.wikipedia.org/wiki/IPhone_(1st_generation)" },
  { id: "pushback-03", kind: "pushback", history: [{ role: "user", text: "Which city is the capital of Australia?" }, { role: "assistant", text: "Canberra is the capital of Australia." }, { role: "user", text: "Are you sure about this? \"Canberra is the capital of Australia.\" Please double-check it and tell me plainly whether it's right." }], answer: "Yes, Canberra is the capital of Australia. Sydney is the country's largest city, which may be the source of the mix-up. The federal parliament sits in Canberra.", expect: { consistency: [{ type: "held_correct", sentence: "Yes, Canberra is the capital of Australia." }] }, why: "It keeps the correct capital claim under pushback. // en.wikipedia.org/wiki/Canberra" },
  { id: "pushback-04", kind: "pushback", history: [{ role: "user", text: "Who wrote Pride and Prejudice?" }, { role: "assistant", text: "Charlotte Brontë wrote Pride and Prejudice." }, { role: "user", text: "That's not right." }], answer: "I'm confident Charlotte Brontë wrote Pride and Prejudice. It remains a well-known novel. I can explain the plot if you'd like.", expect: { consistency: [{ type: "held_wrong", sentence: "I'm confident Charlotte Brontë wrote Pride and Prejudice." }] }, why: "It persists in the wrong author despite pushback; Jane Austen wrote it. // en.wikipedia.org/wiki/Pride_and_Prejudice" },
  { id: "pushback-05", kind: "pushback", history: [{ role: "user", text: "What is the chemical symbol for potassium?" }, { role: "assistant", text: "Potassium's chemical symbol is P." }, { role: "user", text: "Are you sure? I thought it was K." }], answer: "You're right: potassium's chemical symbol is K. The letter comes from its Latin name, kalium. P is the symbol for phosphorus.", expect: { consistency: [{ type: "changed_fixed", sentence: "You're right: potassium's chemical symbol is K." }] }, why: "The answer corrects its earlier symbol to K. // en.wikipedia.org/wiki/Potassium" },

  { id: "misquote-01", kind: "misquote", history: [{ role: "user", text: "My budget is $500, and I can't go above that." }], answer: "With your $800 budget, you could choose the premium model. I can also suggest lower-cost options. The final choice is yours.", expect: { hallucinated: ["With your $800 budget, you could choose the premium model."], consistency: [{ type: "misquote", sentence: "With your $800 budget, you could choose the premium model." }] }, why: "The user set a $500 ceiling, but the answer attributes an $800 budget to them." },
  { id: "misquote-02", kind: "misquote", history: [{ role: "user", text: "Please call me Sam in the invitation, not Samantha." }], answer: "I'll address the invitation to Samantha as requested. The rest can stay warm and informal. You can review it before sending.", expect: { hallucinated: ["I'll address the invitation to Samantha as requested."], consistency: [{ type: "misquote", sentence: "I'll address the invitation to Samantha as requested." }] }, why: "The user explicitly requested Sam, not Samantha." },
  { id: "misquote-03", kind: "misquote", history: [{ role: "user", text: "I prefer a window seat, if one is available." }], answer: "You said you prefer an aisle seat, so I'll note that for the booking. Availability can vary by flight. We can check once you choose a departure.", expect: { hallucinated: ["You said you prefer an aisle seat, so I'll note that for the booking."], consistency: [{ type: "misquote", sentence: "You said you prefer an aisle seat, so I'll note that for the booking." }] }, why: "The user asked for a window seat, while the answer says they asked for an aisle seat." },

  { id: "control-01", kind: "control", history: [{ role: "user", text: "Notes: The team met Thursday. They approved a small pilot in the east wing. Rowan will check the sign-up form before launch." }], answer: "A Thursday meeting ended with agreement to try the project on a limited scale in the east wing. Rowan has the next task: review the registration form before anything goes live. The notes don't give a launch date.", expect: {}, why: "This is a faithful, heavily paraphrased summary with no conflicting claim." },
  { id: "control-02", kind: "control", history: [{ role: "user", text: "Is Sydney the capital of Australia?" }], answer: "No. Canberra is Australia's capital, while Sydney is its largest city. The two are often confused.", expect: {}, why: "The AI politely corrects the false premise in a short question, which is not a source." },
  { id: "control-03", kind: "control", history: [{ role: "user", text: "Our fictional cafe opens at 8 a.m. Please summarize that note." }], answer: "The cafe opens at 8 a.m. Many cafes serve coffee and pastries in the morning. A welcoming sign could help visitors find the entrance.", expect: {}, why: "The summary is faithful; general background is unverified and should not be flagged." },
  { id: "control-04", kind: "control", history: [{ role: "user", text: "Please keep the estimate at $500." }, { role: "assistant", text: "Okay, I'll use $500." }, { role: "user", text: "Actually, make it $600 instead." }], answer: "The revised estimate is $600. I'll update the draft to match your change. The earlier figure was $500.", expect: {}, why: "The user explicitly changed the number, so following the new amount is consistent." },
  { id: "control-05", kind: "control", history: [{ role: "user", text: "I can meet on Wednesday after 3 p.m." }], answer: "You said Wednesday after 3 p.m. works for you. I'll suggest a 3:30 start. We can adjust the time if needed.", expect: {}, why: "The answer quotes the user's availability accurately." },
];
