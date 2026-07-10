# Demo storyboard

The beat-by-beat script for the roughly three-minute demo. Lead with the standalone
app on the Marson scenario. Land three WOW catches on the plots. Prove Redline reports
clean when the analysis is clean. Close with the same engine loaded live as a Skill
inside Claude Science.

The golden path runs on the `fixture` compute target, so it is deterministic and needs
zero cloud credentials. Every number below is locked in the fixture and must reproduce
exactly. See `dataset.md` for the numbers and `honesty-rules.md` for the framing.

## The one framing you say out loud, early

The Marson/Pritchard authors did their analysis rigorously. There is no error in their
published work, and Redline never implies there is one. Redline audits a **naive foil**:
the standard cluster-then-annotate-then-DE workflow a less-experienced scientist would
run on the same data. Their rigor is the standard Redline helps others reach. Say a
version of this in the first twenty seconds. It is a hard constraint, not a footnote.

## Time budget

```
0:00  Cold open + intake            ~20s
0:20  Foundation: field resolution  ~20s
0:40  WOW 1 - the p-value deflates  ~25s   (Check 1, pseudoreplication)
1:05  WOW 2 - the state collapses   ~25s   (Check 2, double dipping)
1:30  WOW 3 - the slider            ~25s   (Check 3, clustering fragility)
1:55  The clean beat                ~15s   (Check 3, track a stable state -> Verified)
2:10  Check 4 - confounding         ~15s   (legible closer of the audit)
2:25  The report                    ~15s   (three flagged, one clean, citations)
2:40  The close - Claude Science    ~20s   (same engine, now a Skill, live)
```

## Beat 1 - Cold open and intake (0:00 to 0:20)

- **Screen:** the intake at `/start`, the Marson scenario already loaded. (The front-door
  landing lives at `/`; the cold open opens the tool directly.)
  The dataset card reads "CD4+ T cells, IL2RA knockdown vs non-targeting, Perturb-seq,"
  about 52,000 cells, about 3,200 genes, 4 donors, 2.4 GB.
- **Say:** "This is a real single-cell dataset from Gladstone. A scientist ran the
  standard workflow on it and pulled out four conclusions they are about to publish.
  Redline is going to try to break all four before Reviewer 2 does. To be clear, the
  authors of this dataset did their own analysis correctly. We are auditing the naive
  version a less-experienced scientist would run on the same data."
- **Honesty note:** the naive-foil framing is stated here and never contradicted.

## Beat 2 - Foundation: field resolution (0:20 to 0:40)

- **Screen:** `/fields`. Nine `obs` columns, each with a model-proposed role, a
  confidence level, and one line of reasoning. `donor_id` is proposed as the
  independent unit (high). `condition` as the grouping compared (high). `cell_barcode`
  as observation (high). `lane` as a nuisance whose two levels line up with condition
  (medium).
- **Say:** "Before any statistics run, Redline reads the columns and proposes the
  experimental design. Which column is the real biological replicate, which is the
  comparison, which are technical nuisances. A wrong guess here makes every downstream
  flag wrong, so the scientist confirms it, and nothing runs until they do."
- **Action:** confirm the design. Point at `donor_id` (4 donors) versus `cell_barcode`
  (about 52,000 cells). That gap is the whole first catch.

## Beat 3 - WOW 1, the p-value deflates (0:40 to 1:05)

- **Claim under audit:** "IL2RA knockdown significantly upregulates FOXP3 across CD4 T
  cells (p < 0.001)."
- **Screen:** `/checks/1`. The reasoning lines stream: counting units under `donor_id`,
  cells within a donor are correlated and not independent, aggregating to donor-level
  profiles and re-testing.
- **The WOW:** the naive cell-level p-value of about 6.2e-11 (n about 51,842) gets a
  strike through it, and the honest pseudobulk value across the 4 donors, about 0.21,
  drops in beside it. The tall reported bar collapses below the significance line. The badge
  turns to **Flagged** in red.
- **Say:** "The tiny p-value counted about 52,000 correlated cells as 52,000
  independent animals. Aggregate to one profile per donor, re-run with pseudobulk, and
  the effect is gone. This is pseudoreplication, Squair 2021, and this is the one check
  where Redline asserts the corrected result, because pseudobulk is the accepted-correct
  method."
- **Honesty note:** this is the only pillar that asserts a correction. The hard-stop
  branch (a `guide_batch` with two levels gives n=1 per group and no valid test exists)
  is worth a one-line mention if there is time, since it shows Redline stating a flat
  "no test is possible" instead of printing a number.

## Beat 4 - WOW 2, the fake state collapses (1:05 to 1:30)

- **Claim under audit:** "An activated Treg-like state defined by 4 markers, enriched
  under knockdown."
- **Screen:** `/checks/2`. The reasoning lines stream: split the counts into discovery
  and held-out halves by Poisson thinning, fit the four markers on discovery cells,
  score the same markers on held-out cells they never saw.
- **The WOW:** the four markers (TNFRSF9, ICOS, TIGIT, CTLA4) separate the state at
  discovery AUC about 0.90 and collapse to held-out AUC about 0.57, near chance. The
  claimed marker list collapses on screen. 0 of 4 survive. **Flagged**.
- **Say:** "The state was defined and then tested for its own markers on the same
  cells. That is double dipping, and it manufactures markers out of noise. Split the
  data, define the state on one half, test on the other, and the separation vanishes.
  Redline is honest that count splitting is evidence, not a certified FDR correction,
  and it names ClusterDE as the stronger method."
- **Honesty note:** do not overclaim Pillar 2. It reports how many markers survive a
  held-out test. It does not certify an FDR.

## Beat 5 - WOW 3, the slider (1:30 to 1:55)

- **Claim under audit:** "A distinct knockdown-responsive T-cell state."
- **Screen:** `/checks/3`, tracking the "Effector" state. A live resolution slider.
- **The WOW:** drag the slider across the sweep. The "Effector" cluster appears only in
  the resolution window 0.8 to 1.2 and vanishes on either side. It exists at one setting
  and is gone at the next. Stability is low. **Flagged**.
- **Say:** "The whole story rides on a clustering resolution the scientist never
  justified. Move the knob they left at a default and the state they discovered appears
  and disappears. It is a boundary of the algorithm, not a discrete population."

## Beat 6 - The clean beat, never cry wolf (1:55 to 2:10)

- **Screen:** same panel, re-track the "Naive" state on the same slider.
- **The turn:** the "Naive" state holds at every setting tested. The badge turns to
  **Verified** in green.
- **Say:** "Here is the part that makes Redline trustworthy. Track a state that is real
  and it holds at every resolution, and Redline says so plainly, in green, with the same
  confidence it gave the flags. A rigor tool that always finds a problem is a tool
  nobody trusts. If you point Redline at the authors' actual rigorous analysis, this is
  what you get."
- **Honesty note:** this beat is not optional. It is the direct answer to the "does it
  just always flag something" question a scientist judge will ask.

## Beat 7 - Check 4, confounding (2:10 to 2:25)

- **Claim under audit:** "Differential expression between knockdown and non-targeting
  control."
- **Screen:** `/checks/4`. An occupancy grid of condition against the technical `lane`.
- **The catch:** every knockdown sample ran on Lane-A and every non-targeting sample on
  Lane-B. Cramér's V is 1.00. Perfectly diagonal. Not separable. **Flagged.** If `lane`
  is left out of the nuisance set, Redline degrades to **Could not verify** and says it
  cannot assess a confound it was told to ignore, rather than guessing.
- **Say:** "The comparison is perfectly aligned with a technical variable. Any
  difference is the perturbation or the lane, and the data cannot tell you which. No
  treatment effect can be claimed from this comparison."

## Beat 8 - The report (2:25 to 2:40)

- **Screen:** `/report`. Three flagged, one clean, one citation behind every call, each
  conclusion rewritten in defensible language, ready to print.
- **Say:** "Four conclusions in, and Redline handed back a plain-English report: what is
  wrong, why it matters, the method paper that fixes each one, and a rewrite that
  survives peer review. Three were fragile or invalid. One was real, and Redline said
  so."

## Beat 9 - The close, Claude Science (2:40 to 3:00)

- **Screen:** switch to Claude Science, live. Load Redline as a Skill. Run one pillar
  (the pseudoreplication tool) on the same data and watch the same verdict come back.
- **Say:** "Everything you just saw was one engine. It is an MCP server and a Claude
  Skill, so the exact same rigor drops into Claude Science and into any scientist's own
  workflow. Same engine, now a Skill, live. This is not a demo that dies when the week
  ends. It is infrastructure a scientist runs on their own data tomorrow."
- **Mechanics:** the standalone app carried the controlled, photogenic path. Claude
  Science is the closer that proves portability. Keep the live Claude Science surface to
  a single quick call so the crash surface stays small.

## If a live surface fails

Everything except Beat 9 runs on the `fixture` target with no network dependency, so
the three WOW catches cannot fail on a flaky connection. If the Claude Science call
stalls, state the point ("same engine, now a Skill") over the loaded Skill in the
sidebar and move on. Never fake a result to cover a stall. The whole product is built
on not doing that.
