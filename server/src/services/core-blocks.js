'use strict';

const { yup, errors } = require('@strapi/utils');
const { createLogger } = require('../utils/logger');
const {
  createValidatorHelpers,
  createRegistry,
  checkHookPoint,
  installBridge,
  detectNativeSupport,
  runCanary,
  isUnknownToStrapi,
  unwrap,
} = require('../utils/core-blocks-bridge');

/** How often a process re-reads the Settings switch, so every process of a cluster follows it. */
const REFRESH_MS = 30 * 1000;

const STORE_KEY = 'settings';

/**
 * Core Blocks bridge service (2.7): registry of custom block types for Strapi's core `blocks`
 * field and the switch that lets them pass Strapi's server-side validation.
 *
 * States (`status().state`):
 * - `off`: the switch is off (default). Strapi's validator is untouched.
 * - `idle`: on, but no type is registered. The wrapper passes every call straight to Strapi.
 * - `active`: on, types registered, wrapper installed after the canary passed.
 * - `native`: the running Strapi validates custom blocks itself; the bridge stays out and hands
 *   the registrations to Strapi's registry when it can.
 * - `unavailable`: the hook point is missing or changed, or the canary failed. The bridge does
 *   nothing; custom nodes are rejected by Strapi as before. One error is logged.
 *
 * The effective switch is the Settings value once it was saved, otherwise `coreBlocks.enabled`
 * from config/plugins.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 * @returns {object} Service.
 */
module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const helpers = createValidatorHelpers(yup);
  const registry = createRegistry(helpers);

  let storedEnabled = null;
  let enabled = false;
  let wasEnabled = false;
  let stopped = false;
  /** Strapi's unwrapped validator and the probe uid, kept after a passed canary for type probes. */
  let probeContext = null;
  /** type -> true when Strapi does not know it (the bridge may validate it), false when Strapi does. */
  const probed = new Map();
  const claimedLogged = new Set();
  let state = 'off';
  let reason = null;
  let canary = null;
  let uninstall = null;
  let timer = null;
  let applying = Promise.resolve();
  const forwarded = new Set();
  const reported = new Set();

  const configEnabled = () => strapi.config.get('plugin::magic-editor-x.coreBlocks.enabled') === true;

  const reportOnce = (code) => {
    if (reported.has(code)) return;
    reported.add(code);
    const text = {
      COLLECT_FAILED: 'Core Blocks bridge: a write could not be inspected; Strapi validated it unchanged',
      VALIDATOR_THREW: 'Core Blocks bridge: a registered block validator threw; the write was rejected',
      RESTORE_FAILED:
        "Core Blocks bridge: Strapi's validation result changed shape; the write was rejected so no custom block is lost",
    }[code];
    logger.error(text || `Core Blocks bridge: ${code}`);
  };

  const readStored = async () => {
    try {
      const stored = await strapi.store({ type: 'plugin', name: 'magic-editor-x' }).get({ key: STORE_KEY });
      const value = stored && stored.coreBlocks && stored.coreBlocks.enabled;
      return typeof value === 'boolean' ? value : null;
    } catch {
      return storedEnabled;
    }
  };

  /** The registry as the wrapper sees it: only types Strapi was probed not to know. */
  const usable = (type) => registry.has(type) && probed.get(type) === true;
  const activeView = {
    has: usable,
    get: (type) => (usable(type) ? registry.get(type) : undefined),
    size: () => registry.list().filter(({ type }) => usable(type)).length,
  };
  const claimedByStrapi = () =>
    registry
      .list()
      .map(({ type }) => type)
      .filter((type) => probed.get(type) === false);
  const settledState = () => (activeView.size() ? 'active' : 'idle');

  /**
   * Probes every registered type that was not probed in this enable cycle against Strapi's own
   * validator. A type Strapi already validates is left to Strapi (logged once).
   * @returns {Promise<void>} Settled when all pending types are probed.
   */
  const probePending = async () => {
    if (!probeContext) return;
    for (const { type } of registry.list()) {
      if (stopped) return;
      if (probed.has(type)) continue;
      // A probe that throws counts as "Strapi knows it": the type is left to Strapi (fail closed).
      const unknown = await isUnknownToStrapi({ ...probeContext, type }).catch(() => false);
      probed.set(type, unknown);
      if (!unknown && !claimedLogged.has(type)) {
        claimedLogged.add(type);
        logger.warn(
          `Core Blocks bridge: Strapi already validates the block type "${type}" itself; the bridge leaves it to Strapi`
        );
      }
    }
  };

  const remove = () => {
    if (uninstall) uninstall();
    uninstall = null;
  };

  /**
   * Hands one registration to Strapi's native registry. Native helpers win over the bridge's,
   * `yup` is always provided.
   * @param {Function} nativeRegister - Native registration function.
   * @param {{ type: string, plugin: string, source: object|Function }} entry - Registered entry.
   * @returns {boolean} True when Strapi accepted it.
   */
  const forward = (nativeRegister, entry) => {
    if (forwarded.has(entry.type)) return true;
    try {
      const source = entry.source;
      nativeRegister({
        name: entry.type,
        plugin: entry.plugin,
        validator:
          typeof source === 'function' && !source.__isYupSchema__
            ? (nativeHelpers) => source({ ...helpers, ...(nativeHelpers || {}) })
            : () => source,
      });
      forwarded.add(entry.type);
      return true;
    } catch {
      return false;
    }
  };

  const apply = async () => {
    if (stopped) {
      remove();
      state = 'off';
      reason = null;
      return;
    }
    // Every switch-on (start, Settings, another process) re-runs the canary and the type probes.
    if (enabled && !wasEnabled) {
      canary = null;
      probeContext = null;
      probed.clear();
    }
    wasEnabled = enabled;
    if (!enabled) {
      remove();
      state = 'off';
      reason = null;
      return;
    }
    const native = detectNativeSupport(strapi);
    if (native.native) {
      remove();
      const entries = registry.entries();
      const failed = native.register
        ? entries.filter((entry) => !forward(native.register, entry)).length
        : entries.length;
      if (state !== 'native') {
        logger.info(
          `Core Blocks bridge: this Strapi validates custom blocks itself, the bridge is off${
            entries.length
              ? ` (${entries.length - failed} of ${entries.length} registration(s) handed to Strapi)`
              : ''
          }`
        );
        if (failed)
          logger.error(
            `Core Blocks bridge: ${failed} registration(s) could not be handed to Strapi; register them with Strapi's own API`
          );
      }
      state = 'native';
      reason = failed ? 'FORWARD_FAILED' : null;
      return;
    }
    if (uninstall) {
      await probePending();
      if (stopped) return remove();
      state = settledState();
      return;
    }
    let validator;
    try {
      validator = strapi.entityValidator;
    } catch {
      validator = null;
    }
    const hookProblem = checkHookPoint(validator);
    if (!canary) {
      if (hookProblem) canary = { ok: false, reason: hookProblem };
      else {
        const uid = strapi.getModel('admin::user')
          ? 'admin::user'
          : Object.keys(strapi.contentTypes || {}).find((key) => strapi.getModel(key));
        const original = unwrap(validator.validateEntityCreation);
        canary = uid ? await runCanary({ original, uid }) : { ok: false, reason: 'NO_MODEL' };
        probeContext = canary.ok ? { original, uid } : null;
      }
    }
    if (stopped) {
      state = 'off';
      return;
    }
    if (!canary.ok || hookProblem) {
      if (state !== 'unavailable') {
        logger.error(
          `Core Blocks bridge: Strapi's entity validator is not in the expected shape (${
            hookProblem || canary.reason
          }); the bridge stays off and custom blocks are rejected as before. Check for a Magic Editor X update.`
        );
      }
      state = 'unavailable';
      reason = hookProblem || canary.reason;
      return;
    }
    await probePending();
    if (stopped) {
      state = 'off';
      return;
    }
    uninstall = installBridge(validator, {
      activeRegistry: () => (enabled && !stopped ? activeView : null),
      getModel: (uid) => strapi.getModel(uid),
      errors,
      reportOnce,
    });
    state = settledState();
    reason = null;
  };

  /** Serialises state changes so a refresh and a Settings save never interleave. */
  const run = (task) => {
    applying = applying.then(task, task).catch((error) => {
      logger.error('Core Blocks bridge could not change state', error);
    });
    return applying;
  };

  const refresh = () =>
    run(async () => {
      storedEnabled = await readStored();
      enabled = storedEnabled ?? configEnabled();
      await apply();
    });

  return {
    /**
     * Registers a custom block type of Strapi's core Blocks field for server-side validation.
     * Call it in the host's or a plugin's `register()` or `bootstrap()`; it works at any time.
     * The same `type` goes to the admin helper `app.getPlugin('magic-editor-x').apis.addCoreBlocks`.
     * @param {{ type: string, validator: object|Function, plugin?: string }} definition - `type` is the
     *   node `type` (lowercase, hyphens); `validator` a Yup schema or `(helpers) => schema` with
     *   helpers `{ yup, textNodeValidator, linkNodeValidator, inlineNodeValidator, checkValidLink }`;
     *   `plugin` names the owner (default `magic-editor-x`).
     * @returns {{ type: string, plugin: string }} The registered type.
     * @throws {import('../utils/core-blocks-bridge').CoreBlockDefinitionError} On an invalid, built-in or
     *   duplicate type or a validator that is not a Yup schema.
     * @sideeffect Adds the type to the registry; in state `native` also to Strapi's registry.
     */
    register(definition) {
      const entry = registry.register(definition);
      if (enabled && state === 'native') {
        const native = detectNativeSupport(strapi);
        if (native.register) forward(native.register, registry.get(entry.type));
      } else if (enabled && uninstall && !stopped) {
        // Probed against Strapi before the bridge validates it; until then Strapi decides as before.
        run(async () => {
          await probePending();
          if (uninstall && !stopped) state = settledState();
        });
      }
      return entry;
    },

    /**
     * Registered types, in registration order.
     * @returns {{ type: string, plugin: string }[]} Types.
     */
    list() {
      return registry.list();
    },

    /**
     * State for Settings and diagnostics. Holds no content.
     * @returns {{ enabled: boolean, configEnabled: boolean, source: 'settings'|'config', state: string, reason: string|null, types: { type: string, plugin: string }[], claimedByStrapi: string[] }} Status;
     *   `claimedByStrapi` lists registered types the running Strapi validates itself (left to Strapi).
     */
    status() {
      return {
        enabled,
        configEnabled: configEnabled(),
        source: storedEnabled === null ? 'config' : 'settings',
        state,
        reason,
        types: registry.list(),
        claimedByStrapi: claimedByStrapi(),
      };
    },

    /**
     * Reads the switch and applies it; starts the cluster refresh. Called in bootstrap.
     * Never throws: problems are logged once and leave Strapi untouched.
     * @returns {Promise<void>} Settled when the state is applied.
     * @sideeffect May wrap `strapi.entityValidator`; starts an unref'd 30 s timer.
     */
    async start() {
      stopped = false;
      await refresh();
      if (!timer) {
        timer = setInterval(() => {
          refresh();
        }, REFRESH_MS);
        if (typeof timer.unref === 'function') timer.unref();
      }
    },

    /**
     * Applies a switch value saved in Settings (the settings service stores it first).
     * @param {boolean} value - New value.
     * @returns {Promise<void>} Settled when applied.
     * @sideeffect Installs or removes the entity validator wrapper in this process.
     */
    async setEnabled(value) {
      await run(async () => {
        storedEnabled = value === true;
        enabled = storedEnabled;
        // Saving the switch as on always retries the canary, so a fixed Strapi can be picked up.
        if (enabled) wasEnabled = false;
        await apply();
      });
    },

    /**
     * Resolves when all queued state changes and type probes have run (tests, diagnostics).
     * @returns {Promise<void>} Settled promise.
     */
    settled() {
      return applying;
    },

    /**
     * Removes the wrapper and the timer and cancels queued state changes. Called in destroy.
     * `strapi.entityValidator` is shared by every Strapi instance of the process, so nothing may
     * install the wrapper again after this.
     * @returns {Promise<void>} Settled when the in-flight apply has finished (and left nothing installed).
     * @sideeffect Restores Strapi's entity validator functions.
     */
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      remove();
      state = 'off';
      await applying;
      remove();
      state = 'off';
    },
  };
};
