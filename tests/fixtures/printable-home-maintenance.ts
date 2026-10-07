// =============================================================================
// TEST FIXTURE — NOT A PRODUCT. Scripted model output for the printable_pdf
// kind (products/printable.ts), written the way a capable model writes one:
// a real, usable fill-in file with honest content and no claim about the
// world. It is never sold, never published outside a test database, and the
// words "TEST FIXTURE" travel with it in `fixtureLabel`.
//
// Two variants of the same file:
//   * HONEST: what the gates should pass.
//   * WITH_A_STATISTIC: the same file with one invented statistic, which the
//     fabrication gate must refuse.
// =============================================================================

export const fixtureLabel = 'TEST FIXTURE: scripted model output, not a product';

/** The offer the composition call returns for a printable (shapeAndMake). */
export const PRINTABLE_OFFER = {
  kind: 'printable_pdf',
  title: 'The Home Maintenance Log',
  price_dollars: 9, price_because: 'a one-time file someone prints once and fills in for a year',
  product_name: 'Home Maintenance Log',
  sells: 'a printable fill-in log for one house: seasonal checklists, a service record, appliance details and contacts',
  claims_made: 'a blank log to fill in by hand; it does not say how often anything must be serviced in any particular house',
  collects: 'the buyer\'s email, read from the payment provider, to send the download link once',
  delivers_by: 'an email with a link to download the PDF, sent when the payment settles',
  sells_to: 'Homeowners and renters who keep their house paperwork by hand.',
  charges_how: 'one-time, $9, no subscription',
  lighter: 'a single file that is printed and filled in is the lightest thing that tests whether anybody pays for it',
  offer_subject: 'A printable home maintenance log',
  page: {
    summary: 'A printable log for one house: what to check each season, and a record of what was done and by whom.',
    who: 'People who look after a house and want its upkeep written down in one place.',
    what: 'One PDF, letter size, to print and fill in by hand: seasonal checklists, a service record, appliance and contact pages.',
    limits: 'It is a blank log. It does not tell you how often your own house needs anything; your manuals and your trades do.',
    sources: 'Nothing outside the file: it is a form to fill in, not a report.',
    note: 'A small pilot from the Workshop. If it is no use to you, you get your money back.',
  },
};

const seasonal = (season: string, items: string[]) => `<h3>${season}</h3><ul class="check">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const record = (rows: number) => `<table class="ws"><thead><tr><th>Date</th><th>What was done</th><th>Who did it</th><th>Cost</th></tr></thead><tbody>${'<tr><td></td><td></td><td></td><td></td></tr>'.repeat(rows)}</tbody></table>`;

/** The content call's answer: the pages, in the owned vocabulary only. */
export const PRINTABLE_CONTENT_HONEST = {
  subtitle: 'One place for what your house needs each season, and a record of what was done.',
  kicker: 'A fill-in household log',
  pages: [
    { heading: 'How to use this log', lede: 'Print it, keep it with the house papers, and write in pencil.',
      html: '<p>This log has two halves. The first is a set of seasonal checklists: tick what you have looked at, and leave blank what does not apply to your house. The second is a record: every time something is serviced, repaired or replaced, write one line.</p>'
        + '<div class="box green"><strong>The checklists are prompts, not a schedule.</strong> How often a furnace filter or a gutter needs attention depends on the house, the equipment and its manual. Where a manual gives an interval, write it beside the item.</div>'
        + '<h3>Before you start</h3><ul class="check"><li>Find the manuals for the main appliances, or note where they are kept.</li><li>Fill in the contacts page so the next person knows whom to call.</li><li>Write the date you started on the cover.</li></ul>' },
    { heading: 'Spring and summer', lede: 'Tick what you checked. Cross out what does not apply.',
      html: seasonal('Spring', ['Gutters and downspouts cleared', 'Outside taps turned back on and checked for drips', 'Window and door screens checked', 'Air-conditioning unit cleared of leaves and debris', 'Smoke and carbon monoxide alarms tested'])
        + seasonal('Summer', ['Deck or porch boards checked for loose fixings', 'Exterior paint and caulk looked over', 'Dryer vent cleaned', 'Garage door opener tested', 'Outdoor lights checked'])
        + '<div class="field"><span>Notes</span><i></i></div>' },
    { heading: 'Autumn and winter', lede: 'Tick what you checked. Cross out what does not apply.',
      html: seasonal('Autumn', ['Heating serviced, or booked', 'Furnace filter changed (write the size here once)', 'Outside taps drained and shut off', 'Gutters cleared after the leaves fall', 'Chimney checked before the first fire'])
        + seasonal('Winter', ['Pipes in cold spaces checked', 'Snow and ice tools ready', 'Attic looked at for damp or ice', 'Sump pump tested', 'Smoke and carbon monoxide alarms tested'])
        + '<div class="field"><span>Notes</span><i></i></div>' },
    { heading: 'Appliances and systems', lede: 'One line each. The model and serial numbers are on a plate on the unit.',
      html: '<table class="ws"><thead><tr><th>Appliance</th><th>Make and model</th><th>Serial</th><th>Installed</th></tr></thead><tbody>'
        + ['Furnace or boiler', 'Water heater', 'Air conditioning', 'Refrigerator', 'Washer', 'Dryer', 'Dishwasher', 'Range or oven'].map((a) => `<tr><td class="lbl">${a}</td><td></td><td></td><td></td></tr>`).join('')
        + '</tbody></table><div class="box"><strong>Filter sizes</strong><div class="field"><span>Furnace filter</span><i></i></div><div class="field"><span>Fridge water filter</span><i></i></div></div>' },
    { heading: 'Service record', lede: 'Every repair, service or replacement, one line each.', html: record(14) },
    { heading: 'Contacts', lede: 'Who to call, so the next person does not have to search.',
      html: '<table class="ws tall"><thead><tr><th>For</th><th>Name or company</th><th>Phone</th></tr></thead><tbody>'
        + ['Plumber', 'Electrician', 'Heating and cooling', 'Roofer', 'Handyman', 'Utility: power', 'Utility: water', 'Insurance'].map((a) => `<tr><td class="lbl">${a}</td><td></td><td></td></tr>`).join('')
        + '</tbody></table>' },
  ],
};

/** The same file, with one invented statistic slipped into the first page. */
export const PRINTABLE_CONTENT_WITH_A_STATISTIC = {
  ...PRINTABLE_CONTENT_HONEST,
  pages: [
    { ...PRINTABLE_CONTENT_HONEST.pages[0]!,
      html: '<p>Homeowners who keep a written log spend 43% less on emergency repairs, so this file pays for itself.</p>' + PRINTABLE_CONTENT_HONEST.pages[0]!.html },
    ...PRINTABLE_CONTENT_HONEST.pages.slice(1),
  ],
};
