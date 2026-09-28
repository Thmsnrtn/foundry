# The job review, recalculated by LibreOffice

Recorded 2026-09-28 by `scripts/recalculate-job-review.mts`, against job review v0.1.0.
Engine: LibreOffice 24.2.7.2 420(Build:2), headless, calculating each file from nothing (the files carry no cached values).

| Case, worked by hand | Cells compared | Result |
|---|---|---|
| a normal job: 2,800 planned contribution became 1,850 | 16 | all agree |
| a loss stays visible as a negative contribution and a negative margin | 7 | all agree |
| an approved change is judged apart from the quote | 7 | all agree |
| missing actual hours make everything that needs them unknown, and nothing else | 14 | all agree |
| a supplier credit reduces materials, and the margin with it | 12 | all agree |
| zero revenue has no margin, and says "undefined" rather than dividing | 6 | all agree |
| rounds as a spreadsheet does: 12.5 hours at $47.33 is $591.63 | 2 | all agree |
| a blank that means "none" must be entered as 0: a blank credit is unknown, not zero | 7 | all agree |
| the invented example the buyer sees on opening | 14 | all agree |

Every compared cell agrees with the figure worked on paper.

What this does not show: that Excel, Numbers or Google Sheets calculate the same, that the sheet
protection and input validation behave in them as written, or that a buyer can use the file. Those
are recorded as proof debt in `river/proof-3-candidates/DOSSIER.md`.
