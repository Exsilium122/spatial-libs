import { describe, expectTypeOf, it } from 'vitest';
import type {
  CollectionDescription,
  CoordinateTransformer,
  Feature,
  FeatureEncoder,
  FeatureResult,
  Filter,
  FilterOperator,
  Geometry,
  GetFeaturesParams,
  Logger,
  PropertySchema,
  ProviderCapabilities,
  RequestContext,
  ServiceInfo,
  ServiceLimits,
  SpatialProvider,
  SpatialRequest,
  SpatialResponse,
  SpatialService,
  TransactionResult,
  WriteOperation,
} from '../src/types.js';

describe('Core Contract Types', () => {
  it('verifies contract types with expectTypeOf', () => {
    // SpatialProvider structural check
    expectTypeOf<SpatialProvider>().toBeObject();
    expectTypeOf<SpatialProvider['describeCollections']>().toBeFunction();
    expectTypeOf<SpatialProvider['getFeatures']>().toBeFunction();

    // Feature and Geometry
    expectTypeOf<Feature>().toBeObject();
    expectTypeOf<Feature['type']>().toEqualTypeOf<'Feature'>();
    expectTypeOf<Feature['geometry']>().toEqualTypeOf<Geometry | null>();

    // CollectionDescription
    expectTypeOf<CollectionDescription>().toBeObject();
    expectTypeOf<CollectionDescription['id']>().toBeString();
    expectTypeOf<CollectionDescription['storageCrs']>().toBeString();

    // Capabilities
    expectTypeOf<ProviderCapabilities>().toBeObject();
    expectTypeOf<ProviderCapabilities['paging']>().toBeBoolean();
    expectTypeOf<ProviderCapabilities['count']>().toEqualTypeOf<'exact' | 'none'>();

    // Filter & Operators
    expectTypeOf<FilterOperator>().toBeString();
    expectTypeOf<Filter>().not.toBeNever();

    // Context & Params
    expectTypeOf<RequestContext>().toBeObject();
    expectTypeOf<GetFeaturesParams>().toBeObject();
    expectTypeOf<FeatureResult>().toBeObject();

    // Writes
    expectTypeOf<WriteOperation>().toBeObject();
    expectTypeOf<TransactionResult>().toBeObject();

    // Encoders and Transformers
    expectTypeOf<FeatureEncoder>().toBeObject();
    expectTypeOf<CoordinateTransformer>().toBeObject();

    // Service & HTTP abstractions
    expectTypeOf<SpatialRequest>().toBeObject();
    expectTypeOf<SpatialResponse>().toBeObject();
    expectTypeOf<SpatialService>().toBeObject();
    expectTypeOf<ServiceInfo>().toBeObject();
    expectTypeOf<ServiceLimits>().toBeObject();
    expectTypeOf<Logger>().toBeObject();
  });
});
