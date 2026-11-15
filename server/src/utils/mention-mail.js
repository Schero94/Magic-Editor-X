'use strict';

/**
 * Texts of the mention e-mail in the recipient's admin interface language
 * (2.5). The language is the admin user's `preferedLanguage` (Strapi's own
 * spelling of the column, set in the admin profile): its primary subtag picks
 * one of the five admin languages of the plugin (`pt-BR` -> `pt`); anything
 * else, or no language, is English.
 *
 * Values are filled in by plain placeholder replacement (no ICU, no format
 * strings evaluated): the caller passes header-safe, bounded values, and the
 * HTML part escapes them again.
 */

const MENTION_MAIL_LANGUAGES = Object.freeze(['en', 'de', 'fr', 'es', 'pt']);

/** Message catalogue: `{actor}`, `{title}`, `{type}` and `{url}` are the only placeholders. */
const MESSAGES = Object.freeze({
  en: {
    subject: '{actor} mentioned you in a comment',
    sentenceTitled: '{actor} mentioned you in a comment on "{title}" ({type}).',
    sentenceUntitled: '{actor} mentioned you in a comment on an entry of {type}.',
    someone: 'Someone',
    open: 'Open the comment',
    openText: 'Open the comment: {url}',
    noUrl: 'Open the Content Manager to read the comment.',
    footer: 'You get this e-mail because e-mail notifications for mentions are turned on in Magic Editor X.',
  },
  de: {
    subject: '{actor} hat Sie in einem Kommentar erwähnt',
    sentenceTitled: '{actor} hat Sie in einem Kommentar zu „{title}“ ({type}) erwähnt.',
    sentenceUntitled: '{actor} hat Sie in einem Kommentar zu einem Eintrag vom Typ {type} erwähnt.',
    someone: 'Jemand',
    open: 'Kommentar öffnen',
    openText: 'Kommentar öffnen: {url}',
    noUrl: 'Öffnen Sie den Content Manager, um den Kommentar zu lesen.',
    footer:
      'Sie erhalten diese E-Mail, weil E-Mail-Benachrichtigungen für Erwähnungen in Magic Editor X aktiviert sind.',
  },
  fr: {
    subject: '{actor} vous a mentionné dans un commentaire',
    sentenceTitled: '{actor} vous a mentionné dans un commentaire sur « {title} » ({type}).',
    sentenceUntitled: '{actor} vous a mentionné dans un commentaire sur une entrée de type {type}.',
    someone: "Quelqu'un",
    open: 'Ouvrir le commentaire',
    openText: 'Ouvrir le commentaire : {url}',
    noUrl: 'Ouvrez le Content Manager pour lire le commentaire.',
    footer:
      'Vous recevez cet e-mail car les notifications par e-mail des mentions sont activées dans Magic Editor X.',
  },
  es: {
    subject: '{actor} le ha mencionado en un comentario',
    sentenceTitled: '{actor} le ha mencionado en un comentario en «{title}» ({type}).',
    sentenceUntitled: '{actor} le ha mencionado en un comentario en una entrada de tipo {type}.',
    someone: 'Alguien',
    open: 'Abrir el comentario',
    openText: 'Abrir el comentario: {url}',
    noUrl: 'Abra el Content Manager para leer el comentario.',
    footer:
      'Recibe este correo porque las notificaciones por correo de las menciones están activadas en Magic Editor X.',
  },
  pt: {
    subject: '{actor} mencionou você em um comentário',
    sentenceTitled: '{actor} mencionou você em um comentário em "{title}" ({type}).',
    sentenceUntitled: '{actor} mencionou você em um comentário em uma entrada do tipo {type}.',
    someone: 'Alguém',
    open: 'Abrir o comentário',
    openText: 'Abrir o comentário: {url}',
    noUrl: 'Abra o Content Manager para ler o comentário.',
    footer:
      'Você recebe este e-mail porque as notificações por e-mail de menções estão ativadas no Magic Editor X.',
  },
});

/**
 * Mail language of an admin user.
 * @param {unknown} preferedLanguage - The admin user's `preferedLanguage` (`de`, `pt-BR`, null, ...).
 * @returns {'en'|'de'|'fr'|'es'|'pt'} Language (English when unknown).
 */
const mentionMailLanguage = (preferedLanguage) => {
  if (typeof preferedLanguage !== 'string') return 'en';
  const primary = preferedLanguage.trim().slice(0, 35).split(/[-_]/)[0].toLowerCase();
  return MENTION_MAIL_LANGUAGES.includes(primary) ? primary : 'en';
};

/**
 * Replaces `{name}` placeholders with values (no other syntax is interpreted).
 * @param {string} template - Message.
 * @param {Record<string, string>} values - Values.
 * @returns {string} Text.
 */
const fill = (template, values) =>
  template.replace(/\{(actor|title|type|url)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : ''
  );

/**
 * Subject and text parts of a mention e-mail. HTML escaping is the caller's job.
 * @param {string} language - `mentionMailLanguage(...)` result.
 * @param {{ actor: string, title: string, type: string, url: string|null }} values - Header-safe values
 *   (`actor` '' falls back to the localized "Someone").
 * @returns {{ subject: string, sentence: string, openText: string, openLabel: string, noUrl: string, footer: string }} Texts.
 */
const mentionMailTexts = (language, { actor, title, type, url }) => {
  const messages = MESSAGES[language] || MESSAGES.en;
  const values = { actor: actor || messages.someone, title, type, url: url || '' };
  return {
    subject: fill(messages.subject, values),
    sentence: fill(title ? messages.sentenceTitled : messages.sentenceUntitled, values),
    openText: url ? fill(messages.openText, values) : messages.noUrl,
    openLabel: messages.open,
    noUrl: messages.noUrl,
    footer: messages.footer,
  };
};

module.exports = {
  MENTION_MAIL_LANGUAGES,
  MENTION_MAIL_MESSAGES: MESSAGES,
  mentionMailLanguage,
  mentionMailTexts,
};
