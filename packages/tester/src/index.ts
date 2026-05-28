#!/usr/bin/env node
import inquirer from 'inquirer';
import { probeTarget, DiscoveredCollection, ProbeResult } from './probing.js';
import { runSmokeTests } from './smoke.js';
import { runStressTests, renderStressReport } from './stress.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const parts = arg.substring(2).split('=');
      const key = parts[0];
      result[key] = parts.slice(1).join('=');
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const options = parseArgs(args);

  const rawUrl = positional[0] || options.url;
  const authUser = options.user || process.env.AUTH_USER || '';
  const authPass = options.pass || process.env.AUTH_PASS || '';

  if (!rawUrl) {
    console.log('\n\x1b[1m\x1b[36m================================================================================');
    console.log('                 SPATIAL PROTOCOL INTEGRATION & STRESS TESTER');
    console.log('================================================================================\x1b[0m');
    console.log('Usage (Zero-Config Interactive Mode):');
    console.log('  npx @spatial-api/tester <target-url> [auth-user] [auth-pass]');
    console.log('');
    console.log('Usage (Scriptable Automation Mode):');
    console.log('  npx @spatial-api/tester \\');
    console.log('    --url="http://localhost:9002" \\');
    console.log('    --user="admin" --pass="secret" \\');
    console.log('    --collections="trees:ogc,wfs2.0.0:EPSG:4326;lakes:ogc:EPSG:3857" \\');
    console.log('    --mode="stress" \\');
    console.log('    --duration=15');
    console.log('');
    console.log('Please re-run the tool with a target URL to start probing.');
    process.exit(0);
  }

  let auth = (authUser || authPass) ? { user: authUser, pass: authPass } : undefined;
  const targetUrl = rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`;

  console.log(`\n\x1b[36m[spatial-tester]\x1b[0m Probing ${targetUrl}...`);

  let probeResult!: ProbeResult;
  let attempts = 0;

  while (attempts < 3) {
    try {
      probeResult = await probeTarget(targetUrl, auth);
      break;
    } catch (err: any) {
      if (err.statusCode === 401) {
        if (options.collections || options.mode) {
          console.error(`\x1b[31mError probing target: Unauthorized (Basic Authentication required but not provided or invalid)\x1b[0m`);
          process.exit(1);
        }

        attempts++;
        if (attempts >= 3) {
          console.error(`\x1b[31mError probing target: Unauthorized (3 attempts failed)\x1b[0m`);
          process.exit(1);
        }

        console.log(`\n\x1b[33m⚠ Target requires Basic Authentication. Please enter credentials:\x1b[0m (Attempt ${attempts}/3)`);
        
        const promptQuestions = [];
        let askUser = false;
        let askPass = false;

        if (attempts === 1) {
          // On the first failure, if only one credential was supplied, ask only for the missing one
          const hasUser = !!(auth && auth.user);
          const hasPass = !!(auth && auth.pass);

          if (hasUser && !hasPass) {
            askPass = true;
          } else if (!hasUser && hasPass) {
            askUser = true;
          } else {
            askUser = true;
            askPass = true;
          }
        } else {
          // On subsequent attempts, ask for both to allow correction of both fields
          askUser = true;
          askPass = true;
        }

        if (askUser) {
          promptQuestions.push({
            type: 'input',
            name: 'user',
            message: 'Username:',
            default: auth?.user,
            validate: (input: string) => input.trim().length > 0 ? true : 'Username cannot be empty.'
          });
        }
        if (askPass) {
          promptQuestions.push({
            type: 'password',
            name: 'pass',
            message: 'Password:',
            mask: '*',
            validate: (input: string) => input.length > 0 ? true : 'Password cannot be empty.'
          });
        }

        const credentials = await inquirer.prompt(promptQuestions);
        auth = {
          user: askUser ? credentials.user : (auth?.user || ''),
          pass: askPass ? credentials.pass : (auth?.pass || '')
        };

        console.log(`\x1b[36m[spatial-tester]\x1b[0m Retrying probing ${targetUrl}...`);
      } else {
        console.error(`\x1b[31mError probing target: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    }
  }

  if (!probeResult) {
    console.error(`\x1b[31mError probing target: Failed to retrieve capabilities\x1b[0m`);
    process.exit(1);
  }

  if (!probeResult.wfsUrl && !probeResult.ogcUrl) {
    console.warn('\x1b[33m⚠ Warning: No active WFS or OGC Features endpoints could be auto-discovered on the provided URL.\x1b[0m');
    console.log('Ensure the server is running and accessible.');
    process.exit(1);
  }

  if (probeResult.wfsUrl) {
    console.log(`  \x1b[32m✔ Found WFS Endpoint:\x1b[0m ${probeResult.wfsUrl} (Versions: ${probeResult.wfsVersions.join(', ')})`);
  }
  if (probeResult.ogcUrl) {
    console.log(`  \x1b[32m✔ Found OGC Endpoint:\x1b[0m ${probeResult.ogcUrl}`);
  }

  console.log(`  \x1b[32m✔ Discovered ${probeResult.collections.length} collections/layers dynamically.\x1b[0m\n`);

  // --- AUTOMATION MODE (Non-Interactive) ---
  if (options.collections || options.mode) {
    const mode = options.mode || 'smoke';
    const duration = parseInt(options.duration || '10', 10);
    const concurrency = parseInt(options.concurrency || '10', 10);

     const testCollections: any[] = [];
    if (options.collections) {
      // composite format trees:ogc,wfs2.0.0:EPSG:4326;lakes:ogc:EPSG:3857
      const parts = options.collections.split(';');
      for (const p of parts) {
        const sub: string[] = [];
        const firstColon = p.indexOf(':');
        if (firstColon !== -1) {
          sub.push(p.substring(0, firstColon));
          const secondColon = p.indexOf(':', firstColon + 1);
          if (secondColon !== -1) {
            sub.push(p.substring(firstColon + 1, secondColon));
            sub.push(p.substring(secondColon + 1));
          } else {
            sub.push(p.substring(firstColon + 1));
          }
        }

        if (sub.length >= 2) {
          const foundCol = probeResult.collections.find(c => c.name === sub[0]);
          testCollections.push({
            name: sub[0],
            protocols: sub[1].split(','),
            srs: sub[2] || 'EPSG:4326',
            bbox: foundCol ? foundCol.bbox : [-180, -90, 180, 90]
          });
        }
      }
    } else {
      // Default to all discovered collections on all their supported protocols
      testCollections.push(...probeResult.collections.map(c => ({
        name: c.name,
        protocols: c.protocols,
        srs: c.projections[0] || 'EPSG:4326',
        bbox: c.bbox
      })));
    }

    if (mode === 'stress') {
      console.log(`[spatial-tester] Launching concurrent load stress benchmark (${duration}s duration, ${concurrency} connections)...`);
      try {
        const stats = await runStressTests({
          wfsUrl: probeResult.wfsUrl,
          ogcUrl: probeResult.ogcUrl,
          auth,
          collections: testCollections,
          duration,
          concurrency
        });
        renderStressReport(stats, targetUrl, duration, concurrency);
      } catch (err: any) {
        console.error(`\x1b[31mStress test failed: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    } else {
      console.log('[spatial-tester] Running integration / smoke tests...');
      const stats = await runSmokeTests({
        url: targetUrl,
        auth,
        wfsUrl: probeResult.wfsUrl,
        ogcUrl: probeResult.ogcUrl,
        collections: testCollections
      });
      
      console.log('\n============================= SMOKE TEST RESULTS =============================');
      let failed = false;
      for (const s of stats) {
        if (s.passed) {
          console.log(`\x1b[32m✔ PASS:\x1b[0m [${s.target}] - ${s.message}`);
        } else {
          console.log(`\x1b[31m✘ FAIL:\x1b[0m [${s.target}] - ${s.message}`);
          failed = true;
        }
      }
      console.log('==============================================================================\n');
      process.exit(failed ? 1 : 0);
    }
    return;
  }

  // --- INTERACTIVE MODE ---
  if (probeResult.collections.length === 0) {
    console.log('No feature collections were discovered on the target server. Exiting.');
    process.exit(0);
  }

  interface PreviousSetup {
    selectedCollections: any[];
    collectionConfigs: Record<string, {
      protocols: string[];
      srs: string;
    }>;
    mode: 'smoke' | 'stress';
    duration: number;
    concurrency: number;
  }

  async function runInteractiveFlow(previousSetup?: PreviousSetup) {
    const colChoices = probeResult.collections.map((c: DiscoveredCollection) => {
      const isChecked = previousSetup
        ? previousSetup.selectedCollections.some((pc: any) => pc.name === c.name)
        : false;
      return {
        name: `${c.name} (Available on: ${c.protocols.map((p: string) => p.toUpperCase()).join(', ')})`,
        value: c,
        checked: isChecked
      };
    });

    const answers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedCollections',
        message: 'Select the spatial collections to target:',
        choices: colChoices,
        validate: (input) => input.length > 0 ? true : 'You must select at least one collection.'
      }
    ]);

    const configuredCollections: any[] = [];

    for (const col of answers.selectedCollections as DiscoveredCollection[]) {
      console.log(`\n\x1b[1m--- Configure Collection: ${col.name} ---\x1b[0m`);

      const prevColConfig = previousSetup?.collectionConfigs[col.name];

      const colConfig = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'protocols',
          message: `Select protocols to hit for ${col.name}:`,
          choices: col.protocols.map(p => ({
            name: p.toUpperCase(),
            value: p,
            checked: prevColConfig ? prevColConfig.protocols.includes(p) : false
          })),
          validate: (input) => input.length > 0 ? true : 'Select at least one protocol.'
        },
        {
          type: 'list',
          name: 'srs',
          message: `Select Projection (SRS) for ${col.name}:`,
          choices: col.projections,
          default: prevColConfig ? prevColConfig.srs : (col.projections[0] || 'EPSG:4326')
        }
      ]);

      configuredCollections.push({
        name: col.name,
        protocols: colConfig.protocols,
        srs: colConfig.srs,
        bbox: col.bbox
      });
    }

    console.log('\n\x1b[1m--- Configure Test Parameters ---\x1b[0m');
    const params = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'Select the test mode:',
        choices: [
          { name: 'Run Integration / Smoke Tests', value: 'smoke' },
          { name: 'Run Performance / Stress Tests (Benchmarking)', value: 'stress' }
        ],
        default: previousSetup ? previousSetup.mode : 'smoke'
      },
      {
        type: 'input',
        name: 'duration',
        message: 'Enter benchmark duration (seconds):',
        default: previousSetup ? previousSetup.duration : 10,
        when: (answers) => answers.mode === 'stress',
        validate: (input) => {
          const num = parseInt(input, 10);
          return !isNaN(num) && num > 0 ? true : 'Please enter a valid positive number.';
        }
      },
      {
        type: 'input',
        name: 'concurrency',
        message: 'Enter concurrency per endpoint (concurrent workers):',
        default: previousSetup ? previousSetup.concurrency : 10,
        when: (answers) => answers.mode === 'stress',
        validate: (input) => {
          const num = parseInt(input, 10);
          return !isNaN(num) && num > 0 ? true : 'Please enter a valid positive number.';
        }
      }
    ]);

    if (params.mode === 'stress') {
      const duration = parseInt(params.duration, 10);
      const concurrency = parseInt(params.concurrency, 10);

      console.log(`\n[spatial-tester] Launching concurrent load stress benchmark (${duration}s duration, ${concurrency} connections)...`);
      try {
        const stats = await runStressTests({
          wfsUrl: probeResult.wfsUrl,
          ogcUrl: probeResult.ogcUrl,
          auth,
          collections: configuredCollections,
          duration,
          concurrency
        });
        renderStressReport(stats, targetUrl, duration, concurrency);
      } catch (err: any) {
        console.error(`\x1b[31mStress test execution failed: ${err.message}\x1b[0m`);
      }
    } else {
      console.log('\n[spatial-tester] Running integration / smoke tests...');
      try {
        const stats = await runSmokeTests({
          url: targetUrl,
          auth,
          wfsUrl: probeResult.wfsUrl,
          ogcUrl: probeResult.ogcUrl,
          collections: configuredCollections
        });

        console.log('\n============================= SMOKE TEST RESULTS =============================');
        for (const s of stats) {
          if (s.passed) {
            console.log(`\x1b[32m✔ PASS:\x1b[0m [${s.target}] - ${s.message}`);
          } else {
            console.log(`\x1b[31m✘ FAIL:\x1b[0m [${s.target}] - ${s.message}`);
          }
        }
        console.log('==============================================================================\n');
      } catch (err: any) {
        console.error(`\x1b[31mSmoke test execution failed: ${err.message}\x1b[0m`);
      }
    }

    const cmdParts = ['npx @spatial-api/tester', targetUrl];
    if (auth) {
      cmdParts.push(`--user="${auth.user}"`);
      if (auth.pass) {
        cmdParts.push(`--pass="****"`);
      }
    }

    const collectionsParam = configuredCollections.map(cc => {
      return `${cc.name}:${cc.protocols.join(',')}:${cc.srs}`;
    }).join(';');

    cmdParts.push(`--collections="${collectionsParam}"`);
    cmdParts.push(`--mode="${params.mode}"`);

    if (params.mode === 'stress') {
      cmdParts.push(`--duration=${params.duration}`);
      cmdParts.push(`--concurrency=${params.concurrency}`);
    }

    console.log('\n\x1b[36m💡 Run this exact test setup directly in a single command next time:\x1b[0m');
    console.log(`\x1b[1m\x1b[32m  ${cmdParts.join(' ')}\x1b[0m\n`);

    const postTest = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Tests completed. What would you like to do next?',
        choices: [
          { name: 'Exit program', value: 'exit' },
          { name: 'Start fresh (Configure new settings)', value: 'fresh' },
          { name: 'Reuse previous setup (Modify existing choices)', value: 'reuse' }
        ]
      }
    ]);

    if (postTest.action === 'exit') {
      console.log('Exiting spatial-tester. Goodbye!');
      process.exit(0);
    } else if (postTest.action === 'fresh') {
      await runInteractiveFlow(undefined);
    } else if (postTest.action === 'reuse') {
      const nextSetup: PreviousSetup = {
        selectedCollections: answers.selectedCollections,
        collectionConfigs: {},
        mode: params.mode,
        duration: params.mode === 'stress' ? parseInt(params.duration, 10) : 10,
        concurrency: params.mode === 'stress' ? parseInt(params.concurrency, 10) : 10
      };

      for (const cc of configuredCollections) {
        nextSetup.collectionConfigs[cc.name] = {
          protocols: cc.protocols,
          srs: cc.srs
        };
      }

      await runInteractiveFlow(nextSetup);
    }
  }

  await runInteractiveFlow(undefined);
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
