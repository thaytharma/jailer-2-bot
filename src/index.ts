import { loadConfig, type Config } from './config.js';
import { decide, type CheckResult, type Notification, type SourceResult } from './decide.js';
import { http } from './fetch.js';
import { sendNtfy } from './notify/ntfy.js';
import { SOURCES, type Source } from './sources/index.js';
import { emptyMovie, loadState, saveState } from './state.js';

async function check(source: Source, movie: string): Promise<CheckResult> {
  try {
    return { ok: true, sighting: await source.check(movie, http) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function deliver(config: Config, notification: Notification): Promise<boolean> {
  if (!config.ntfy) {
    console.warn('! no notification channel configured — set NTFY_TOPIC');
    return false;
  }
  try {
    await sendNtfy(config.ntfy, notification);
    console.log('  sent via ntfy');
    return true;
  } catch (error) {
    console.error(`  FAILED via ntfy: ${String(error)}`);
    return false;
  }
}

/**
 * Verify the notification wiring without waiting for a real announcement.
 * Touches no state, so it can be run any time.
 */
async function sendTestNotification(config: Config): Promise<void> {
  const delivered = await deliver(config, {
    kind: 'listed',
    title: 'Cinema bot test',
    body: `Test notification — watching for ${config.movie} in Oslo. Æøå works too.`,
    url: 'https://www.filmweb.no/program?location=Oslo',
    priority: 3,
    tags: ['white_check_mark'],
  });
  if (!delivered) process.exitCode = 1;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  if (process.env.TEST_NOTIFICATION) {
    await sendTestNotification(config);
    return;
  }

  const state = await loadState(config.statePath);
  const previous = state.movies[config.movie] ?? emptyMovie();
  const now = new Date().toISOString();

  const results: SourceResult[] = await Promise.all(
    SOURCES.map(async (source) => ({
      id: source.id,
      label: source.label,
      homepage: source.homepage,
      result: await check(source, config.movie),
    })),
  );

  for (const { label, result } of results) {
    const detail = result.ok
      ? `${result.sighting.level}${result.sighting.titles.length ? ` (${result.sighting.titles.join(', ')})` : ''}, ${result.sighting.screenings.length} screenings`
      : `error: ${result.error}`;
    console.log(`${label.padEnd(11)} ${detail}`);
  }

  const { next, notifications } = decide(config.movie, previous, results, now);
  let failedDelivery = false;

  for (const notification of notifications) {
    console.log(`> notifying: ${notification.title}`);
    if (await deliver(config, notification)) continue;
    failedDelivery = true;
    // Nobody heard it, so do not mark it as sent — retry on the next run.
    if (notification.kind === 'broken') {
      const health = notification.sourceId ? next.sources[notification.sourceId] : undefined;
      if (health) health.brokenWarningSent = false;
    } else {
      next.notifiedLevel = previous.notifiedLevel;
    }
  }

  state.movies[config.movie] = next;
  await saveState(config.statePath, state);

  // Fail the CI run so a broken notification path is visible, not silent.
  if (failedDelivery) process.exitCode = 1;
}

await main();
