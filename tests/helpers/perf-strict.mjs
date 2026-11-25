/**
 * Wall-clock assertions in unit tests run only with MEX_PERF_STRICT=1 (CI job `bench`, which has
 * its runner to itself). Loaded or shared runners (the workbench CI runs every plugin's tests on
 * one 2-core runner) make millisecond limits fail at random; the tests assert behaviour by
 * default, and the browser benchmark (npm run bench:browser) measures time in the editor.
 */
export const STRICT_TIMING = process.env.MEX_PERF_STRICT === '1';
