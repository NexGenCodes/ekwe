import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(HERE, 'money-funnel.json');
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

// Credentials come from the environment (never committed):
//   POSTHOG_PROJECT_API_KEY  personal API key (starts with "phx_").
//                            Project secret keys ("phs_") return 401 on these endpoints.
//   POSTHOG_PROJECT_ID       numeric PostHog project id
//   POSTHOG_HOST             default https://us.i.posthog.com (EU: https://eu.i.posthog.com)
const API_KEY = process.env.POSTHOG_PROJECT_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

function printGuide() {
  console.log(`Ekwe analytics catalog: ${path.relative(process.cwd(), CATALOG_PATH)}`);
  console.log('');
  console.log(
    `This catalog declares ${catalog.dashboards.length} dashboards and ${catalog.cohorts.length} cohorts against the tracked PostHog events.`,
  );
  console.log('');
  console.log('To push them into your PostHog project (idempotent by name):');
  console.log('  1. In PostHog → Settings → Project → API keys → Create API key.');
  console.log('  2. Set env vars and re-run:');
  console.log('     POSTHOG_PROJECT_API_KEY=phx_... POSTHOG_PROJECT_ID=<id> npm run analytics:sync');
  console.log('');
  console.log('To create everything or anything absent, this run would have called:');
  console.log(`     POST ${HOST}/api/projects/${PROJECT_ID || '<project-id>'}/dashboards`);
  console.log(`     POST ${HOST}/api/projects/${PROJECT_ID || '<project-id>'}/insights`);
  console.log(`     POST ${HOST}/api/projects/${PROJECT_ID || '<project-id>'}/cohorts`);
  console.log('');
  console.log('Funnel stages expect the events wired in apps/mobile/src/utils/analytics.ts,');
  console.log('which also mirrors the definitions in scripts/analytics/money-funnel.json.');
}

async function api(sub, method = 'GET', body = null) {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}${sub}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POSTHOG ${method} ${sub} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function findByName(collection, name) {
  const page = await api(`/${collection}/?limit=1000`);
  for (const item of page.results || []) {
    if (item.name === name) return item;
  }
  return null;
}

async function sync() {
  if (!API_KEY || !PROJECT_ID) {
    printGuide();
    process.exit(0);
  }

  const created = { dashboards: 0, insights: 0, cohorts: 0 };

  // Dashboards + their insights
  for (const dashboardDef of catalog.dashboards) {
    let dashboard = await findByName('dashboards', dashboardDef.name);
    if (!dashboard) {
      dashboard = await api('/dashboards', 'POST', {
        name: dashboardDef.name,
        description: dashboardDef.description || null,
      });
      created.dashboards += 1;
      console.log(`created dashboard: ${dashboardDef.name}`);
    }

    for (const insightDef of dashboardDef.insights) {
      const existing = await findByName('insights', insightDef.name);
      if (existing) {
        console.log(`skipped (exists): ${insightDef.name}`);
        continue;
      }
      await api('/insights', 'POST', {
        name: insightDef.name,
        query: { kind: 'InsightVizNode', source: insightDef.query },
        dashboards: [dashboard.id],
      });
      created.insights += 1;
      console.log(`created insight: ${insightDef.name}`);
    }
  }

  // Cohorts
  for (const cohortDef of catalog.cohorts) {
    const existing = await findByName('cohorts', cohortDef.name);
    if (existing) {
      console.log(`skipped (exists): ${cohortDef.name}`);
      continue;
    }
    await api('/cohorts', 'POST', {
      name: cohortDef.name,
      description: cohortDef.description,
      is_static: cohortDef.is_static,
      filters: cohortDef.filters,
    });
    created.cohorts += 1;
    console.log(`created cohort: ${cohortDef.name}`);
  }

  console.log('');
  console.log(
    `Done. Created ${created.dashboards} dashboards, ${created.insights} insights, ${created.cohorts} cohorts.`,
  );
}

sync().catch((err) => {
  console.error(err.message);
  process.exit(1);
});