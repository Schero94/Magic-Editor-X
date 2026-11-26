/**
 * Pure logic of the migration wizard (2.13, Settings > Migrate content): selection defaults,
 * request bodies, progress and the texts of converter notes. No React, so `node --test` covers it.
 */

/** Value of the locale select meaning "every locale". */
export const ALL_LOCALES = '*';

/**
 * Picks defaults after the content type changed: the only source or target is preselected.
 * @param {{ sources: Array<{ name: string }>, targets: Array<{ name: string }> }|null} type - Selected type.
 * @param {{ from: string, to: string }} current - Current selection.
 * @returns {{ from: string, to: string }} Selection.
 */
export const fieldDefaults = (type, current = { from: '', to: '' }) => {
  if (!type) return { from: '', to: '' };
  const keep = (list, name) => (list.some((entry) => entry.name === name) ? name : '');
  const from = keep(type.sources, current.from) || (type.sources.length === 1 ? type.sources[0].name : '');
  const to = keep(type.targets, current.to) || (type.targets.length === 1 ? type.targets[0].name : '');
  return { from, to };
};

/**
 * Request body of preview and start; null until the selection is complete.
 * @param {{ uid: string, from: string, to: string, locale: string, overwrite: boolean }} selection - Selection.
 * @param {boolean} localized - The type uses i18n.
 * @returns {object|null} Body.
 */
export const requestBody = (selection, localized) => {
  if (!selection.uid || !selection.from || !selection.to || selection.from === selection.to) return null;
  const body = {
    uid: selection.uid,
    from: selection.from,
    to: selection.to,
    overwrite: Boolean(selection.overwrite),
  };
  if (localized) body.locale = selection.locale || ALL_LOCALES;
  return body;
};

/**
 * Progress of a job in percent (0-100, whole numbers).
 * @param {{ total: number, processed: number, status: string }|null} job - Job.
 * @returns {number} Percent.
 */
export const progressOf = (job) => {
  if (!job) return 0;
  if (job.status === 'done') return 100;
  if (!job.total) return 0;
  return Math.max(0, Math.min(100, Math.floor((job.processed / job.total) * 100)));
};

/**
 * Message key and English text of a converter note (`image-skipped`, `unsupported-node:callout`,
 * `unsupported-element:iframe`, ...). Unknown notes are shown by their code.
 * @param {string} note - Note code.
 * @returns {{ key: string, text: string, values: object }} Message.
 */
export const noteMessage = (note) => {
  const [reason, detail = ''] = String(note).split(':');
  if (reason === 'image-skipped')
    return {
      key: 'settings.migration.note.image',
      text: 'An image without a usable address (for example an embedded data image) was left out.',
      values: {},
    };
  if (reason === 'unsupported-node')
    return {
      key: 'settings.migration.note.node',
      text: 'A block of the type {type} has no Magic Editor X equivalent and was left out.',
      values: { type: detail || '?' },
    };
  if (reason === 'unsupported-element')
    return {
      key: 'settings.migration.note.element',
      text: 'An HTML element {type} was left out.',
      values: { type: detail || '?' },
    };
  if (reason === 'too-many-blocks')
    return {
      key: 'settings.migration.note.tooMany',
      text: 'The content has more blocks than a field can hold; the rest was left out.',
      values: {},
    };
  return {
    key: 'settings.migration.note.other',
    text: 'Something could not be converted ({code}).',
    values: { code: note },
  };
};

/**
 * True while a job still needs batches.
 * @param {{ status: string }|null} job - Job.
 * @returns {boolean} Running.
 */
export const isRunning = (job) => Boolean(job) && job.status === 'running';

/**
 * Content Manager list path of a content type.
 * @param {{ uid: string, kind?: string }} type - Type (`kind` from the schema; defaults to a collection type).
 * @returns {string} Admin path.
 */
export const contentManagerPath = (type) =>
  `/content-manager/${type.kind === 'singleType' ? 'single-types' : 'collection-types'}/${type.uid}`;

/**
 * File name of a backup download.
 * @param {{ uid: string, from: string, to: string }} selection - Selection.
 * @param {Date} [now] - Time.
 * @returns {string} File name.
 */
export const backupFileName = (selection, now = new Date()) => {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const type = String(selection.uid)
    .split('.')
    .pop()
    .replace(/[^a-z0-9-]/gi, '');
  return `magic-editor-x-backup-${type}-${selection.from}-${selection.to}-${stamp}.json`;
};

/**
 * Message key and English text of a failure code of the migrate service.
 * @param {string} code - `VALIDATION`, `WRITE_FAILED`, `CONVERT_FAILED`, `UNSUPPORTED_VALUE` or another code.
 * @returns {{ key: string, text: string }} Message.
 */
export const failureMessage = (code) => {
  if (code === 'VALIDATION')
    return {
      key: 'settings.migration.failure.validation',
      text: 'not accepted by the field preset or validation',
    };
  if (code === 'UNSUPPORTED_VALUE')
    return { key: 'settings.migration.failure.unsupported', text: 'the source value could not be read' };
  if (code === 'CONVERT_FAILED' || code === 'TOO_LARGE' || code === 'TOO_MANY_BLOCKS')
    return { key: 'settings.migration.failure.convert', text: 'the content could not be converted' };
  return { key: 'settings.migration.failure.write', text: 'the entry could not be saved' };
};
