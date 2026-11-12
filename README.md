# Fick

Simple diffusion simulations.

## Legacy simulator: 5.4.1

Open `diffusion_main_5_4.html` in a browser. The filename is retained for existing
links; the page and exports identify version **5.4.1**. Package version: **1.0.1**.

Issue 8: the legacy solver previously capped execution at two million steps and
returned a partial profile as though the requested annealing time had elapsed.
It now checks the required work before integration and refuses runs that exceed
that budget. The page explains the failure and suggests reducing the duration
or grid resolution. Failed runs clear stale plots and do not produce a download.
The stable time-step bound is retained rather than increasing the time step to
force an oversized run to fit.

Successful runs reach the requested duration. Time-history plots use the actual
snapshot timestamps; text exports record requested duration, actual duration and
the completed step count.

## Verification

Run `npm test` with Node.js. The regression tests use the page's actual inline
JavaScript, with browser/chart stubs, and cover the step-budget boundary,
completion times, history timestamps, visible failures, blocked incomplete
exports, export metadata, syntax and version consistency. No npm dependency
installation is needed to run these tests.
