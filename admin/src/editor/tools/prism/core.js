import './manual';
import Prism from 'prismjs';

/** Prism language components read the global `Prism`; make sure it is the instance we imported. */
if (typeof window !== 'undefined') window.Prism = Prism;

export default Prism;
