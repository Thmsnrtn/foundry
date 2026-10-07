// =============================================================================
// WHAT A CAPABLE MODEL WRITES — the printable files, theme by theme.
//
// Modelled on the playbook bench's product (sim2/playbook-bench: "The
// Handover File", 22 pages, read by the buyer panel): a calm cover, a page
// that says how to use it, then pages that are mostly structure — tables with
// boxes to write in, tick lists, writing lines — and a closing essentials
// page. No statistic, no testimonial, no credential, no advice about a
// reader's own legal, medical or money decision: instructions, prompts and
// blanks are what a good file is made of (the writer's own system prompt).
//
// Each page is written in the closed vocabulary `printable.ts` allows. A
// degraded brain reaches for the same pages and spoils them in the ways a
// cheaper model does (see `degrade`).
// =============================================================================
import type { ThemeKey } from '../twin/segments.js';

export interface Page { heading: string; lede: string; html: string }
export interface FileSpec { title: string; subtitle: string; kicker: string; pages: Page[] }

const table = (cols: string[], rows: number, labels: string[] = []): string =>
  `<table class="ws"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
    Array.from({ length: rows }, (_, i) => `<tr>${cols.map((_c, j) => (j === 0 && labels[i] ? `<td class="lbl">${labels[i]!}</td>` : '<td></td>')).join('')}</tr>`).join('')}</tbody></table>`;
const ticks = (items: string[]): string => `<ul class="check">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const lines = (n: number): string => `<div class="lines">${'<i></i>'.repeat(n)}</div>`;
const field = (label: string): string => `<div class="field"><span>${label}</span><i></i></div>`;
const note = (text: string): string => `<div class="box">${text}</div>`;

const HOW_TO: Page = {
  heading: 'Read this first', lede: 'How to use this file without it becoming a chore.',
  html: `<p>Fill in one page at a time. Start with the page you would most want someone else to find, and leave the rest for another day.</p>${
    ticks(['Use pencil for anything that changes often.', 'Write where a thing is kept, never a password.', 'Put the date at the top of each page when you update it.', 'Keep the file somewhere the people who need it know about.'])}${
    note('<strong>Locations, not secrets.</strong> This file says where things are. It is not a place for passwords or account numbers in full.')}`,
};

export const LIBRARY: Readonly<Record<ThemeKey, { titles: readonly string[]; kicker: string; subtitle: string; pages: Page[] }>> = {
  handover: {
    titles: ['The Handover File', 'The Where-Everything-Is File'], kicker: 'For the people you trust',
    subtitle: 'A fill-in file that tells the people you trust where everything is, if they ever need to step in.',
    pages: [
      HOW_TO,
      { heading: 'Who to call first', lede: 'The first few calls, in order.', html: table(['Who', 'Why', 'Phone or email'], 10, ['First', 'Second', 'Third']) },
      { heading: 'Where the papers are', lede: 'Each document and where it is kept.', html: table(['Document', 'Where it is kept', 'Updated'], 14, ['Identity papers', 'Insurance', 'House or lease', 'Car', 'Pension']) },
      { heading: 'Bills and accounts', lede: 'What is paid, how, and what to do with it.', html: table(['Bill or account', 'Paid how', 'Keep, cancel or transfer'], 14) },
      { heading: 'Insurance and policies', lede: 'Policies, who holds them, and the number to ring.', html: table(['Policy', 'Provider', 'Where the papers are'], 10) },
      { heading: 'Digital accounts', lede: 'Where the sign-in details are kept — never the details themselves.', html: `${table(['Account', 'What it is for', 'Where the sign-in is kept'], 12)}${note('Write where to find a password, not the password.')}` },
      { heading: 'People who depend on you', lede: 'Children, pets and anyone else in your care.', html: table(['Name', 'What they need', 'Who can step in'], 8) },
      { heading: 'Home and car', lede: 'Keys, alarms, the car and who services what.', html: `${table(['Thing', 'Where or who', 'Notes'], 10)}${field('Spare keys are with')}` },
      { heading: 'Wishes and notes', lede: 'Anything you would want the people you trust to know.', html: lines(16) },
      { heading: 'The thirty-minute essentials', lede: 'If you fill in only one page, fill in this one.', html: `${field('Who to call first')}${field('Where the papers are')}${field('Where the sign-in details are kept')}${field('Who looks after the people in your care')}${lines(6)}` },
    ],
  },
  'home-upkeep': {
    titles: ['The Home Maintenance Log', 'The House Upkeep Record'], kicker: 'Keep the house on paper',
    subtitle: 'A log for what the house needs and when it was last done, kept by the boiler where it is needed.',
    pages: [
      HOW_TO,
      { heading: 'The house at a glance', lede: 'The things anyone working on the house asks first.', html: `${field('Water stopcock')}${field('Fuse box')}${field('Gas meter')}${field('Boiler make and model')}${lines(6)}` },
      { heading: 'Appliances', lede: 'Each appliance, its model and where the manual is.', html: table(['Appliance', 'Model', 'Bought', 'Manual kept'], 14) },
      { heading: 'Filters and parts', lede: 'Sizes you would otherwise measure again.', html: table(['What', 'Size or part', 'Last changed'], 12) },
      { heading: 'Spring checklist', lede: 'Once a year, when the weather turns.', html: ticks(['Gutters cleared', 'Outside taps checked', 'Smoke alarms tested', 'Window seals looked at', 'Garden hoses out', 'Air conditioning serviced']) },
      { heading: 'Autumn checklist', lede: 'Before the cold.', html: ticks(['Boiler serviced', 'Chimney swept', 'Outside taps drained', 'Draught strips checked', 'Smoke alarms tested', 'Roof looked at from the ground']) },
      { heading: 'Service record', lede: 'Every visit, who came and what they did.', html: table(['Date', 'Who', 'What was done', 'Cost'], 14) },
      { heading: 'Trades you trust', lede: 'The people you would call again.', html: table(['Trade', 'Name', 'Phone'], 10) },
    ],
  },
  'family-organiser': {
    titles: ['The Family Week Planner', 'The Fridge Week'], kicker: 'One week on one sheet',
    subtitle: 'A week of school runs, meals and chores on paper, for the fridge door.',
    pages: [
      HOW_TO,
      { heading: 'The week at a glance', lede: 'Who is where, each day.', html: table(['Day', 'Morning', 'After school', 'Evening'], 7, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) },
      { heading: 'Meals', lede: 'Plan the week, then write the shopping list once.', html: table(['Day', 'Breakfast', 'Lunch', 'Dinner'], 7, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) },
      { heading: 'Shopping list', lede: 'By aisle, so the shop is one trip.', html: `<div class="cols">${table(['Fresh'], 12)}${table(['Cupboard'], 12)}</div>` },
      { heading: 'Chores chart', lede: 'Who does what, ticked when done.', html: table(['Chore', 'Who', 'Mon', 'Wed', 'Fri'], 12) },
      { heading: 'Kids\' routines', lede: 'Morning and bedtime, in the order they happen.', html: `<div class="cols">${ticks(['Dressed', 'Breakfast', 'Teeth', 'Bag packed', 'Shoes on'])}${ticks(['Bath', 'Pyjamas', 'Teeth', 'Story', 'Lights out'])}</div>` },
      { heading: 'Dates to remember', lede: 'School events, birthdays and appointments.', html: table(['Date', 'What', 'Who'], 14) },
    ],
  },
  'caregiver-log': {
    titles: ['The Care Log', 'The Shared Care Record'], kicker: 'For everyone who helps',
    subtitle: 'One record the whole family can write in when they help look after someone.',
    pages: [
      HOW_TO,
      { heading: 'About the person', lede: 'What any helper should know first.', html: `${field('Name')}${field('Main doctor')}${field('Pharmacy')}${field('Allergies (as told by their doctor)')}${lines(6)}` },
      { heading: 'Medication list', lede: 'Copied from the prescription labels; ask the pharmacist about any change.', html: table(['Medicine', 'As written on the label', 'Prescribed by'], 12) },
      { heading: 'Appointments', lede: 'Who, when, and what to ask.', html: table(['Date', 'With', 'Questions to ask', 'Who goes'], 12) },
      { heading: 'Visit notes', lede: 'Each helper writes what they did and noticed.', html: table(['Date', 'Helper', 'What happened'], 14) },
      { heading: 'Who helps when', lede: 'The rota, so nobody is left guessing.', html: table(['Day', 'Morning', 'Afternoon', 'Evening'], 7, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) },
      { heading: 'Important numbers', lede: 'Everyone a helper might need to ring.', html: table(['Who', 'Why', 'Phone'], 12) },
    ],
  },
  'bills-tracker': {
    titles: ['The Bills Tracker', 'The Household Bills Book'], kicker: 'Nothing due by surprise',
    subtitle: 'Every bill, its due date and how it is paid, on paper you can see at a glance.',
    pages: [
      HOW_TO,
      { heading: 'Every bill', lede: 'The list, once, with how each is paid.', html: table(['Bill', 'Due day', 'Paid how', 'Autopay?'], 14) },
      { heading: 'Subscriptions', lede: 'What you pay for, and when it renews.', html: table(['Subscription', 'Renews', 'Still used?'], 14) },
      { heading: 'This month', lede: 'Tick each bill as it goes out.', html: table(['Bill', 'Due', 'Paid on', 'Done'], 14) },
      { heading: 'Next month', lede: 'The same page again.', html: table(['Bill', 'Due', 'Paid on', 'Done'], 14) },
      { heading: 'Notes', lede: 'Calls made, changes asked for, letters to answer.', html: lines(18) },
    ],
  },
  'side-business': {
    titles: ['The Side-Business Logbook', 'The Mileage and Receipts Log'], kicker: 'A year on paper',
    subtitle: 'Mileage, receipts and invoices for a small side business, kept as they happen.',
    pages: [
      HOW_TO,
      { heading: 'Mileage', lede: 'Each trip, as it happens.', html: table(['Date', 'From – to', 'Why', 'Miles'], 14) },
      { heading: 'Receipts', lede: 'What was bought, and where the receipt is kept.', html: table(['Date', 'What', 'Amount', 'Receipt kept'], 14) },
      { heading: 'Invoices sent', lede: 'Who was invoiced, and when they paid.', html: table(['Invoice', 'Client', 'Sent', 'Paid'], 14) },
      { heading: 'Month end', lede: 'Five minutes at the end of each month.', html: ticks(['Mileage added up', 'Receipts filed', 'Unpaid invoices chased', 'Notes for the year end written']) },
      { heading: 'Year-end notes', lede: 'What whoever does the books will ask.', html: lines(18) },
    ],
  },
  'pet-care': {
    titles: ['The Pet Care Record', 'The Pet Sitter File'], kicker: 'Everything the sitter asks',
    subtitle: 'Food, walks, the vet and the vaccinations, on pages to hand a sitter.',
    pages: [
      HOW_TO,
      { heading: 'About the pet', lede: 'What a sitter needs on the first morning.', html: `${field('Name')}${field('Food and how much (as the vet advised)')}${field('Walks')}${field('Where the lead and bags are')}${lines(6)}` },
      { heading: 'The vet', lede: 'Who to ring, and where they are.', html: `${field('Vet')}${field('Phone')}${field('Emergency vet')}${lines(4)}` },
      { heading: 'Vaccinations and visits', lede: 'Copied from the vet\'s record card.', html: table(['Date', 'What', 'Next due'], 14) },
      { heading: 'Daily routine', lede: 'The day, in order.', html: table(['Time', 'What', 'Notes'], 12) },
      { heading: 'Sitter notes', lede: 'Each sitter writes what happened.', html: table(['Date', 'Sitter', 'Notes'], 14) },
    ],
  },
};

/** The spec a capable writer returns for a title it chose when shaping the offer. */
export function capableFile(theme: ThemeKey, title: string): FileSpec {
  const t = LIBRARY[theme];
  return { title, subtitle: t.subtitle, kicker: t.kicker, pages: t.pages };
}

/** The total pages a buyer receives: the writer's pages and the template's cover, contents and closing page. */
export const printedPages = (theme: ThemeKey): number => LIBRARY[theme].pages.length + 3;
