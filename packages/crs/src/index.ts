import proj4 from 'proj4';

export interface GeoJSONGeometry {
  type: string;
  coordinates: any;
}

export interface CoordinateTransformer {
  normalizeSrs(srsName: string): string;
  isSupported(srsName: string): boolean;
  getSupportedCodes(): string[];
  transformCoordinate(coords: [number, number], fromSrs: string, toSrs: string): [number, number];
  transformGeometry(geometry: GeoJSONGeometry, fromSrs: string, toSrs: string): GeoJSONGeometry;
}

// 1. Core database of preloaded projection definitions
const BUILTIN_PROJECTIONS: Record<string, string> = {
  // Global / Worldwide
  'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs +type=crs',
  'EPSG:3857': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +type=crs',
  'EPSG:900913': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +type=crs',
  'EPSG:4269': '+proj=longlat +datum=NAD83 +no_defs +type=crs',

  // Sweden (SWEREF 99 National and Municipal/Local zones)
  'EPSG:3006': '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3007': '+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3008': '+proj=tmerc +lat_0=0 +lon_0=13.5 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3009': '+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3010': '+proj=tmerc +lat_0=0 +lon_0=16.5 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3011': '+proj=tmerc +lat_0=0 +lon_0=18 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3012': '+proj=tmerc +lat_0=0 +lon_0=14.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3013': '+proj=tmerc +lat_0=0 +lon_0=15.75 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3014': '+proj=tmerc +lat_0=0 +lon_0=17.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3015': '+proj=tmerc +lat_0=0 +lon_0=18.75 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3016': '+proj=tmerc +lat_0=0 +lon_0=20.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3017': '+proj=tmerc +lat_0=0 +lon_0=21.75 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:3018': '+proj=tmerc +lat_0=0 +lon_0=23.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',

  // Poland (PUWG 1992 & PUWG 2000 Zones 5-8)
  'EPSG:2180': '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:2176': '+proj=tmerc +lat_0=0 +lon_0=15 +k=0.999923 +x_0=5500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:2177': '+proj=tmerc +lat_0=0 +lon_0=18 +k=0.999923 +x_0=6500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:2178': '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:2179': '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.999923 +x_0=8500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',

  // Germany (ETRS89 / UTM & legacy DHDN / Gauss-Krüger 3-degree zones)
  'EPSG:25832': '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs',
  'EPSG:25833': '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs +type=crs',
  'EPSG:4647': '+proj=tmerc +lat_0=0 +lon_0=9 +k=0.9996 +x_0=32500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs',
  'EPSG:5648': '+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=33500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs',
  'EPSG:31466': '+proj=tmerc +lat_0=0 +lon_0=6 +k=1 +x_0=2500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs +type=crs',
  'EPSG:31467': '+proj=tmerc +lat_0=0 +lon_0=9 +k=1 +x_0=3500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs +type=crs',
  'EPSG:31468': '+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs +type=crs',
  'EPSG:31469': '+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=5500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs +type=crs',

  // France (Lambert-93 & Legacy Lambert II Extended)
  'EPSG:2154': '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:27572': '+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=0 +k_0=0.99987742 +x_0=600000 +y_0=2200000 +a=6378249.2 +b=6356515 +towgs84=-168,-60,320,0,0,0,0 +pm=paris +units=m +no_defs +type=crs',

  // Norway (EUREF89 / UTM zones 32N-35N & NTM high-precision zones)
  'EPSG:25834': '+proj=utm +zone=34 +ellps=GRS80 +units=m +no_defs +type=crs',
  'EPSG:25835': '+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs +type=crs',
  'EPSG:5105': '+proj=tmerc +lat_0=58 +lon_0=5 +k=1 +x_0=100000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:5106': '+proj=tmerc +lat_0=58 +lon_0=6 +k=1 +x_0=100000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:5109': '+proj=tmerc +lat_0=58 +lon_0=9 +k=1 +x_0=100000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  'EPSG:5122': '+proj=tmerc +lat_0=58 +lon_0=22 +k=1 +x_0=100000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
};

// 2. Built-in Local Synonyms Map
const BUILTIN_SYNONYMS: Record<string, string> = {
  // Sweden SWEREF99 TM and local zones
  'SWEREF 99 TM': 'EPSG:3006',
  'SWEREF99 TM': 'EPSG:3006',
  'SWEREF 99 12 00': 'EPSG:3007',
  'SWEREF99 12 00': 'EPSG:3007',
  'SWEREF 99 13 30': 'EPSG:3008',
  'SWEREF99 13 30': 'EPSG:3008',
  'SWEREF 99 15 00': 'EPSG:3009',
  'SWEREF99 15 00': 'EPSG:3009',
  'SWEREF 99 16 30': 'EPSG:3010',
  'SWEREF99 16 30': 'EPSG:3010',
  'SWEREF 99 18 00': 'EPSG:3011',
  'SWEREF99 18 00': 'EPSG:3011',
  'SWEREF 99 14 15': 'EPSG:3012',
  'SWEREF99 14 15': 'EPSG:3012',
  'SWEREF 99 15 45': 'EPSG:3013',
  'SWEREF99 15 45': 'EPSG:3013',
  'SWEREF 99 17 15': 'EPSG:3014',
  'SWEREF99 17 15': 'EPSG:3014',
  'SWEREF 99 18 45': 'EPSG:3015',
  'SWEREF99 18 45': 'EPSG:3015',
  'SWEREF 99 20 15': 'EPSG:3016',
  'SWEREF99 20 15': 'EPSG:3016',
  'SWEREF 99 21 45': 'EPSG:3017',
  'SWEREF99 21 45': 'EPSG:3017',
  'SWEREF 99 23 15': 'EPSG:3018',
  'SWEREF99 23 15': 'EPSG:3018',

  // France Lambert
  'LAMBERT 93': 'EPSG:2154',
  'LAMBERT93': 'EPSG:2154',
  'LAMBERT II EXTENDED': 'EPSG:27572',
  'LAMBERT II ETENDU': 'EPSG:27572',

  // Poland CS92 & CS2000
  'CS92': 'EPSG:2180',
  'PUWG 1992': 'EPSG:2180',
  'PUWG 2000 ZONE 5': 'EPSG:2176',
  'CS2000 ZONE 5': 'EPSG:2176',
  'PUWG 2000 ZONE 6': 'EPSG:2177',
  'CS2000 ZONE 6': 'EPSG:2177',
  'PUWG 2000 ZONE 7': 'EPSG:2178',
  'CS2000 ZONE 7': 'EPSG:2178',
  'PUWG 2000 ZONE 8': 'EPSG:2179',
  'CS2000 ZONE 8': 'EPSG:2179',

  // Germany
  'DHDN ZONE 2': 'EPSG:31466',
  'GAUSS-KRUGER ZONE 2': 'EPSG:31466',
  'GAUSS-KRÜGER ZONE 2': 'EPSG:31466',
  'DHDN ZONE 3': 'EPSG:31467',
  'GAUSS-KRUGER ZONE 3': 'EPSG:31467',
  'GAUSS-KRÜGER ZONE 3': 'EPSG:31467',
  'DHDN ZONE 4': 'EPSG:31468',
  'GAUSS-KRUGER ZONE 4': 'EPSG:31468',
  'GAUSS-KRÜGER ZONE 4': 'EPSG:31468',
  'DHDN ZONE 5': 'EPSG:31469',
  'GAUSS-KRUGER ZONE 5': 'EPSG:31469',
  'GAUSS-KRÜGER ZONE 5': 'EPSG:31469',
  'ETRS89 UTM 32N': 'EPSG:25832',
  'ETRS89 UTM 33N': 'EPSG:25833',
};

// Register in proj4 at package start
Object.entries(BUILTIN_PROJECTIONS).forEach(([code, projStr]) => {
  proj4.defs(code, projStr);
});

export class CrsTransformerClass implements CoordinateTransformer {
  private customCodes: Set<string> = new Set();
  private synonymsMap: Map<string, string> = new Map();

  constructor() {
    // Populate built-in synonyms
    Object.entries(BUILTIN_SYNONYMS).forEach(([syn, target]) => {
      this.synonymsMap.set(syn.toUpperCase(), target);
    });
  }

  /**
   * Registers a custom projection definition string at runtime.
   */
  public register(code: string, projString: string): void {
    const formatted = code.toUpperCase().startsWith('EPSG:') ? code.toUpperCase() : `EPSG:${code}`;
    proj4.defs(formatted, projString);
    this.customCodes.add(formatted);
  }

  /**
   * Registers a new local synonym mapping to a standard target code at runtime.
   */
  public registerSynonym(synonym: string, targetCode: string): void {
    const formattedSyn = synonym.trim().toUpperCase();
    const formattedTarget = targetCode.toUpperCase().startsWith('EPSG:') ? targetCode.toUpperCase() : `EPSG:${targetCode}`;
    this.synonymsMap.set(formattedSyn, formattedTarget);
  }

  /**
   * Normalizes different projection formats (URNs, URLs, shortcodes, local synonyms) into clean 'EPSG:XXXX' format.
   */
  public normalizeSrs(srsName: string): string {
    if (!srsName) return 'EPSG:4326';
    
    const trimmed = srsName.trim();
    const upper = trimmed.toUpperCase();

    // 1. Check in synonyms registry (custom + built-in)
    if (this.synonymsMap.has(upper)) {
      return this.synonymsMap.get(upper)!;
    }
    
    // 2. Check for OGC API Core CRS84 synonyms
    if (
      /crs84/i.test(trimmed) || 
      /CRS:84/i.test(trimmed) || 
      /OGC:1.3:CRS84/i.test(trimmed)
    ) {
      return 'EPSG:4326';
    }

    // 3. Capture standard EPSG digit grouping
    const epsgMatch = trimmed.match(/(?:EPSG|epsg.xml|EPSG\/0\/)(?::|#)*(\d+)/i);
    if (epsgMatch && epsgMatch[1]) {
      return `EPSG:${epsgMatch[1]}`;
    }

    return trimmed;
  }

  /**
   * Checks if a normalized or raw SRS name is supported.
   */
  public isSupported(srsName: string): boolean {
    const normalized = this.normalizeSrs(srsName);
    return normalized in BUILTIN_PROJECTIONS || this.customCodes.has(normalized);
  }

  /**
   * Returns a list of all registered coordinate codes (e.g. ['EPSG:4326', ...])
   */
  public getSupportedCodes(): string[] {
    return Array.from(new Set([
      ...Object.keys(BUILTIN_PROJECTIONS),
      ...Array.from(this.customCodes)
    ]));
  }

  /**
   * Transforms a single 2D coordinate point [lon, lat] or [x, y] on-the-fly.
   */
  public transformCoordinate(
    coords: [number, number],
    fromSrs: string,
    toSrs: string
  ): [number, number] {
    const normFrom = this.normalizeSrs(fromSrs);
    const normTo = this.normalizeSrs(toSrs);
    
    if (normFrom === normTo) {
      return [coords[0], coords[1]];
    }

    // proj4 expects [lon, lat] / [x, y] sequence for conversion
    const result = proj4(normFrom, normTo, coords);
    return [result[0], result[1]];
  }

  /**
   * Recursively traverses and reprojects all coordinates inside a standard GeoJSON Geometry.
   */
  public transformGeometry(
    geometry: GeoJSONGeometry,
    fromSrs: string,
    toSrs: string
  ): GeoJSONGeometry {
    if (!geometry || !geometry.coordinates) {
      return geometry;
    }

    const normFrom = this.normalizeSrs(fromSrs);
    const normTo = this.normalizeSrs(toSrs);

    if (normFrom === normTo) {
      return geometry;
    }

    const recurse = (coords: any): any => {
      if (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        return this.transformCoordinate(coords as [number, number], normFrom, normTo);
      }
      if (Array.isArray(coords)) {
        return coords.map(recurse);
      }
      return coords;
    };

    return {
      type: geometry.type,
      coordinates: recurse(geometry.coordinates),
    };
  }
}

export const CrsTransformer = new CrsTransformerClass();
export default CrsTransformer;
