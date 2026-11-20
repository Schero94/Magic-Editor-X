/**
 * Date filter values of the audit trail (2.7.8). The URL and the API use calendar dates
 * (`YYYY-MM-DD`); the Design System DatePicker takes and returns `Date` objects. Its value is
 * read as the UTC calendar day (`toISOString`), and it reports a picked day as local midnight,
 * the same conversion the Strapi admin's own date input uses (FormInputs/Date: `toUTCMidnight`).
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` -> Date at UTC midnight of that day, for the DatePicker `value`.
 * @param {string} text - Calendar date or ''.
 * @returns {Date|undefined} Date, or undefined when empty or malformed.
 */
export const toDateValue = (text) => {
  const match = DATE_PATTERN.exec(String(text || ''));
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Date the DatePicker reported (local midnight of the picked day) -> `YYYY-MM-DD`.
 * @param {Date|undefined|null} date - Picked date.
 * @returns {string} Calendar date, '' when cleared.
 */
export const fromDateValue = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
