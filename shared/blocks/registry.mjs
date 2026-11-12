/**
 * Registration of code-defined blocks into the bundle's registry (server
 * service `blocks`, admin API `registerBlock`). Names are unique ignoring
 * case; registering the same definition object twice is a no-op.
 */

import { compileBlock, BlockDefinitionError } from './define.mjs';
import { activeBlock, activeBlockIgnoringCase, setActiveBlock } from './active.mjs';

/**
 * Registers a block definition.
 * @param {object} definition - Definition (`defineBlock` result or a plain object).
 * @returns {Readonly<object>} Compiled definition.
 * @throws {BlockDefinitionError} Invalid definition (`INVALID_DEFINITION`, `RESERVED_NAME`) or a name already registered by another definition (`NAME_TAKEN`).
 */
export const registerBlockDefinition = (definition) => {
  const compiled = compileBlock(definition);
  const existing = activeBlockIgnoringCase(compiled.name);
  if (existing) {
    if (existing === compiled) return compiled;
    throw new BlockDefinitionError(
      `Magic Editor X block "${compiled.name}": a block named "${existing.name}" is already registered`,
      'NAME_TAKEN'
    );
  }
  setActiveBlock(compiled);
  return activeBlock(compiled.name);
};
