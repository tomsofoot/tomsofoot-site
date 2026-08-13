// pdf-loader.js — chargement du document PDF via PDF.js (moteur vendorisé, aucun CDN)
// Configure le worker sur la version locale correspondant EXACTEMENT au moteur.
import * as pdfjsLib from '../../vendor/pdfjs/pdf.min.mjs';

const WORKER_URL = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL.href;

export { pdfjsLib };

// Erreur typée : chaque code correspond à un message utilisateur distinct.
export class ReaderError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ReaderError';
    this.code = code;      // 'not_found' | 'network' | 'invalid' | 'password' | 'unsupported' | 'render'
    this.cause = cause;
  }
}

// Détecte un navigateur trop ancien pour le module (ES modules + canvas + PDF.js).
export function checkBrowserSupport() {
  const ok =
    typeof pdfjsLib?.getDocument === 'function' &&
    'fonts' in document &&
    !!document.createElement('canvas').getContext;
  return ok;
}

// Charge le PDF et renvoie l'objet document PDF.js + le nombre de pages.
// onProgress(fraction 0..1) est appelé pendant le téléchargement quand la
// taille totale est connue.
export async function loadPdf(url, { onProgress } = {}) {
  if (!checkBrowserSupport()) {
    throw new ReaderError('unsupported', 'Navigateur non compatible avec le lecteur.');
  }

  let task;
  try {
    task = pdfjsLib.getDocument({
      url,
      // Nécessaire pour la couche texte (Unicode / accents corrects).
      // On garde le comportement par défaut : polices intégrées du PDF.
      isEvalSupported: false,
      // Cache raisonnable côté navigateur pour le PDF d'origine.
      disableAutoFetch: false,
      disableStream: false,
    });
  } catch (err) {
    throw new ReaderError('invalid', 'Impossible d\'initialiser le document.', err);
  }

  if (onProgress) {
    task.onProgress = ({ loaded, total }) => {
      if (total) onProgress(Math.max(0, Math.min(1, loaded / total)));
    };
  }

  try {
    const pdf = await task.promise;
    return { pdf, numPages: pdf.numPages };
  } catch (err) {
    const name = err?.name || '';
    if (name === 'MissingPDFException') {
      throw new ReaderError('not_found', 'PDF introuvable à l\'adresse indiquée.', err);
    }
    if (name === 'PasswordException') {
      throw new ReaderError('password', 'Ce PDF est protégé par mot de passe.', err);
    }
    if (name === 'InvalidPDFException') {
      throw new ReaderError('invalid', 'Le fichier n\'est pas un PDF valide.', err);
    }
    if (name === 'UnexpectedResponseException' || /network|fetch|Failed to fetch/i.test(err?.message || '')) {
      throw new ReaderError('network', 'Erreur réseau pendant le chargement du PDF.', err);
    }
    throw new ReaderError('invalid', 'Le PDF n\'a pas pu être ouvert.', err);
  }
}
