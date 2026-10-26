/**
 * CLI argument parsing and pure helper functions for @spatial-api/tester.
 */

export interface ParsedCollectionSpec {
  name: string;
  protocols: string[];
  srs: string;
  bbox: [number, number, number, number];
}

export interface CliResolvedParams {
  rawUrl?: string;
  targetUrl?: string;
  authUser: string;
  authPass: string;
  auth?: { user: string; pass: string };
  options: Record<string, string>;
  positional: string[];
}

/**
 * Parses double-dash flags into key-value pairs.
 * e.g. --key=value, --flag (value empty string), --val=foo=bar
 */
export function parseArgs(args: string[]): Record<string, string> {
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

/**
 * Extracts positional (non-flag) arguments.
 */
export function parsePositionalArgs(args: string[]): string[] {
  return args.filter(a => !a.startsWith('--'));
}

/**
 * Normalizes URL by ensuring http protocol is present if omitted.
 */
export function normalizeUrl(rawUrl: string): string {
  return rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`;
}

/**
 * Parses composite collections spec formatted as:
 * "trees:ogc,wfs2.0.0:EPSG:4326;lakes:ogc:EPSG:3857"
 */
export function parseCollectionsSpec(
  spec: string,
  discoveredCollections: { name: string; bbox?: [number, number, number, number] }[] = []
): ParsedCollectionSpec[] {
  const testCollections: ParsedCollectionSpec[] = [];
  const parts = spec.split(';');
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
      const foundCol = discoveredCollections.find(c => c.name === sub[0]);
      testCollections.push({
        name: sub[0],
        protocols: sub[1].split(','),
        srs: sub[2] || 'EPSG:4326',
        bbox: foundCol && foundCol.bbox ? foundCol.bbox : [-180, -90, 180, 90]
      });
    }
  }
  return testCollections;
}

/**
 * Resolves all CLI parameters including positional args, options, target URL, and auth credentials.
 */
export function resolveCliParams(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): CliResolvedParams {
  const positional = parsePositionalArgs(argv);
  const options = parseArgs(argv);

  const rawUrl = positional[0] || options.url;
  const authUser = options.user || env.AUTH_USER || '';
  const authPass = options.pass || env.AUTH_PASS || '';

  if (options.pass) {
    console.warn(
      'Security Warning: Supplying password credentials via command-line arguments is insecure. Use the AUTH_PASS environment variable instead.'
    );
  }

  const auth = (authUser || authPass) ? { user: authUser, pass: authPass } : undefined;
  const targetUrl = rawUrl ? normalizeUrl(rawUrl) : undefined;

  return {
    rawUrl,
    targetUrl,
    authUser,
    authPass,
    auth,
    options,
    positional
  };
}
