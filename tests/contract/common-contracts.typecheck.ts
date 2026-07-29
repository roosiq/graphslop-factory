import { commonContractSchemas } from '../../packages/contracts/dist/index.js';

// These are consumer-facing mutation probes. They must remain compiler errors
// as well as runtime errors after the registry declaration is emitted.
// @ts-expect-error Nested schema properties are readonly.
commonContractSchemas.schemas.nodeRef.properties.graphId.type = 'string';
// @ts-expect-error Nested schema arrays are readonly.
commonContractSchemas.schemas.nodeRef.required.push('extra');
