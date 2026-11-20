/**
 * Row actions inside a Design System table (2.7.8). DS 2.3 `Td` implements grid keyboard
 * navigation: when every focusable in a cell is a button, it calls `preventDefault()` on every
 * keydown of the cell, so Enter and Space never pressed Edit, Duplicate, Move or Delete.
 * Keeping those two keys inside the actions group lets the button handle them; arrow keys still
 * reach the table and move between the buttons.
 * @param {{ key: string, stopPropagation: () => void }} event - React keydown event.
 */
export const keepButtonKeys = (event) => {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};
