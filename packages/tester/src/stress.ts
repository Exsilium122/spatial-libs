import autocannon from 'autocannon';

export interface StressTestCollection {
  name: string;
  protocols: string[];
  srs: string;
  bbox?: [number, number, number, number];
}

export interface StressTestConfig {
  wfsUrl?: string;
  ogcUrl?: string;
  auth?: { user: string; pass: string };
  collections: StressTestCollection[];
  duration: number; // in seconds
  concurrency: number;
}

export interface TargetStressResult {
  target: string;
  requestsPerSecond: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  errors: number;
  totalRequests: number;
  bytesRead: number;
}

function getRandomBbox(extent: [number, number, number, number]): [number, number, number, number] {
  const [minLon, minLat, maxLon, maxLat] = extent;
  const rangeLon = Math.max(maxLon - minLon, 0.01);
  const rangeLat = Math.max(maxLat - minLat, 0.01);
  const widthLon = rangeLon * (0.1 + Math.random() * 0.4);
  const heightLat = rangeLat * (0.1 + Math.random() * 0.4);
  const leftLon = minLon + Math.random() * (rangeLon - widthLon);
  const bottomLat = minLat + Math.random() * (rangeLat - heightLat);
  return [
    parseFloat(leftLon.toFixed(6)),
    parseFloat(bottomLat.toFixed(6)),
    parseFloat((leftLon + widthLon).toFixed(6)),
    parseFloat((bottomLat + heightLat).toFixed(6))
  ];
}

/**
 * Runs parallel stress tests against all configured endpoints and aggregates the results.
 */
export async function runStressTests(config: StressTestConfig): Promise<TargetStressResult[]> {
  const runners: Promise<TargetStressResult>[] = [];

  const headers: Record<string, string> = {};
  if (config.auth && config.auth.user && config.auth.pass) {
    const token = Buffer.from(`${config.auth.user}:${config.auth.pass}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }

  for (const col of config.collections) {
    for (const proto of col.protocols) {
      const targetLabel = `${proto.toUpperCase()} - ${col.name} (${col.srs})`;
      const colBbox = col.bbox || [-180, -90, 180, 90];

      let targetUrl = '';
      if (proto === 'ogc' && config.ogcUrl) {
        targetUrl = config.ogcUrl;
      } else if (proto.startsWith('wfs') && config.wfsUrl) {
        targetUrl = config.wfsUrl;
      }

      if (!targetUrl) continue;

      const urlObj = new URL(targetUrl);
      const origin = urlObj.origin;
      const basePath = urlObj.pathname.replace(/\/$/, '');

      // Generate 20 random requests for round-robin execution
      const requests: any[] = [];
      for (let i = 0; i < 20; i++) {
        const bbox = getRandomBbox(colBbox);
        let path = '';

        if (proto === 'ogc') {
          path = `${basePath}/collections/${col.name}/items?limit=50&bbox=${bbox.join(',')}`;
        } else {
          const ver = proto.replace('wfs', '');
          const srsParamName = ver === '1.0.0' ? 'srsname' : 'srsName';
          const srsUrn = ver === '2.0.0' ? `urn:ogc:def:crs:EPSG::${col.srs.replace('EPSG:', '')}` : col.srs;
          path = `${basePath}?service=WFS&request=GetFeature&version=${ver}&typename=${col.name}&${srsParamName}=${encodeURIComponent(srsUrn)}&bbox=${bbox.join(',')}`;
        }

        requests.push({
          method: 'GET',
          path
        });
      }

      const promise = new Promise<TargetStressResult>((resolve, reject) => {
        const instance = autocannon(
          {
            url: origin,
            connections: config.concurrency,
            duration: config.duration,
            headers,
            pipelining: 1,
            workers: 0,
            requests
          },
          (err: any, result: any) => {
            if (err) {
              return reject(err);
            }

            resolve({
              target: targetLabel,
              requestsPerSecond: result.requests.average,
              avgLatencyMs: result.latency.average,
              maxLatencyMs: result.latency.max,
              errors: result.errors + result.non2xx,
              totalRequests: result.requests.total,
              bytesRead: result.throughput.total
            });
          }
        );

        // Keep track or log progress if needed
        autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false });
      });

      runners.push(promise);
    }
  }

  return Promise.all(runners);
}

/**
 * Renders a premium, ASCII aggregate load report table in the console.
 */
export function renderStressReport(
  results: TargetStressResult[],
  targetUrl: string,
  duration: number,
  concurrency: number
): void {
  console.log('\n' + '='.repeat(80));
  console.log('                     SPATIAL TESTER CONCURRENT LOAD REPORT');
  console.log('='.repeat(80));
  console.log(`Target URL: ${targetUrl}`);
  console.log(`Duration:   ${duration} seconds`);
  console.log(`Concurrent Workers: ${concurrency} per endpoint`);
  console.log('');

  // Table header
  console.log('┌' + '─'.repeat(27) + '┬' + '─'.repeat(12) + '┬' + '─'.repeat(13) + '┬' + '─'.repeat(13) + '┬' + '─'.repeat(13) + '┐');
  console.log(
    '│ ' +
    'Target (Endpoint)'.padEnd(25) +
    ' │ ' +
    'Req/Sec'.padEnd(10) +
    ' │ ' +
    'Avg Latency'.padEnd(11) +
    ' │ ' +
    'Max Latency'.padEnd(11) +
    ' │ ' +
    'Errors'.padEnd(11) +
    ' │'
  );
  console.log('├' + '─'.repeat(27) + '┼' + '─'.repeat(12) + '┼' + '─'.repeat(13) + '┼' + '─'.repeat(13) + '┼' + '─'.repeat(13) + '┤');

  let totalRps = 0;
  let totalErrors = 0;
  let totalRequests = 0;
  let totalBytes = 0;
  let sumAvgLatency = 0;
  let maxLatency = 0;

  for (const r of results) {
    totalRps += r.requestsPerSecond;
    totalErrors += r.errors;
    totalRequests += r.totalRequests;
    totalBytes += r.bytesRead;
    sumAvgLatency += r.avgLatencyMs * r.requestsPerSecond;
    if (r.maxLatencyMs > maxLatency) maxLatency = r.maxLatencyMs;

    console.log(
      '│ ' +
      r.target.padEnd(25).substring(0, 25) +
      ' │ ' +
      r.requestsPerSecond.toFixed(1).padStart(10) +
      ' │ ' +
      `${r.avgLatencyMs.toFixed(1)} ms`.padStart(11) +
      ' │ ' +
      `${r.maxLatencyMs.toFixed(1)} ms`.padStart(11) +
      ' │ ' +
      r.errors.toString().padStart(11) +
      ' │'
    );
  }

  const overallAvgLatency = totalRps > 0 ? sumAvgLatency / totalRps : 0;

  console.log('├' + '─'.repeat(27) + '┼' + '─'.repeat(12) + '┼' + '─'.repeat(13) + '┼' + '─'.repeat(13) + '┼' + '─'.repeat(13) + '┤');
  console.log(
    '│ ' +
    'TOTAL AGGREGATE LOAD'.padEnd(25) +
    ' │ ' +
    totalRps.toFixed(1).padStart(10) +
    ' │ ' +
    `${overallAvgLatency.toFixed(1)} ms`.padStart(11) +
    ' │ ' +
    `${maxLatency.toFixed(1)} ms`.padStart(11) +
    ' │ ' +
    totalErrors.toString().padStart(11) +
    ' │'
  );
  console.log('└' + '─'.repeat(27) + '┴' + '─'.repeat(12) + '┴' + '─'.repeat(13) + '┴' + '─'.repeat(13) + '┴' + '─'.repeat(13) + '┘');

  console.log('');
  console.log(`Total requests handled by target: ${totalRequests.toLocaleString()} requests`);
  
  const throughputMb = totalBytes / (1024 * 1024);
  const throughputRps = throughputMb / duration;
  console.log(`Total throughput achieved:       ${throughputRps.toFixed(2)} MB/sec (${throughputMb.toFixed(1)} MB read)`);
  
  if (totalErrors === 0) {
    console.log('\x1b[32m✔ All targets completed successfully with 0 errors!\x1b[0m');
  } else {
    console.log(`\x1b[31m⚠ Stress tests completed with ${totalErrors} errors. Check target backend health.\x1b[0m`);
  }
  console.log('='.repeat(80) + '\n');
}
