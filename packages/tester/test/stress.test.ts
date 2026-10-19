import { describe, it, expect, vi } from 'vitest';
import { renderStressReport, TargetStressResult } from '../src/stress.js';

describe('renderStressReport', () => {
  it('correctly formats and prints aggregate load report with 0 errors', () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''));
    });

    const fixedResults: TargetStressResult[] = [
      {
        target: 'OGC - parcels (EPSG:4326)',
        requestsPerSecond: 120.5,
        avgLatencyMs: 8.2,
        maxLatencyMs: 45.0,
        errors: 0,
        totalRequests: 1205,
        bytesRead: 1048576 * 5 // 5 MB
      }
    ];

    renderStressReport(fixedResults, 'http://localhost:8080/ogc', 10, 5);

    spy.mockRestore();

    const output = logs.join('\n');

    // Headers and config
    expect(output).toContain('SPATIAL TESTER CONCURRENT LOAD REPORT');
    expect(output).toContain('Target URL: http://localhost:8080/ogc');
    expect(output).toContain('Duration:   10 seconds');
    expect(output).toContain('Concurrent Workers: 5 per endpoint');

    // Table column headers
    expect(output).toContain('Target (Endpoint)');
    expect(output).toContain('Req/Sec');
    expect(output).toContain('Avg Latency');
    expect(output).toContain('Max Latency');
    expect(output).toContain('Errors');

    // Target row
    expect(output).toContain('OGC - parcels (EPSG:4326)');
    expect(output).toContain('120.5');
    expect(output).toContain('8.2 ms');
    expect(output).toContain('45.0 ms');

    // Aggregate totals row
    expect(output).toContain('TOTAL AGGREGATE LOAD');
    expect(output).toContain('1,205 requests');
    expect(output).toContain('5.0 MB read');

    // Success banner
    expect(output).toContain('All targets completed successfully with 0 errors!');
  });

  it('correctly aggregates multiple endpoints and reports error warnings when errors > 0', () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''));
    });

    const fixedResults: TargetStressResult[] = [
      {
        target: 'WFS2.0.0 - trees (EPSG:4326)',
        requestsPerSecond: 100.0,
        avgLatencyMs: 10.0,
        maxLatencyMs: 50.0,
        errors: 0,
        totalRequests: 1000,
        bytesRead: 1048576 // 1 MB
      },
      {
        target: 'OGC - lakes (EPSG:3857)',
        requestsPerSecond: 200.0,
        avgLatencyMs: 25.0,
        maxLatencyMs: 120.0,
        errors: 7,
        totalRequests: 2000,
        bytesRead: 2097152 // 2 MB
      }
    ];

    renderStressReport(fixedResults, 'http://localhost:9000', 10, 10);

    spy.mockRestore();

    const output = logs.join('\n');

    // Overall RPS = 100 + 200 = 300.0
    expect(output).toContain('300.0');

    // Weighted avg latency = (100 * 10 + 200 * 25) / 300 = 6000 / 300 = 20.0 ms
    expect(output).toContain('20.0 ms');

    // Max latency among all targets = 120.0 ms
    expect(output).toContain('120.0 ms');

    // Total errors = 7
    expect(output).toContain('7 errors');

    // Total requests = 3000
    expect(output).toContain('3,000 requests');

    // Total bytes = 3 MB / 10s = 0.30 MB/sec (3.0 MB read)
    expect(output).toContain('0.30 MB/sec (3.0 MB read)');

    // Warning banner
    expect(output).toContain('Stress tests completed with 7 errors. Check target backend health.');
  });

  it('handles empty results gracefully without throwing', () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''));
    });

    renderStressReport([], 'http://localhost:8080', 5, 2);

    spy.mockRestore();

    const output = logs.join('\n');
    expect(output).toContain('TOTAL AGGREGATE LOAD');
    expect(output).toContain('0.0 ms');
    expect(output).toContain('0 requests');
    expect(output).toContain('All targets completed successfully with 0 errors!');
  });
});
